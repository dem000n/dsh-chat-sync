/**
 * Small filesystem, hashing and path helpers shared by the sync engine.
 * Nothing here depends on Harness internals: the plugin must keep working
 * across Harness upgrades, so it only uses Node built-ins and the paths
 * documented in README.md.
 * @module @local/dsh-sync/host/util
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Directory name of the Harness home when no override is configured. */
const DEFAULT_HOME_DIR = '.dsh';

/**
 * Resolve the Harness home the same way the Harness itself does: an explicit
 * `DSH_HOME` wins, otherwise `~/.dsh`.
 * @param env - environment to read; defaults to this process's.
 * @returns the absolute Harness home path.
 */
export function resolveDshHome(env = process.env) {
  const configured = env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured.trim());
  return path.join(os.homedir(), DEFAULT_HOME_DIR);
}

/**
 * Resolve the active profile directory. The launcher exports
 * `DSH_PROFILE_DIR`; when it is absent the profile name is used, and when
 * even that is absent the only profile carrying a user patch layer is taken.
 * @param env - environment to read; defaults to this process's.
 * @returns the absolute profile directory, or `undefined` when none is found.
 */
export async function resolveProfileDir(env = process.env) {
  const direct = env.DSH_PROFILE_DIR;
  if (typeof direct === 'string' && direct.trim() !== '') return path.resolve(direct.trim());
  const home = resolveDshHome(env);
  const named = env.DSH_PROFILE;
  if (typeof named === 'string' && named.trim() !== '') return path.join(home, 'profiles', named.trim());
  let entries = [];
  try {
    entries = await fs.readdir(path.join(home, 'profiles'), { withFileTypes: true });
  } catch {
    return undefined;
  }
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const name of dirs) {
    try {
      await fs.access(path.join(home, 'profiles', name, 'cordis.patch.yml'));
      return path.join(home, 'profiles', name);
    } catch {
      /* keep looking */
    }
  }
  return dirs.length === 1 ? path.join(home, 'profiles', dirs[0]) : undefined;
}

/**
 * Short, stable content hash used for change detection and the manifest.
 * @param data - bytes to hash.
 * @returns 32 lowercase hex characters.
 */
export function hashBytes(data) {
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/**
 * Hash one file without loading it whole into memory twice.
 * @param absolute - file to hash.
 * @returns the short content hash.
 */
export async function hashFile(absolute) {
  const handle = await fs.open(absolute, 'r');
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex').slice(0, 32);
  } finally {
    await handle.close();
  }
}

/**
 * Whether `prefix` is a byte prefix of `body`. Session logs are append-only
 * concatenations of compressed frames, so "one log extends the other" is
 * exactly this question and needs no format knowledge.
 * @param prefix - candidate shorter content.
 * @param body - candidate longer content.
 * @returns true when `prefix` is a prefix of `body`.
 */
export function isBytePrefix(prefix, body) {
  if (prefix.length > body.length) return false;
  return prefix.compare(body, 0, prefix.length) === 0;
}

/** Directories that never belong to a sync item. */
const WALK_SKIP = new Set(['.git', 'node_modules', '.dsh-mkdir-', '.DS_Store', 'Thumbs.db']);

/**
 * List every regular file below `root` as a POSIX-style relative path.
 * Symlinks are not followed: a synced tree must not escape its root.
 * @param root - absolute directory; a missing directory lists nothing.
 * @returns sorted relative paths.
 */
export async function walkFiles(root) {
  const found = [];
  async function visit(current, relative) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (WALK_SKIP.has(entry.name)) continue;
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const childAbsolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(childAbsolute, childRelative);
      else if (entry.isFile()) found.push(childRelative);
    }
  }
  await visit(root, '');
  return found.sort();
}

/**
 * Total size of a list of files, tolerating files that vanished mid-scan.
 * @param root - directory the relative paths are resolved against.
 * @param relatives - POSIX-style relative paths.
 * @returns summed byte size.
 */
export async function totalBytes(root, relatives) {
  let total = 0;
  for (const relative of relatives) {
    try {
      total += (await fs.stat(path.join(root, ...relative.split('/')))).size;
    } catch {
      /* a concurrent change simply does not count */
    }
  }
  return total;
}

/**
 * Create a directory tree, ignoring an existing one.
 * @param dir - absolute directory.
 */
export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Read and parse a JSON document, returning `fallback` for absence or damage
 * instead of throwing: a corrupt state file must never brick the page.
 * @param absolute - file to read.
 * @param fallback - value returned when the file is missing or unparseable.
 * @returns the parsed value or `fallback`.
 */
export async function readJson(absolute, fallback = undefined) {
  try {
    return JSON.parse(await fs.readFile(absolute, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Write bytes through a temporary neighbour and an atomic rename, so a crash
 * or a concurrent reader never observes a half-written document.
 * @param absolute - destination file.
 * @param data - string or bytes to write.
 */
export async function writeFileAtomic(absolute, data) {
  await ensureDir(path.dirname(absolute));
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, data);
  try {
    await fs.rename(temporary, absolute);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Serialize a value and write it atomically.
 * @param absolute - destination file.
 * @param value - JSON-serializable value.
 */
export async function writeJsonAtomic(absolute, value) {
  await writeFileAtomic(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Copy one file atomically, creating parent directories.
 * @param source - file to read.
 * @param destination - file to replace.
 */
export async function copyFileAtomic(source, destination) {
  await ensureDir(path.dirname(destination));
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.copyFile(source, temporary, constants.COPYFILE_FICLONE);
  await fs.rename(temporary, destination);
}

/**
 * Whether a path exists.
 * @param absolute - path to probe.
 * @returns true when it exists.
 */
export async function exists(absolute) {
  try {
    await fs.access(absolute);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a path is an existing directory.
 * @param absolute - path to probe.
 * @returns true for a directory.
 */
export async function isDirectory(absolute) {
  try {
    return (await fs.stat(absolute)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Current time as an ISO string.
 * @returns the timestamp.
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Convert a native relative path to the POSIX spelling used in manifests.
 * @param relative - platform-spelled relative path.
 * @returns the POSIX spelling.
 */
export function toPosix(relative) {
  return relative.split(path.sep).join('/');
}

/**
 * Split a POSIX relative path into native path segments.
 * @param relative - POSIX-style relative path.
 * @returns the segments.
 */
export function segmentsOf(relative) {
  return relative.split('/').filter((segment) => segment !== '');
}

/**
 * Resolve a POSIX relative path below a root, refusing to escape it.
 * @param root - absolute base directory.
 * @param relative - POSIX-style relative path.
 * @returns the absolute path, or `undefined` when it escapes the root.
 */
export function resolveInside(root, relative) {
  const absolute = path.resolve(root, ...segmentsOf(relative));
  const base = path.resolve(root);
  if (absolute !== base && !absolute.startsWith(base + path.sep)) return undefined;
  return absolute;
}

/**
 * Whether two native paths name the same location, comparing case
 * insensitively on Windows.
 * @param left - first absolute path.
 * @param right - second absolute path.
 * @returns true when they match.
 */
export function samePath(left, right) {
  if (left === undefined || right === undefined) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
