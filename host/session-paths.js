/**
 * Session directory conventions, ported from the Harness so the plugin can
 * compute them without importing Harness internals.
 *
 * The Harness groups session logs under `$DSH_HOME/sessions/<project-key>/`,
 * where the key is a deliberately lossy, human-navigable spelling of the
 * folder the chat was started in. Because the key is lossy the plugin never
 * decodes it: it reads the chat's own header record, which carries the exact
 * folder, and only ever *encodes* a folder into a key.
 * @module @local/dsh-sync/host/session-paths
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

/** Longest project directory component the Harness will produce. */
const MAX_KEY_LENGTH = 251;

/**
 * Build the Harness project directory key for a folder.
 * @param cwd - the folder a chat was started in.
 * @returns the directory name used below `$DSH_HOME/sessions`.
 */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path');
  let readable = '';
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
      separatorRun = false;
    }
  }
  const body = readable.replace(/^-+/, '') || 'root';
  return `--${body.slice(0, MAX_KEY_LENGTH)}--`;
}

/**
 * Read the header record of a session log without decoding the whole file.
 *
 * A log is a concatenation of independently compressed frames and the first
 * frame holds exactly the header line, so one one-shot decompression is
 * enough — and it stays cheap no matter how long the chat grew.
 * @param absolute - session log file.
 * @returns the parsed header, or `undefined` when unreadable.
 */
export async function readSessionHeader(absolute) {
  let head;
  try {
    const handle = await fs.open(absolute, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  if (head.length === 0) return undefined;
  let text;
  if (head.length >= 4 && head.readUInt32LE(0) === 0xfd2fb528) {
    try {
      text = zstdDecompressSync(head).toString('utf8');
    } catch {
      return undefined;
    }
  } else {
    text = head.toString('utf8');
  }
  const newline = text.indexOf('\n');
  const line = newline === -1 ? text : text.slice(0, newline);
  if (!line.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a chat log begins with the session record.
 * @param absolute - session log file.
 * @returns true when the file is a readable session log.
 */
export async function isSessionLog(absolute) {
  const header = await readSessionHeader(absolute);
  return header !== undefined && header.type === 'session' && typeof header.id === 'string';
}

/**
 * The folder this machine offers for chats whose original folder is absent.
 * @param dshHome - resolved Harness home.
 * @returns an absolute directory path, not necessarily created yet.
 */
export function defaultPortableWorkspace(dshHome) {
  const documents = path.join(os.homedir(), 'Documents');
  const base = path.basename(dshHome) === '.dsh' ? documents : os.homedir();
  return path.join(base, 'DSH-Sync');
}

/**
 * Human-readable folder name for a project key, for the rare case where the
 * chat header itself cannot be read.
 * @param key - the project directory name.
 * @returns a best-effort readable label.
 */
export function describeProjectKey(key) {
  return key.replace(/^--/, '').replace(/--$/, '').replace(/-/g, path.sep) || key;
}
