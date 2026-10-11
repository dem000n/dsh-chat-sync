/**
 * The shared store: the one directory every synchronized computer reads and
 * writes, plus the transport that carries it between machines.
 *
 * Layout (identical for both transports, which is what lets a folder share and
 * a git repository hold exactly the same content):
 *
 * ```
 * <store>/
 *   devices/<deviceId>.json          one card per computer: name, last sync, counts
 *   snapshots/<deviceId>/manifest.json
 *   snapshots/<deviceId>/data/<item>/<portable path>
 * ```
 *
 * Each computer only ever writes below its own `deviceId`, so two computers
 * can never fight over a file: a conflict can only happen between two
 * *versions of the same chat*, which the engine resolves explicitly.
 * @module @local/dsh-sync/host/store
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git, gitOrThrow, probeRemote, remoteLabel } from './git.js';
import { ensureDir, exists, readJson, writeJsonAtomic } from './util.js';
import { DEVICES_DIR, SNAPSHOTS_DIR } from './items.js';

/** Marker written into a folder store so a wrong folder is obvious. */
const FOLDER_MARKER = 'dsh-sync-store.json';

/**
 * Build the store facade.
 * @param options - store settings, logger and per-call token.
 * @returns the store handle.
 */
export function createStore(options) {
  const { settings, logger, resolveToken } = options;
  const kind = settings.kind === 'folder' ? 'folder' : 'git';
  const root = settings.dir;
  const remote = settings.remote ?? '';
  const branch = settings.branch === undefined || settings.branch === '' ? 'main' : settings.branch;

  const devicesDir = () => path.join(root, DEVICES_DIR);
  const snapshotDir = (deviceId) => path.join(root, SNAPSHOTS_DIR, deviceId);
  const snapshotDataDir = (deviceId) => path.join(snapshotDir(deviceId), 'data');
  const snapshotManifestPath = (deviceId) => path.join(snapshotDir(deviceId), 'manifest.json');
  const deviceCardPath = (deviceId) => path.join(devicesDir(), `${deviceId}.json`);

  /** Run one git command against this store with the configured credential. */
  async function runGit(args, gitOptions = {}) {
    const token = await resolveToken();
    return git(root, args, { token, remote, ...gitOptions });
  }

  /** Run one authenticated git command and fail loudly on a non-zero exit. */
  async function runGitOrThrow(args, gitOptions = {}) {
    const token = await resolveToken();
    return gitOrThrow(root, args, { token, remote, ...gitOptions });
  }

  /**
   * Make the local store usable: create it, and connect it to the remote the
   * first time. Everything here is idempotent, so it also repairs a store the
   * user moved or a remote URL they edited.
   */
  async function prepare() {
    await ensureDir(root);
    if (kind === 'folder') {      const marker = path.join(root, FOLDER_MARKER);
      if (!(await exists(marker))) {
        await writeJsonAtomic(marker, { kind: 'dsh-sync-store', version: 1, createdAt: new Date().toISOString() });
      }
      return;
    }
    const gitDir = path.join(root, '.git');
    if (!(await exists(gitDir))) {
      await runGitOrThrow(['init', '-b', branch]);
      await runGitOrThrow(['config', 'user.name', 'DSH Sync']);
      await runGitOrThrow(['config', 'user.email', 'dsh-sync@localhost']);
      // Session directories are long by construction (the project key alone is
      // up to 251 characters), and a store path can push a file past the
      // Windows limit; long paths let git index it anyway.
      await runGitOrThrow(['config', 'core.longpaths', 'true']);
      await runGitOrThrow(['config', 'core.autocrlf', 'false']);
      if (remote !== '') {
        await runGitOrThrow(['remote', 'add', 'origin', remote]);
      }
    } else if (remote !== '') {
      const current = await runGit(['remote', 'get-url', 'origin']);
      const url = current.stdout.trim();
      if (current.code !== 0) await runGitOrThrow(['remote', 'add', 'origin', remote]);
      else if (url !== remote) await runGitOrThrow(['remote', 'set-url', 'origin', remote]);
    }
    // Repair these on an existing repository too: a store created before they
    // were set still needs them, and setting them is idempotent.
    await runGit(['config', 'core.longpaths', 'true']);
    await runGit(['config', 'core.autocrlf', 'false']);
    await ensureDir(devicesDir());
    await ensureDir(path.join(root, SNAPSHOTS_DIR));
  }

  /**
   * Bring the shared content up to date on this computer.
   * @returns a diagnostic describing what happened.
   */
  async function pull() {
    if (kind === 'folder') return { pulled: false, reason: 'folder' };
    await prepare();
    const fetched = await runGit(['fetch', 'origin', '--prune'], { timeoutMs: 10 * 60 * 1000 });
    if (fetched.code !== 0) {
      throw new Error(`Не удалось связаться с репозиторием: ${lastLines(fetched)}`);
    }
    const remoteRef = `refs/remotes/origin/${branch}`;
    const hasRemoteBranch = await runGit(['rev-parse', '--verify', '--quiet', remoteRef]);
    if (hasRemoteBranch.code !== 0) {
      // No branch on the remote yet: this computer publishes the first one.
      const head = await runGit(['symbolic-ref', '--short', 'HEAD']);
      if (head.code !== 0 || head.stdout.trim() !== branch) await runGitOrThrow(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
      return { pulled: false, reason: 'empty-remote' };
    }
    const hasLocalBranch = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    if (hasLocalBranch.code !== 0) {
      // A computer joining an existing store: adopt the remote history as-is.
      await runGitOrThrow(['checkout', '-B', branch, `origin/${branch}`]);
      return { pulled: true, reason: 'adopted-remote' };
    }
    const merged = await runGit(['merge', '--no-edit', `origin/${branch}`], { timeoutMs: 10 * 60 * 1000 });
    if (merged.code === 0) return { pulled: true, reason: 'merged' };
    const text = `${merged.stderr}${merged.stdout}`;
    if (/unrelated histories/i.test(text)) {
      // Two computers that each created the store independently: their
      // histories share no ancestor. Merging is safe because a computer only
      // ever writes below its own device directory, so the trees are disjoint.
      await runGitOrThrow(['merge', '--no-edit', '--allow-unrelated-histories', `origin/${branch}`], { timeoutMs: 10 * 60 * 1000 });
      return { pulled: true, reason: 'unrelated-histories-merged' };
    }
    if (/would be overwritten|local changes|not possible because you have unmerged/i.test(text)) {
      // Leftovers from an interrupted run: commit them first, then merge.
      await commitPending('sync: local files kept before merging');
      await runGitOrThrow(['merge', '--no-edit', `origin/${branch}`], { timeoutMs: 10 * 60 * 1000 });
      return { pulled: true, reason: 'merged-after-commit' };
    }
    throw new Error(`Не удалось получить изменения: ${lastLines(merged)}`);
  }

  /**
   * The last few lines of a git command's output, for a user-readable message.
   * @param result - a finished git process.
   * @returns the trimmed tail of its output.
   */
  function lastLines(result) {
    const text = `${result.stderr}\n${result.stdout}`.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    return text.slice(-3).join(' ');
  }

  /**
   * Commit whatever is pending in the working tree, if anything.
   * @param message - the commit message.
   * @returns whether a commit was created.
   */
  async function commitPending(message) {
    await gitOrThrow(root, ['add', '-A'], { token: await resolveToken(), remote });
    const status = await runGit(['status', '--porcelain']);
    if (status.stdout.trim() === '') return false;
    await runGitOrThrow(['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
    return true;
  }

  /**
   * Write one published file into this device's snapshot tree.
   * @param deviceId - publishing device.
   * @param itemId - owning item.
   * @param storeRelPath - portable path inside the item.
   * @param sourceAbsolute - file to copy.
   */
  async function publishFile(deviceId, itemId, storeRelPath, sourceAbsolute) {
    const target = path.join(snapshotDataDir(deviceId), itemId, ...storeRelPath.split('/'));
    await ensureDir(path.dirname(target));
    await fs.copyFile(sourceAbsolute, target);
  }

  /**
   * Write this device's manifest and card.
   * @param deviceId - publishing device.
   * @param manifest - the manifest document.
   * @param card - the device card document.
   */
  async function publishMetadata(deviceId, manifest, card) {
    await writeJsonAtomic(snapshotManifestPath(deviceId), manifest);
    await writeJsonAtomic(deviceCardPath(deviceId), card);
  }

  /**
   * Commit and push everything this device published.
   * @param message - commit message.
   * @returns whether anything was pushed.
   */
  async function commitAndPush(message) {
    if (kind === 'folder') return { pushed: false, reason: 'folder' };
    const committed = await commitPending(message);
    if (committed === false) return { pushed: false, reason: 'nothing-to-commit' };
    const result = await runGit(['push', 'origin', `HEAD:${branch}`], { timeoutMs: 10 * 60 * 1000 });
    if (result.code !== 0) {
      const text = `${result.stderr}${result.stdout}`;
      if (/rejected|non-fast-forward|fetch first/i.test(text)) {
        // Another computer pushed while we were working. Fold its history in —
        // including the case where the two stores were created independently —
        // and try once more; each computer only writes below its own folder, so
        // this merge cannot conflict.
        await pull();
        const retry = await runGit(['push', 'origin', `HEAD:${branch}`], { timeoutMs: 10 * 60 * 1000 });
        if (retry.code === 0) return { pushed: true, reason: 'pushed-after-merge' };
        throw new Error(`Не удалось отправить изменения: ${lastLines(retry)}`);
      }
      throw new Error(`Не удалось отправить изменения: ${lastLines(result)}`);
    }
    return { pushed: true, reason: 'pushed' };
  }

  /**
   * Read every device card in the store.
   * @returns `{ deviceId, card }` rows, this device included.
   */
  async function listDeviceCards() {
    const entries = await fs.readdir(devicesDir(), { withFileTypes: true }).catch(() => []);
    const rows = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const card = await readJson(path.join(devicesDir(), entry.name), undefined);
      if (card === undefined) continue;
      rows.push({ deviceId: entry.name.replace(/\.json$/, ''), card });
    }
    return rows;
  }

  /**
   * Read one device's published manifest.
   * @param deviceId - device to read.
   * @returns the manifest, or `undefined` when it has never published.
   */
  async function readSnapshotManifest(deviceId) {
    return readJson(snapshotManifestPath(deviceId), undefined);
  }

  /**
   * Absolute path of one published file.
   * @param deviceId - publishing device.
   * @param itemId - owning item.
   * @param storeRelPath - portable path inside the item.
   * @returns the absolute path inside the store.
   */
  function publishedFilePath(deviceId, itemId, storeRelPath) {
    return path.join(snapshotDataDir(deviceId), itemId, ...storeRelPath.split('/'));
  }

  /**
   * Describe the store for the page.
   * @returns a display-oriented summary.
   */
  function describe() {
    return {
      kind,
      dir: root,
      remote: remote === '' ? undefined : remote,
      remoteLabel: remote === '' ? undefined : remoteLabel(remote),
      branch,
    };
  }

  /** Verify the remote is reachable right now. */
  async function test() {
    if (kind === 'folder') {
      const writable = await fs.access(root).then(() => true).catch(() => false);
      return { ok: writable, message: writable ? undefined : 'Папка недоступна для записи.' };
    }
    if (remote === '') return { ok: false, message: 'Адрес репозитория не указан.' };
    const result = await probeRemote(remote, await resolveToken());
    return { ok: result.reachable, message: result.message, empty: result.empty };
  }

  return {
    kind,
    root,
    branch,
    remote,
    prepare,
    pull,
    publishFile,
    publishMetadata,
    commitAndPush,
    listDeviceCards,
    readSnapshotManifest,
    publishedFilePath,
    describe,
    test,
    /** Log helper bound to this store, so messages carry the store context. */
    logger,
  };
}
