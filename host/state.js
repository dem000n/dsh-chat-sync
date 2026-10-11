/**
 * Durable plugin state.
 *
 * Kept in one small JSON document below `$DSH_HOME/sync` — never in the shared
 * store, because it holds this computer's own name, its change baseline and
 * its sync history. The document is written atomically and read defensively:
 * a damaged file degrades to "not configured yet" instead of breaking the page.
 * @module @local/dsh-sync/host/state
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SYNC_DIR_NAME } from './items.js';
import { ensureDir, exists, readJson, writeJsonAtomic } from './util.js';

/** Bumped when the document's meaning changes, so an old file is not misread. */
const STATE_VERSION = 1;

/** How many finished syncs the page can look back at. */
const HISTORY_LIMIT = 30;

/**
 * Absolute path of the plugin's own directory inside the Harness home.
 * @param dshHome - resolved Harness home.
 * @returns the directory path.
 */
export function syncDirOf(dshHome) {
  return path.join(dshHome, SYNC_DIR_NAME);
}

/**
 * Build a stable, readable device identifier for this computer.
 * @returns a short identifier.
 */
function createDeviceId() {
  const slug = os.hostname().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return `${slug === '' ? 'pc' : slug}-${randomBytes(3).toString('hex')}`;
}

/**
 * A fresh state document for a computer that has never synced.
 * @returns the default state.
 */
function defaultState() {
  const name = os.hostname() || 'Мой компьютер';
  return {
    version: STATE_VERSION,
    device: { id: createDeviceId(), name, createdAt: new Date().toISOString() },
    store: undefined,
    items: {
      sessions: true,
      attachments: true,
      settings: true,
      instructions: true,
    },
    autoSync: { enabled: true, minutes: 15 },
    copy: 'ru',
    pathMap: {},
    baseline: {},
    revisions: {},
    knownDevices: {},
    history: [],
    conflicts: [],
    lastSyncAt: undefined,
    lastResult: undefined,
  };
}

/**
 * Load the state document, creating defaults in memory when it is absent.
 * @param dshHome - resolved Harness home.
 * @returns the state document.
 */
export async function loadState(dshHome) {
  const file = path.join(syncDirOf(dshHome), 'state.json');
  const stored = await readJson(file, undefined);
  if (stored === undefined || typeof stored !== 'object' || stored === null || stored.version !== STATE_VERSION) {
    return defaultState();
  }
  const base = defaultState();
  return {
    ...base,
    ...stored,
    device: { ...base.device, ...stored.device },
    items: { ...base.items, ...stored.items },
    autoSync: { ...base.autoSync, ...stored.autoSync },
    pathMap: { ...stored.pathMap },
    baseline: { ...stored.baseline },
    revisions: { ...stored.revisions },
    knownDevices: { ...stored.knownDevices },
    history: Array.isArray(stored.history) ? stored.history.slice(0, HISTORY_LIMIT) : [],
    conflicts: Array.isArray(stored.conflicts) ? stored.conflicts : [],
  };
}

/**
 * Persist the state document atomically.
 * @param dshHome - resolved Harness home.
 * @param state - the document to write.
 */
export async function saveState(dshHome, state) {
  const dir = syncDirOf(dshHome);
  await ensureDir(dir);
  await writeJsonAtomic(path.join(dir, 'state.json'), state);
}

/**
 * The local store directory a git store clones into.
 * @param dshHome - resolved Harness home.
 * @returns the directory path.
 */
export function defaultStoreDir(dshHome) {
  return path.join(syncDirOf(dshHome), 'store');
}

/**
 * Where superseded versions of a file are preserved instead of being lost.
 * @param dshHome - resolved Harness home.
 * @returns the directory path.
 */
export function conflictsDirOf(dshHome) {
  return path.join(syncDirOf(dshHome), 'conflicts');
}

/**
 * Append one finished sync to the history, newest first.
 * @param state - the document to update in place.
 * @param entry - the summary to record.
 */
export function pushHistory(state, entry) {
  state.history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
  state.lastSyncAt = Date.parse(entry.at);
  state.lastResult = entry;
}

/**
 * Human-readable file name for a preserved version of a conflicted file.
 * @param storeRelPath - the original portable path.
 * @param deviceName - the computer the other version came from.
 * @param at - when it was preserved.
 * @returns a file name safe on every platform.
 */
export function backupNameFor(storeRelPath, deviceName, at) {
  const base = path.basename(storeRelPath);
  const safeDevice = String(deviceName).replace(/[^\w.-]+/g, '_').slice(0, 24);
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base}.conflict-${safeDevice}-${stamp}`;
}

/**
 * Whether the plugin has ever been pointed at a store.
 * @param state - the state document.
 * @returns true when a store is configured.
 */
export function isConfigured(state) {
  return state.store !== undefined && state.store !== null && typeof state.store.dir === 'string';
}

/**
 * Ensure the plugin's own directory exists.
 * @param dshHome - resolved Harness home.
 */
export async function ensureSyncDir(dshHome) {
  const dir = syncDirOf(dshHome);
  if (!(await exists(dir))) await ensureDir(dir);
  return dir;
}

/**
 * Remove preserved conflict copies older than a month to keep the plugin's
 * own directory small. Failures are ignored: housekeeping never fails a sync.
 * @param dshHome - resolved Harness home.
 */
export async function pruneConflictBackups(dshHome) {
  const dir = conflictsDirOf(dshHome);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(dir, entry.name);
    try {
      const info = await fs.stat(absolute);
      if (info.mtimeMs < cutoff) await fs.rm(absolute, { force: true });
    } catch {
      /* ignore */
    }
  }
}
