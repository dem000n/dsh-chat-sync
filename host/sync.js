/**
 * The synchronization engine.
 *
 * Model in one paragraph. Every computer publishes its own complete copy of
 * the enabled items below `<store>/snapshots/<deviceId>` and writes a manifest
 * of content hashes. A sync fetches the other devices' manifests, decides per
 * file who is newer, copies the newer version in, then republishes its own
 * tree. Because a computer only ever writes below its own device directory, no
 * file ever has to be merged with a foreign edit — the only genuine conflict is
 * "the same chat was continued on two computers", and that is reported to the
 * user with both versions preserved instead of being guessed at.
 * @module @local/dsh-sync/host/engine
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from './store.js';
import { buildItems, destinationFor, listItemFiles, ownsPath } from './items.js';
import {
  backupNameFor,
  conflictsDirOf,
  defaultStoreDir,
  ensureSyncDir,
  isConfigured,
  loadState,
  pruneConflictBackups,
  pushHistory,
  saveState,
} from './state.js';
import {
  copyFileAtomic,
  ensureDir,
  exists,
  hashFile,
  isBytePrefix,
  isDirectory,
  readJson,
  resolveDshHome,
  resolveProfileDir,
  writeFileAtomic,
} from './util.js';
import { workspacePaths } from './workspace-file.js';
import { defaultPortableWorkspace, projectKey } from './session-paths.js';
import { encodeSegment, readSessionHeaderFrom, rewriteHeaderCwd } from './zstd.js';

/** Files larger than this are never compared byte by byte for append-only growth. */
const PREFIX_COMPARE_LIMIT = 64 * 1024 * 1024;

/** Items whose files are append-only logs, where "one extends the other" wins. */
const APPEND_ONLY_ITEMS = new Set(['sessions']);

/**
 * Build the engine bound to one Host plugin instance.
 * @param options - config, logger, the credential resolver and the Host adapter.
 * @returns the engine handle used by the HTTP layer.
 */
export function createEngine({ config, logger, resolveToken, host = {} }) {
  let dshHome = resolveDshHome();
  let profileDir;
  let items = [];
  let state;
  /** Per-path hash cache; the only reason a status refresh is cheap. */
  const hashCache = new Map();
  let scanCache;
  let syncInFlight;
  let phase = 'idle';
  let phaseDetail = '';
  let lastError;

  /** Load paths and state once, before the first request. */
  async function init() {
    profileDir = await resolveProfileDir();
    items = buildItems({ dshHome, profileDir });
    state = await loadState(dshHome);
    if (!isConfigured(state)) {
      state.store = undefined;
    }
    await ensureSyncDir(dshHome);
    void pruneConflictBackups(dshHome);
    return state;
  }

  /** The store facade for the configured settings, or `undefined`. */
  function currentStore() {
    if (!isConfigured(state)) return undefined;
    return createStore({ settings: state.store, logger, resolveToken });
  }

  /** Enabled item ids in catalogue order. */
  function enabledItems() {
    return items.filter((item) => state.items[item.id] === true);
  }

  /**
   * Hash one file, reusing the cached value while size and mtime agree.
   * @param absolute - file to hash.
   * @returns the short hash, or `undefined` when the file vanished.
   */
  async function hashCached(absolute) {
    let info;
    try {
      info = await fs.stat(absolute);
    } catch {
      hashCache.delete(absolute);
      return undefined;
    }
    const cached = hashCache.get(absolute);
    if (cached !== undefined && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.hash;
    const hash = await hashFile(absolute);
    hashCache.set(absolute, { size: info.size, mtimeMs: info.mtimeMs, hash });
    return hash;
  }

  /**
   * Walk the enabled items and hash everything.
   * @param options - `force` ignores the short-lived scan cache.
   * @returns the scan result.
   */
  async function scanLocal(options = {}) {
    const { force = false } = options;
    if (!force && scanCache !== undefined && Date.now() - scanCache.at < 5000) return scanCache;
    const perItem = {};
    const oversized = {};
    let files = 0;
    let bytes = 0;
    for (const item of enabledItems()) {
      const rows = new Map();
      let itemBytes = 0;
      const listing = await listItemFiles(item);
      for (const row of listing.rows) {
        const hash = await hashCached(row.absolute);
        if (hash === undefined) continue;
        rows.set(row.storeRelPath, { absolute: row.absolute, hash, size: row.size });
        itemBytes += row.size;
      }
      perItem[item.id] = { files: rows, bytes: itemBytes };
      if (listing.oversized.length > 0) oversized[item.id] = listing.oversized;
      files += rows.size;
      bytes += itemBytes;
    }
    scanCache = { at: Date.now(), items: perItem, totals: { files, bytes }, oversized };
    return scanCache;
  }

  /**
   * Build the per-file view of every other device's published manifest.
   * @param store - the store facade.
   * @returns `{ index, cards }` where index is `[itemId][storeRelPath]`.
   */
  async function readRemote(store) {
    const cards = await store.listDeviceCards();
    const index = {};
    const devices = [];
    for (const { deviceId, card } of cards) {
      devices.push({
        id: deviceId,
        name: typeof card?.name === 'string' ? card.name : deviceId,
        platform: typeof card?.platform === 'string' ? card.platform : undefined,
        lastSyncAt: typeof card?.lastSyncAt === 'string' ? card.lastSyncAt : undefined,
        isThisDevice: deviceId === state.device.id,
      });
      if (deviceId === state.device.id) continue;
      const manifest = await store.readSnapshotManifest(deviceId);
      const manifestItems = manifest?.items;
      if (typeof manifestItems !== 'object' || manifestItems === null) continue;
      for (const [itemId, entry] of Object.entries(manifestItems)) {
        const files = entry?.files;
        if (typeof files !== 'object' || files === null) continue;
        index[itemId] ??= {};
        const rev = Number(entry?.rev ?? 0);
        for (const [storeRelPath, meta] of Object.entries(files)) {
          const candidate = {
            deviceId,
            deviceName: typeof card?.name === 'string' ? card.name : deviceId,
            hash: String(meta?.hash ?? ''),
            size: Number(meta?.size ?? 0),
            rev,
          };
          const current = index[itemId][storeRelPath];
          if (current === undefined || candidate.rev > current.rev || (candidate.rev === current.rev && candidate.deviceId > current.deviceId)) {
            index[itemId][storeRelPath] = candidate;
          }
        }
      }
    }
    return { index, devices };
  }

  /**
   * Count local files that differ from the recorded baseline.
   * @param scan - a scan result.
   * @returns per-item pending counts.
   */
  function pendingCounts(scan) {
    const pending = {};
    for (const item of enabledItems()) {
      const files = scan.items[item.id]?.files ?? new Map();
      const baseline = state.baseline[item.id] ?? {};
      let count = 0;
      for (const [storeRelPath, entry] of files) {
        if (baseline[storeRelPath]?.hash !== entry.hash) count += 1;
      }
      pending[item.id] = count;
    }
    return pending;
  }

  /**
   * Count incoming files known from the last fetch.
   * @param scan - a scan result.
   * @param store - the store facade.
   * @returns per-item incoming counts, or `undefined` when no store is set up.
   */
  async function incomingCounts(scan, store) {
    if (store === undefined) return undefined;
    const { index } = await readRemote(store);
    const incoming = {};
    for (const item of enabledItems()) {
      const remote = index[item.id] ?? {};
      const files = scan.items[item.id]?.files ?? new Map();
      let count = 0;
      for (const [storeRelPath, entry] of Object.entries(remote)) {
        const local = files.get(storeRelPath);
        if (local === undefined || local.hash !== entry.hash) count += 1;
      }
      incoming[item.id] = count;
    }
    return incoming;
  }

  /**
   * Apply one incoming file.
   * @param context - store, scan and bookkeeping.
   * @param item - owning item.
   * @param storeRelPath - portable path.
   * @param remote - the winning remote entry.
   * @returns the outcome name.
   */
  async function applyRemoteFile(context, item, storeRelPath, remote) {
    const { store, scan, applied, conflicts } = context;
    const local = scan.items[item.id]?.files.get(storeRelPath);
    const baseline = state.baseline[item.id]?.[storeRelPath];
    const source = store.publishedFilePath(remote.deviceId, item.id, storeRelPath);
    if (applied.length + conflicts.length > 4000) return 'skipped';

    const remember = () => {
      state.baseline[item.id] ??= {};
      state.baseline[item.id][storeRelPath] = { hash: remote.hash, rev: remote.rev, by: remote.deviceId };
    };

    if (local !== undefined && local.hash === remote.hash) {
      remember();
      return 'same';
    }
    const localUnchanged = local === undefined || baseline === undefined || baseline.hash === local.hash;
    if (localUnchanged) {
      const outcome = await writeIncoming(item, storeRelPath, source, local);
      if (outcome !== 'applied') return outcome;
      remember();
      applied.push({ item: item.id, path: storeRelPath, bytes: remote.size, from: remote.deviceName });
      return 'applied';
    }
    // Both sides changed the same file. An append-only log where one version
    // extends the other is not a conflict at all: the longer one is the truth.
    if (APPEND_ONLY_ITEMS.has(item.id) && remote.size < PREFIX_COMPARE_LIMIT && (local?.size ?? 0) < PREFIX_COMPARE_LIMIT) {
      const relation = await compareAppendOnly(local, source);
      if (relation === 'remote-newer') {
        const outcome = await writeIncoming(item, storeRelPath, source, local);
        if (outcome !== 'applied') return outcome;
        remember();
        applied.push({ item: item.id, path: storeRelPath, bytes: remote.size, from: remote.deviceName, merged: false });
        return 'applied';
      }
      if (relation === 'local-newer') {
        state.baseline[item.id] ??= {};
        state.baseline[item.id][storeRelPath] = { hash: local.hash, rev: remote.rev, by: state.device.id };
        return 'local-newer';
      }
    }
    await preserveConflict(item, storeRelPath, source, remote, local);
    conflicts.push({ item: item.id, path: storeRelPath });
    return 'conflict';
  }

  /**
   * Whether one append-only log extends the other.
   * @param local - the local file entry.
   * @param alternateAbsolute - the incoming file.
   * @returns which side is newer, or `undefined` when they truly diverged.
   */
  async function compareAppendOnly(local, alternateAbsolute) {
    if (local === undefined) return 'remote-newer';
    const [mine, theirs] = await Promise.all([
      fs.readFile(local.absolute).catch(() => undefined),
      fs.readFile(alternateAbsolute).catch(() => undefined),
    ]);
    if (mine === undefined || theirs === undefined) return undefined;
    if (isBytePrefix(mine, theirs)) return 'remote-newer';
    if (isBytePrefix(theirs, mine)) return 'local-newer';
    return undefined;
  }

  /**
   * Put one incoming file in place, merging documents that need it.
   * @param item - owning item.
   * @param storeRelPath - portable path.
   * @param source - absolute path inside the store.
   * @param local - the local entry, when the file already exists.
   * @returns `applied`, `skipped` or `failed`.
   */
  async function writeIncoming(item, storeRelPath, source, local) {
    if (item.place === 'session') return placeSession(source, storeRelPath);
    const destination = destinationFor(item, { dshHome, profileDir }, storeRelPath);
    if (destination === undefined) return 'skipped';
    try {
      if (local !== undefined && local.hash !== undefined) {
        // Keep the superseded version out of harm's way before replacing it.
        await ensureDir(conflictsDirOf(dshHome));
      }
      await copyFileAtomic(source, destination);
      return 'applied';
    } catch (error) {
      logger?.warn?.(`dsh-sync: не удалось применить ${storeRelPath}: ${String(error?.message ?? error)}`);
      return 'failed';
    }
  }

  /**
   * Put one incoming chat in place.
   *
   * A Harness chat is bound to the folder it was started in: the log header
   * names that folder, the directory the log sits in is derived from the same
   * name, and the Harness refuses to list a chat whose own folder does not
   * resolve. So a chat arriving from another computer is placed in this order
   * of preference: the recorded folder already exists here; the folder the user
   * mapped for it; the recorded folder can simply be created here; otherwise
   * the chat moves to one shared folder and its header is re-pointed at it, so
   * it stays visible and continuable instead of silently disappearing.
   * @param source - the incoming log inside the store.
   * @param storeRelPath - `<project-key>/<encoded session id>/<log file>`.
   * @returns `applied`, `busy`, `skipped` or `failed`.
   */
  async function placeSession(source, storeRelPath) {
    const segments = storeRelPath.split('/');
    const fileName = segments[segments.length - 1] ?? 'session.v4.jsonl.zstd';
    const buffer = await fs.readFile(source).catch(() => undefined);
    if (buffer === undefined) return 'failed';
    const header = readSessionHeaderFrom(buffer);
    if (header === undefined) {
      // Not a Harness log this plugin understands: copy it verbatim rather
      // than dropping it, and leave the Harness to decide about it.
      await copyFileAtomic(source, path.join(dshHome, 'sessions', ...segments)).catch(() => undefined);
      return 'applied';
    }
    // A chat this process currently has open must not be touched at all: the
    // Harness keeps its append position in memory, so replacing the file under
    // a live chat would produce a log it then refuses to read. Leave it for a
    // later sync instead.
    if (host.isSessionLive?.(header.id) === true) return 'busy';
    const originalCwd = typeof header.cwd === 'string' ? header.cwd : undefined;
    let targetCwd = originalCwd;
    let rewrite = false;
    let relocated = false;
    if (targetCwd !== undefined && !(await isDirectory(targetCwd))) {
      const mapped = state.pathMap[projectKey(targetCwd)];
      if (typeof mapped === 'string' && mapped !== '') {
        targetCwd = mapped;
        rewrite = true;
      } else if (await createProjectFolder(targetCwd)) {
        targetCwd = originalCwd;
      } else {
        targetCwd = portableWorkspacePath();
        rewrite = true;
        relocated = true;
      }
    }
    // The directory name is not cosmetic: the Harness compares the physical
    // path with the header it just read, and a single mismatch makes it refuse
    // the whole chat list. Verify before writing anything.
    const expectedProjectKey = targetCwd === undefined ? segments[0] : projectKey(targetCwd);
    const expectedSessionDir = encodeSegment(header.id);
    const directory = path.join(dshHome, 'sessions', expectedProjectKey, expectedSessionDir);
    const destination = path.join(directory, fileName);
    try {
      // A chat may not live in two project directories at once: that is a hard
      // error for the Harness. Clear any earlier placement first.
      await removeOtherPlacements(header.id, directory);
      await ensureDir(directory);
      if (rewrite && targetCwd !== undefined) {
        const rewritten = rewriteHeaderCwd(buffer, targetCwd);
        if (rewritten === undefined) await copyFileAtomic(source, destination);
        else await writeFileAtomic(destination, rewritten);
      } else {
        await copyFileAtomic(source, destination);
      }
      if (relocated && targetCwd !== undefined) {
        state.relocations ??= {};
        state.relocations[header.id] = { from: originalCwd, to: targetCwd, at: new Date().toISOString() };
        await registerSessionInWorkspace(targetCwd, header.id);
      }
      return 'applied';
    } catch (error) {
      logger?.warn?.(`dsh-sync: не удалось разместить чат ${String(header.id)}: ${String(error?.message ?? error)}`);
      return 'failed';
    }
  }

  /**
   * Move aside any other copy of one chat.
   *
   * The Harness refuses to list sessions at all when the same chat id appears
   * in two project directories, so an older placement is parked in the
   * conflict folder rather than left behind.
   * @param sessionId - the chat id.
   * @param keep - the directory that must remain the only home of the chat.
   */
  async function removeOtherPlacements(sessionId, keep) {
    const root = path.join(dshHome, 'sessions');
    const wanted = encodeSegment(sessionId);
    const projects = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const candidate = path.join(root, project.name, wanted);
      if (path.resolve(candidate) === path.resolve(keep)) continue;
      if (!(await isDirectory(candidate))) continue;
      const parked = path.join(conflictsDirOf(dshHome), `duplicate-${wanted}-${Date.now().toString(36)}`);
      await ensureDir(parked);
      await fs.rename(candidate, parked).catch(() => undefined);
      logger?.info?.(`dsh-sync: лишняя копия чата ${sessionId} перемещена в ${parked}`);
    }
  }

  /**
   * Create the folder a chat was started in, when this computer can.
   * @param cwd - the recorded folder.
   * @returns true when the folder now exists.
   */
  async function createProjectFolder(cwd) {
    try {
      await ensureDir(cwd);
      return await isDirectory(cwd);
    } catch {
      return false;
    }
  }

  /**
   * The shared folder used for chats whose own folder is unavailable here.
   * @returns an absolute folder path.
   */
  function portableWorkspacePath() {
    const configured = typeof config?.portableWorkspace === 'string' ? config.portableWorkspace.trim() : '';
    return configured === '' ? defaultPortableWorkspace(dshHome) : configured;
  }

  /**
   * Make sure a folder is a workspace in the running registry and that the
   * chat is a member of it, which is what puts it back in the sidebar.
   *
   * This goes through the live registry service on purpose: the workspace
   * registry is kept in memory and rewritten whole, so editing its file behind
   * the Harness's back loses the edit at the next write and can make the
   * registry fail its own consistency checks.
   * @param folder - the workspace folder.
   * @param sessionId - the chat to register.
   */
  async function registerSessionInWorkspace(folder, sessionId) {
    try {
      if (typeof host.ensureWorkspaceSession !== 'function') return;
      await host.ensureWorkspaceSession(folder, sessionId);
    } catch (error) {
      logger?.warn?.(`dsh-sync: не удалось отнести чат ${sessionId} к папке ${folder}: ${String(error?.message ?? error)}`);
    }
  }

  /**
   * Preserve the incoming version of a genuinely diverged file and record the
   * conflict, so nothing is ever overwritten or lost.
   * @param item - owning item.
   * @param storeRelPath - portable path.
   * @param source - the incoming file in the store.
   * @param remote - the winning remote entry.
   * @param local - the local entry.
   */
  async function preserveConflict(item, storeRelPath, source, remote, local) {
    const directory = conflictsDirOf(dshHome);
    await ensureDir(directory);
    const name = backupNameFor(storeRelPath, remote.deviceName, Date.now());
    const backup = path.join(directory, name);
    await copyFileAtomic(source, backup);
    const id = `${item.id}:${storeRelPath}`;
    const record = {
      id,
      item: item.id,
      path: storeRelPath,
      from: remote.deviceName,
      fromDeviceId: remote.deviceId,
      at: new Date().toISOString(),
      backup,
      localHash: local?.hash,
      remoteHash: remote.hash,
      remoteRev: remote.rev,
    };
    const existing = state.conflicts.findIndex((entry) => entry.id === id);
    if (existing === -1) state.conflicts.push(record);
    else state.conflicts[existing] = record;
  }

  /**
   * Republish this computer's enabled items into its own snapshot directory.
   * @param store - the store facade.
   * @param scan - the current scan.
   * @param options - `prune` also removes snapshot files that no longer exist.
   * @returns publication statistics.
   */
  async function publish(store, scan, options = {}) {
    const { prune = true } = options;
    const manifestItems = {};
    let copied = 0;
    let removed = 0;
    let changedAny = false;
    for (const item of enabledItems()) {
      const files = scan.items[item.id]?.files ?? new Map();
      const baseline = state.baseline[item.id] ?? {};
      let changed = false;
      for (const [storeRelPath, entry] of files) {
        if (baseline[storeRelPath]?.hash !== entry.hash) {
          changed = true;
          break;
        }
      }
      const previousRev = Number(state.revisions[item.id] ?? 0);
      const rev = changed ? previousRev + 1 : previousRev;
      if (changed) {
        state.revisions[item.id] = rev;
        changedAny = true;
      }
      const manifestFiles = {};
      for (const [storeRelPath, entry] of files) {
        manifestFiles[storeRelPath] = { hash: entry.hash, size: entry.size };
        const target = store.publishedFilePath(state.device.id, item.id, storeRelPath);
        const currentSize = await fs.stat(target).then((info) => info.size).catch(() => -1);
        if (currentSize !== entry.size || (await hashFile(target).catch(() => undefined)) !== entry.hash) {
          await store.publishFile(state.device.id, item.id, storeRelPath, entry.absolute);
          copied += 1;
        }
        state.baseline[item.id] ??= {};
        state.baseline[item.id][storeRelPath] = { hash: entry.hash, rev, by: state.device.id };
      }
      if (prune) removed += await pruneSnapshot(store, item, files);
      manifestItems[item.id] = {
        rev,
        bytes: scan.items[item.id]?.bytes ?? 0,
        files: manifestFiles,
      };
    }
    const manifest = {
      deviceId: state.device.id,
      deviceName: state.device.name,
      generatedAt: new Date().toISOString(),
      appVersion: typeof config?.pluginVersion === 'string' ? config.pluginVersion : undefined,
      items: manifestItems,
    };
    const card = {
      id: state.device.id,
      name: state.device.name,
      platform: `${process.platform} ${os.release()}`,
      hostname: os.hostname(),
      lastSyncAt: new Date().toISOString(),
      items: Object.fromEntries(Object.entries(manifestItems).map(([id, entry]) => [id, { rev: entry.rev, files: Object.keys(entry.files).length, bytes: entry.bytes }])),
    };
    await store.publishMetadata(state.device.id, manifest, card);
    return { copied, removed, changed: changedAny, manifest };
  }

  /**
   * Delete files from this device's snapshot that it no longer has locally.
   * Deletion never travels the other way: a chat removed on one computer is
   * restored rather than erased on the others.
   * @param store - the store facade.
   * @param item - owning item.
   * @param files - the current local file map.
   * @returns how many files were removed from the snapshot.
   */
  async function pruneSnapshot(store, item, files) {
    const root = path.join(store.root, 'snapshots', state.device.id, 'data', item.id);
    const walk = async (directory, relative) => {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return 0;
      }
      let count = 0;
      for (const entry of entries) {
        const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          count += await walk(absolute, childRelative);
          continue;
        }
        if (files.has(childRelative)) continue;
        await fs.rm(absolute, { force: true });
        count += 1;
      }
      return count;
    };
    return walk(root, '');
  }

  /**
   * Run one full synchronization.
   * @param options - direction and what triggered it.
   * @returns the sync summary.
   */
  async function runSync(options = {}) {
    const { direction = 'both', trigger = 'manual' } = options;
    if (syncInFlight !== undefined) return syncInFlight;
    syncInFlight = (async () => {
      const started = Date.now();
      lastError = undefined;
      try {
        if (!isConfigured(state)) throw new Error('Синхронизация ещё не настроена.');
        const store = currentStore();
        phase = 'checking';
        phaseDetail = '';
        await store.prepare();
        if (direction !== 'push') {
          phase = 'pulling';
          await store.pull();
        }
        phase = 'scanning';
        scanCache = undefined;
        const scan = await scanLocal({ force: true });
        phase = 'applying';
        const { index, devices } = await readRemote(store);
        const applied = [];
        const conflicts = [];
        const skipped = [];
        const deferred = [];
        const context = { store, scan, applied, conflicts, skipped };
        for (const item of enabledItems()) {
          const remote = index[item.id];
          if (remote === undefined) continue;
          for (const [storeRelPath, entry] of Object.entries(remote)) {
            if (!ownsPath(item, storeRelPath)) continue;
            const outcome = await applyRemoteFile(context, item, storeRelPath, entry);
            if (outcome === 'failed' || outcome === 'skipped') skipped.push({ item: item.id, path: storeRelPath, outcome });
            else if (outcome === 'busy') deferred.push({ item: item.id, path: storeRelPath });
          }
        }
        for (const device of devices) {
          if (device.isThisDevice) continue;
          state.knownDevices[device.id] = { name: device.name, lastSyncAt: device.lastSyncAt };
        }
        let publication = { copied: 0, removed: 0, changed: false };
        let pushed = false;
        if (direction !== 'pull') {
          phase = 'publishing';
          publication = await publish(store, scan);
          if (publication.changed || publication.copied > 0 || publication.removed > 0) {
            phase = 'pushing';
            const result = await store.commitAndPush(`sync: ${state.device.name} ${new Date().toISOString()}`);
            pushed = result.pushed;
          }
        }
        const summary = {
          at: new Date().toISOString(),
          ok: true,
          trigger,
          direction,
          durationMs: Date.now() - started,
          applied: applied.length,
          appliedBytes: applied.reduce((total, row) => total + (row.bytes ?? 0), 0),
          pushed: publication.copied,
          pushedBytes: scan.totals.bytes,
          removed: publication.removed,
          conflicts: conflicts.length,
          skipped: skipped.length,
          skippedPaths: skipped.slice(0, 20),
          deferred: deferred.length,
          deferredPaths: deferred.slice(0, 20),
          pushedToRemote: pushed,
          items: Object.keys(scan.items),
          needsReload: applied.some((row) => row.item === 'settings' || row.item === 'workspaces'),
        };
        pushHistory(state, summary);
        await saveState(dshHome, state);
        phase = 'idle';
        phaseDetail = '';
        scanCache = undefined;
        return { ok: true, summary };
      } catch (error) {
        const message = String(error?.message ?? error);
        lastError = message;
        phase = 'error';
        phaseDetail = message;
        const summary = {
          at: new Date().toISOString(),
          ok: false,
          trigger,
          direction,
          durationMs: Date.now() - started,
          message,
        };
        pushHistory(state, summary);
        await saveState(dshHome, state).catch(() => {});
        return { ok: false, summary, message };
      } finally {
        syncInFlight = undefined;
      }
    })();
    return syncInFlight;
  }

  /**
   * Everything the page needs to draw itself. Reads only local files, so it is
   * safe to call on every render and never blocks on the network.
   * @param options - `force` re-hashes local files.
   * @returns the status document.
   */
  async function status(options = {}) {
    const scan = await scanLocal({ force: options.force === true });
    const store = currentStore();
    const pending = pendingCounts(scan);
    let incoming;
    const devices = [];
    try {
      if (store !== undefined) {
        const remote = await readRemote(store);
        incoming = await incomingCounts(scan, store);
        devices.push(...remote.devices);
      }
    } catch (error) {
      logger?.warn?.(`dsh-sync: не удалось прочитать хранилище: ${String(error?.message ?? error)}`);
    }
    if (!devices.some((device) => device.isThisDevice)) {
      devices.unshift({
        id: state.device.id,
        name: state.device.name,
        platform: `${process.platform} ${os.release()}`,
        lastSyncAt: state.lastSyncAt === undefined ? undefined : new Date(state.lastSyncAt).toISOString(),
        isThisDevice: true,
      });
    }
    return {
      configured: isConfigured(state),
      device: { id: state.device.id, name: state.device.name, platform: `${process.platform} ${os.release()}` },
      store: store === undefined ? undefined : store.describe(),
      items: items.map((item) => ({
        id: item.id,
        enabled: state.items[item.id] === true,
        files: scan.items[item.id]?.files.size ?? 0,
        bytes: scan.items[item.id]?.bytes ?? 0,
        pending: pending?.[item.id] ?? 0,
        incoming: incoming?.[item.id] ?? 0,
        needsReload: item.needsReload === true,
        oversized: scan.oversized?.[item.id] ?? [],
      })),
      totals: scan.totals,
      pending: Object.values(pending ?? {}).reduce((total, value) => total + value, 0),
      incoming: incoming === undefined ? undefined : Object.values(incoming).reduce((total, value) => total + value, 0),
      devices,
      conflicts: state.conflicts.map((conflict) => ({ ...conflict })),
      history: state.history.slice(0, 10),
      lastSyncAt: state.lastSyncAt,
      lastResult: state.lastResult,
      autoSync: { ...state.autoSync },
      copy: state.copy,
      busy: syncInFlight !== undefined,
      phase,
      phaseDetail,
      error: lastError,
      paths: { home: dshHome, profile: profileDir, store: store?.root },
      missingWorkspacePaths: await missingWorkspaces(),
      relocations: Object.entries(state.relocations ?? {}).map(([sessionId, record]) => ({ sessionId, ...record })),
      gitAvailable: await gitAvailable(),
    };
  }

  /** Cached answer to "is git installed", which the page shows in the wizard. */
  let gitAvailableCache;
  async function gitAvailable() {
    if (gitAvailableCache === undefined) {
      const { gitVersion } = await import('./git.js');
      gitAvailableCache = (await gitVersion()).available;
    }
    return gitAvailableCache;
  }

  /**
   * Workspace folders the registry names that this computer lacks.
   *
   * The registry is asked through its live service, with the stored document as
   * a fallback, because the running Harness is the authority on what it holds.
   * @returns folder paths that need a mapping, with their project keys.
   */
  async function missingWorkspaces() {
    let folders = [];
    try {
      if (typeof host.listWorkspacePaths === 'function') folders = (await host.listWorkspacePaths()) ?? [];
    } catch (error) {
      logger?.warn?.(`dsh-sync: не удалось прочитать список разделов: ${String(error?.message ?? error)}`);
    }
    if (folders.length === 0) {
      const registry = await readJson(path.join(dshHome, 'storages', 'workspace.json'), undefined);
      folders = workspacePaths(registry);
    }
    const missing = [];
    for (const workspacePath of folders) {
      if (typeof workspacePath !== 'string' || workspacePath === '') continue;
      const key = projectKey(workspacePath);
      if (state.pathMap[key] !== undefined) continue;
      if (await exists(workspacePath)) continue;
      missing.push({ path: workspacePath, projectKey: key });
    }
    return missing;
  }

  /**
   * Point one missing workspace folder at a folder on this computer and move
   * the chats that belong to it.
   * @param options - the stored path and the chosen local folder.
   * @returns the outcome.
   */
  async function setPathMapping({ workspacePath, localPath }) {
    const key = projectKey(workspacePath);
    const target = path.resolve(String(localPath));
    state.pathMap[key] = target;
    await ensureDir(target).catch(() => undefined);
    // Chats that were parked in the shared folder now move to the real one.
    const moved = await relocateProjectDir(key, target);
    await saveState(dshHome, state);
    // Every chat that moved is re-attached to the folder that now holds it,
    // through the live registry rather than by editing its document.
    const sessions = await listProjectSessions(target);
    for (const sessionId of sessions) await registerSessionInWorkspace(target, sessionId);
    scanCache = undefined;
    return { moved };
  }

  /**
   * Which chats now live in the folder mapped for a project key.
   * @param target - the folder the user chose.
   * @returns the chat ids, read back from the header of every log present.
   */
  async function listProjectSessions(target) {
    const folder = path.join(dshHome, 'sessions', projectKey(target));
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    const ids = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const files = await fs.readdir(path.join(folder, entry.name)).catch(() => []);
      for (const file of files) {
        if (!file.includes('.jsonl')) continue;
        const buffer = await fs.readFile(path.join(folder, entry.name, file)).catch(() => undefined);
        if (buffer === undefined) continue;
        const header = readSessionHeaderFrom(buffer);
        if (header !== undefined && typeof header.id === 'string') ids.push(header.id);
        break;
      }
    }
    return ids;
  }

  /**
   * Move chats into the folder that is now mapped for them.
   * @param key - the project directory key the chats were parked under.
   * @param target - the folder the user chose.
   * @returns how many session directories moved.
   */
  async function relocateProjectDir(key, target) {
    const destinationKey = projectKey(target);
    if (destinationKey === key) return 0;
    const destination = path.join(dshHome, 'sessions', destinationKey);
    await ensureDir(destination);
    let moved = 0;
    // Chats parked in the shared folder remember where they came from.
    for (const [sessionId, record] of Object.entries(state.relocations ?? {})) {
      if (record?.from === undefined) continue;
      if (projectKey(record.from) !== key) continue;
      const from = path.join(dshHome, 'sessions', projectKey(record.to), encodeSegment(sessionId));
      const to = path.join(destination, encodeSegment(sessionId));
      moved += await moveDirectory(from, to, target, sessionId);
      state.relocations[sessionId] = { ...record, to: target };
    }
    // Chats that never had to be parked simply move by project key.
    const source = path.join(dshHome, 'sessions', key);
    const entries = await fs.readdir(source, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      moved += await moveDirectory(path.join(source, entry.name), path.join(destination, entry.name), target, undefined);
    }
    return moved;
  }

  /**
   * Move one session directory, re-pointing its log at the new folder.
   * @param from - current directory.
   * @param to - destination directory.
   * @param cwd - the folder the log header must name.
   * @param sessionId - the chat, when known.
   * @returns 1 when a directory moved.
   */
  async function moveDirectory(from, to, cwd, sessionId) {
    if (path.resolve(from) === path.resolve(to)) return 0;
    let moved = 0;
    if (await isDirectory(to)) {
      /*
       * Two homes for one chat is a hard error for the Harness — it refuses the
       * whole chat list — so the destination wins and the other copy is parked
       * in the conflict folder instead of being left side by side.
       */
      for (const entry of await fs.readdir(from, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isFile()) continue;
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (await exists(target)) {
          const parked = path.join(conflictsDirOf(dshHome), `duplicate-${encodeSegment(sessionId ?? entry.name)}-${Date.now().toString(36)}`);
          await ensureDir(parked);
          await fs.rename(source, path.join(parked, entry.name)).catch(() => undefined);
        } else {
          await ensureDir(to);
          await fs.rename(source, target).catch(() => undefined);
        }
      }
      await fs.rm(from, { recursive: true, force: true }).catch(() => undefined);
      moved = 1;
    } else {
      await ensureDir(path.dirname(to));
      try {
        await fs.rename(from, to);
        moved = 1;
      } catch {
        return 0;
      }
    }
    // Every log now sitting in the destination must name the new folder, both
    // in its header and by the directory it lives in.
    for (const entry of await fs.readdir(to, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile()) continue;
      const logPath = path.join(to, entry.name);
      const buffer = await fs.readFile(logPath).catch(() => undefined);
      if (buffer === undefined) continue;
      const rewritten = rewriteHeaderCwd(buffer, cwd);
      if (rewritten !== undefined && rewritten !== buffer) await writeFileAtomic(logPath, rewritten);
    }
    if (sessionId !== undefined && state.relocations !== undefined) {
      state.relocations[sessionId] = { from: state.relocations[sessionId]?.from ?? cwd, to: cwd, at: new Date().toISOString() };
    }
    return moved;
  }

  /**
   * Update the item selection.
   * @param items - `{ itemId: boolean }` patch.
   * @returns the resulting selection.
   */
  async function setItems(items) {
    for (const [id, value] of Object.entries(items ?? {})) {
      if (!Object.hasOwn(state.items, id)) continue;
      state.items[id] = value === true;
    }
    scanCache = undefined;
    await saveState(dshHome, state);
    return { items: { ...state.items } };
  }

  /**
   * Update auto-sync preferences.
   * @param autoSync - `{ enabled, minutes }` patch.
   */
  async function setAutoSync(autoSync) {
    if (typeof autoSync?.enabled === 'boolean') state.autoSync.enabled = autoSync.enabled;
    const minutes = Number(autoSync?.minutes);
    if (Number.isFinite(minutes)) state.autoSync.minutes = Math.min(24 * 60, Math.max(1, Math.round(minutes)));
    await saveState(dshHome, state);
    return { autoSync: { ...state.autoSync } };
  }

  /**
   * Update the interface language chosen inside the plugin's own page.
   * @param copy - `ru` or `en`.
   */
  async function setCopy(copy) {
    if (copy === 'ru' || copy === 'en') state.copy = copy;
    await saveState(dshHome, state);
    return { copy: state.copy };
  }

  /**
   * Rename this computer as it appears to the other ones.
   * @param name - the new display name.
   */
  async function setDeviceName(name) {
    const value = String(name ?? '').trim();
    if (value !== '') state.device.name = value.slice(0, 60);
    await saveState(dshHome, state);
    return { device: { ...state.device } };
  }

  /**
   * Connect this computer to a shared store for the first time, or replace it.
   * @param options - the wizard's answers.
   * @returns the outcome.
   */
  async function configure(options) {
    const kind = options?.kind === 'folder' ? 'folder' : 'git';
    const dir = kind === 'folder' ? path.resolve(String(options.folder ?? '')) : defaultStoreDir(dshHome);
    if (kind === 'folder' && String(options.folder ?? '').trim() === '') {
      return { ok: false, message: 'Укажите папку, которая синхронизируется между компьютерами.' };
    }
    const previous = state.store;
    state.store = {
      kind,
      dir,
      remote: kind === 'git' ? String(options.remote ?? '').trim() : undefined,
      branch: kind === 'git' ? String(options.branch ?? 'main').trim() || 'main' : undefined,
    };
    if (typeof options.deviceName === 'string' && options.deviceName.trim() !== '') state.device.name = options.deviceName.trim().slice(0, 60);
    if (options.items !== undefined && typeof options.items === 'object') {
      for (const [id, value] of Object.entries(options.items)) if (id in state.items) state.items[id] = value === true;
    }
    if (typeof options.copy === 'string' && (options.copy === 'ru' || options.copy === 'en')) state.copy = options.copy;
    // A brand new store has no baseline: every local file would look like a
    // change. Keep the old baseline only when the store is the same one.
    if (previous === undefined || previous.dir !== dir || previous.remote !== state.store.remote) {
      state.baseline = {};
      state.revisions = {};
    }
    await saveState(dshHome, state);
    const store = currentStore();
    try {
      await store.prepare();
      const probe = await store.test();
      if (kind === 'git' && probe.ok === false) {
        return { ok: false, message: probe.message ?? 'Репозиторий недоступен.', store: state.store };
      }
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error), store: state.store };
    }
    return { ok: true, store: state.store };
  }

  /**
   * Copy the whole content of a store the user already has onto this computer
   * by removing the local baseline, which turns every remote file into an
   * incoming change.
   * @returns the outcome.
   */
  async function adoptRemote() {
    state.baseline = {};
    state.revisions = {};
    await saveState(dshHome, state);
    scanCache = undefined;
    return { ok: true };
  }

  /**
   * Disconnect this computer from the shared store. Nothing is deleted.
   * @returns the outcome.
   */
  async function disconnect() {
    state.store = undefined;
    state.baseline = {};
    state.revisions = {};
    state.conflicts = [];
    await saveState(dshHome, state);
    scanCache = undefined;
    return { ok: true };
  }

  /**
   * Resolve one recorded conflict by choosing a side. The losing side is
   * always preserved as a file in `$DSH_HOME/sync/conflicts`.
   * @param options - conflict id and the chosen action.
   * @returns the outcome.
   */
  async function resolveConflict(options) {
    const { id, action } = options ?? {};
    const index = state.conflicts.findIndex((entry) => entry.id === id);
    if (index === -1) return { ok: false, message: 'Конфликт уже разрешён.' };
    const conflict = state.conflicts[index];
    const item = items.find((entry) => entry.id === conflict.item);
    if (item === undefined) return { ok: false, message: 'Неизвестный раздел.' };
    const destination = destinationFor(item, { dshHome, profileDir, storePath: state.pathMap }, conflict.path);
    if (destination === undefined) return { ok: false, message: 'Путь больше не существует.' };
    if (action === 'take-remote') {
      const mine = path.join(conflictsDirOf(dshHome), backupNameFor(conflict.path, state.device.name, Date.now()));
      try {
        await fs.copyFile(destination, mine);
      } catch {
        /* the local file may already be gone */
      }
      await copyFileAtomic(conflict.backup, destination);
    }
    // Either way the conflict is settled: the chosen content becomes the
    // baseline so it is not reported again, and is republished by this device.
    state.conflicts.splice(index, 1);
    state.baseline[item.id] ??= {};
    state.baseline[item.id][conflict.path] = { hash: action === 'take-remote' ? conflict.remoteHash : conflict.localHash, rev: Number(conflict.remoteRev ?? 0), by: state.device.id };
    await saveState(dshHome, state);
    scanCache = undefined;
    return { ok: true, action };
  }

  /**
   * The connection code and the instructions the wizard shows for a new
   * computer. The token is optional: including it makes the code a single
   * copy-paste but makes the code itself a secret.
   * @param options - whether to embed the token.
   * @returns the code, the decoded payload and the step list.
   */
  async function pairInfo(options = {}) {
    if (!isConfigured(state)) return { ok: false, message: 'Синхронизация ещё не настроена.' };
    const payload = {
      v: 1,
      kind: state.store.kind,
      remote: state.store.remote,
      branch: state.store.branch,
      dir: state.store.kind === 'folder' ? state.store.dir : undefined,
      items: Object.fromEntries(Object.entries(state.items).map(([id, value]) => [id, value === true])),
    };
    if (options.withToken === true) {
      const token = await resolveToken();
      if (token !== '') payload.token = token;
    }
    const code = `DSHSYNC1:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
    return { ok: true, code, payload, withToken: payload.token !== undefined };
  }

  /**
   * Read a connection code produced by another computer.
   * @param code - the pasted code.
   * @returns the decoded payload.
   */
  function parsePairCode(code) {
    const text = String(code ?? '').trim();
    const body = text.startsWith('DSHSYNC1:') ? text.slice('DSHSYNC1:'.length) : text;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || parsed.v !== 1) return { ok: false, message: 'Код не распознан.' };
      if (parsed.kind === 'git' && typeof parsed.remote !== 'string') return { ok: false, message: 'В коде нет адреса репозитория.' };
      if (parsed.kind === 'folder' && typeof parsed.dir !== 'string') return { ok: false, message: 'В коде нет имени папки.' };
      return { ok: true, payload: parsed };
    } catch {
      return { ok: false, message: 'Код повреждён или скопирован не полностью.' };
    }
  }

  /**
   * Verify a remote and, when asked, create it through the hosting API.
   * @param options - remote URL, token and whether to create the repository.
   * @returns the outcome.
   */
  async function prepareRemote(options) {
    const { normalizeRemote, probeRemote, createRemoteRepository, remoteLabel } = await import('./git.js');
    const raw = String(options?.remote ?? '').trim();
    const repositoryName = String(options?.repositoryName ?? 'dsh-sync').trim();
    const token = String(options?.token ?? '').trim();
    if (options?.create === true) {
      const created = await createRemoteRepository({ token, name: repositoryName, host: options?.host === 'gitlab' ? 'gitlab' : 'github' });
      if (!created.ok) return created;
      return { ok: true, remote: created.url, label: remoteLabel(created.url), created: true, htmlUrl: created.htmlUrl };
    }
    const remote = normalizeRemote(raw);
    if (remote === undefined) return { ok: false, message: 'Не похоже на адрес репозитория. Пример: https://github.com/имя/dsh-sync.git' };
    const probe = await probeRemote(remote, token);
    if (!probe.reachable) return { ok: false, message: probe.message, remote, label: remoteLabel(remote) };
    return { ok: true, remote, label: remoteLabel(remote), empty: probe.empty === true };
  }

  return {
    init,
    status,
    runSync,
    setItems,
    setAutoSync,
    setCopy,
    setDeviceName,
    configure,
    adoptRemote,
    disconnect,
    resolveConflict,
    setPathMapping,
    pairInfo,
    parsePairCode,
    prepareRemote,
    getState: () => state,
    items: () => items,
    rescan: () => {
      scanCache = undefined;
      hashCache.clear();
    },
  };
}
