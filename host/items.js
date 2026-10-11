/**
 * The syncable item catalogue: which parts of the Harness home travel between
 * computers, where each of them lives, and where an incoming file lands.
 *
 * Every item is expressed as a list of roots. A directory root contributes
 * every file below it; a file root contributes exactly one file. The path a
 * file is stored under inside the shared repository is deliberately NOT the
 * native path: it is a small portable key (`profile/cordis.patch.yml`,
 * `<project-key>/<session-id>/session.v4.jsonl.zstd`), so the store stays
 * readable and a path that only exists on one machine never leaks into it.
 * @module @local/dsh-sync/host/items
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exists, isDirectory, toPosix, walkFiles } from './util.js';

/** Directory inside the Harness home where this plugin keeps its own data. */
export const SYNC_DIR_NAME = 'sync';

/** Subdirectory of the store holding one published tree per device. */
export const SNAPSHOTS_DIR = 'snapshots';

/** Subdirectory of the store holding one small device card per device. */
export const DEVICES_DIR = 'devices';

/**
 * Build the item catalogue for one machine.
 * @param options - resolved Harness home and profile directory.
 * @returns the ordered item list.
 */
export function buildItems({ dshHome, profileDir }) {
  const home = (...parts) => path.join(dshHome, ...parts);
  const profile = (...parts) => (profileDir === undefined ? undefined : path.join(profileDir, ...parts));
  return [
    {
      id: 'sessions',
      enabledByDefault: true,
      /**
       * Chat logs. This is the point of the whole plugin, and the one item
       * that needs more than a file copy: the Harness checks that a chat's
       * recorded folder exists, so an incoming chat is re-pointed at a folder
       * this computer actually has.
       */
      roots: () => [
        { kind: 'dir', absolute: home('sessions'), prefix: '' },
      ],
      place: 'session',
    },
    {
      id: 'attachments',
      enabledByDefault: true,
      /**
       * Prompt attachments: images and files pasted or dropped into a chat.
       * They are content addressed, so the same bytes never travel twice, and
       * only the publishing staging directory is left out.
       */
      roots: () => [
        {
          kind: 'dir',
          absolute: home('attachments'),
          prefix: '',
          exclude: (relative) => relative.startsWith('v1/tmp/') || relative === 'v1/tmp',
        },
      ],
      /** Generic files have no Harness-side limit; keep the store sane anyway. */
      maxFileBytes: 256 * 1024 * 1024,
    },
    {
      id: 'settings',
      enabledByDefault: true,
      /**
       * The user's own composition layers: the home-level patch and the active
       * profile's patch and bundle list. Secrets are never part of it.
       */
      roots: () => [
        { kind: 'file', absolute: home('cordis.patch.yml'), prefix: 'home/cordis.patch.yml' },
        ...(profileDir === undefined
          ? []
          : [
            { kind: 'file', absolute: profile('cordis.patch.yml'), prefix: 'profile/cordis.patch.yml' },
            { kind: 'file', absolute: profile('package.json'), prefix: 'profile/package.json' },
          ]),
      ],
      /** Applying these changes the running composition: say so in the UI. */
      needsReload: true,
    },
    {
      id: 'instructions',
      enabledByDefault: true,
      /** Agent instructions and user skills: small, high value, safe. */
      roots: () => [
        { kind: 'file', absolute: home('AGENTS.md'), prefix: 'AGENTS.md' },
        { kind: 'dir', absolute: home('skills'), prefix: 'skills' },
      ],
    },
  ];
}

/**
 * Resolve the absolute file an incoming store path belongs to.
 * @param item - catalogue entry owning the path.
 * @param context - resolved Harness home, profile directory and path mapping.
 * @param storeRelPath - portable path inside the item.
 * @returns the absolute destination, or `undefined` when unmappable.
 */
export function destinationFor(item, context, storeRelPath) {
  const { profileDir } = context;
  for (const root of item.roots()) {
    if (root.kind === 'file') {
      if (root.prefix === storeRelPath) return root.absolute;
      continue;
    }
    const prefix = root.prefix === '' ? '' : `${root.prefix}/`;
    if (prefix !== '' && !storeRelPath.startsWith(prefix)) continue;
    const relative = storeRelPath.slice(prefix.length);
    if (relative === '') continue;
    return path.join(root.absolute, ...relative.split('/'));
  }
  return undefined;
}

/**
 * Whether a store path belongs to the item's own root set.
 * @param item - catalogue entry.
 * @param storeRelPath - portable path inside the item.
 * @returns true when the path maps onto this machine.
 */
export function ownsPath(item, storeRelPath) {
  for (const root of item.roots()) {
    if (root.kind === 'file') {
      if (root.prefix === storeRelPath) return true;
      continue;
    }
    if (root.prefix === '') return true;
    if (storeRelPath.startsWith(`${root.prefix}/`)) return true;
  }
  return false;
}

/**
 * Whether a root currently holds anything at all.
 * @param root - the root to probe.
 * @returns true when the root exists.
 */
export async function rootExists(root) {
  if (root.kind === 'file') return exists(root.absolute);
  return isDirectory(root.absolute);
}

/**
 * Enumerate every syncable file of one item as portable store paths.
 * @param item - catalogue entry.
 * @returns `{ rows, oversized }` — the files to sync, and the ones a size cap excluded.
 */
export async function listItemFiles(item) {
  const rows = [];
  const oversized = [];
  const limit = item.maxFileBytes ?? Number.POSITIVE_INFINITY;
  for (const root of item.roots()) {
    if (root.kind === 'file') {
      if (!(await exists(root.absolute))) continue;
      const size = await fileSize(root.absolute);
      if (size > limit) {
        oversized.push({ storeRelPath: root.prefix, bytes: size });
        continue;
      }
      rows.push({ storeRelPath: root.prefix, absolute: root.absolute, root, size });
      continue;
    }
    if (!(await isDirectory(root.absolute))) continue;
    for (const relative of await walkFiles(root.absolute)) {
      if (root.exclude !== undefined && root.exclude(relative)) continue;
      const storeRelPath = root.prefix === '' ? relative : `${root.prefix}/${relative}`;
      const absolute = path.join(root.absolute, ...relative.split('/'));
      const size = await fileSize(absolute);
      if (size > limit) {
        oversized.push({ storeRelPath, bytes: size });
        continue;
      }
      rows.push({ storeRelPath, absolute, root, size });
    }
  }
  rows.sort((left, right) => (left.storeRelPath < right.storeRelPath ? -1 : left.storeRelPath > right.storeRelPath ? 1 : 0));
  return { rows, oversized };
}

/**
 * Size of one file, tolerating a concurrent removal.
 * @param absolute - file to measure.
 * @returns the byte size, or 0 when it is gone.
 */
async function fileSize(absolute) {
  try {
    return (await fs.stat(absolute)).size;
  } catch {
    return 0;
  }
}

/**
 * The project-key directories a session store path can name.
 * @param storeRelPath - portable session path.
 * @returns the first segment, which is the project key.
 */
export function projectKeyOf(storeRelPath) {
  const [first] = toPosix(storeRelPath).split('/');
  return first ?? '';
}
