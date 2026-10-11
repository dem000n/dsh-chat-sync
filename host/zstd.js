/**
 * The physical shape of a Harness session log, and the one edit the plugin
 * needs to make inside it.
 *
 * A log is a concatenation of independently compressed Zstandard frames: the
 * first frame holds exactly the header record, and every later frame holds one
 * durable batch of events. The Harness locates those frames with the same
 * block-level walk implemented here — the plugin needs it for two reasons:
 * to prove a file really is a Harness session before touching it, and to
 * re-point `cwd` when a chat started in a folder this computer does not have.
 * The walk is deliberately strict: anything unexpected makes the caller leave
 * the file alone rather than risk a chat.
 * @module @local/dsh-sync/host/zstd
 */
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

/** Little-endian magic that opens every Zstandard frame. */
const ZSTD_MAGIC = 0xfd2fb528;

/** Matches the Harness's own frame encoder, which always records a checksum. */
const CHECKSUM_OPTIONS = constants.ZSTD_c_checksumFlag === undefined
  ? {}
  : { params: { [constants.ZSTD_c_checksumFlag]: 1 } };

/**
 * Encode a string as one safe path segment, exactly as the Harness encodes
 * session identifiers. Ported so the plugin can compute a session directory
 * without importing Harness internals.
 * @param raw - the identifier to encode; must not be empty.
 * @returns the escaped segment.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) out += character;
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

/**
 * Locate the complete frames of a concatenated Zstandard container.
 * @param buffer - bytes currently on disk.
 * @param maxFrames - optional limit, for metadata-only readers.
 * @returns complete frame ranges plus the offset of a torn final frame.
 */
export function scanFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid zstd frame magic at byte ${String(offset)}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved zstd frame-header bit at byte ${String(offset - 1)}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved zstd block type at byte ${String(offset - 3)}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}

/**
 * Decode every complete frame of a session log into one plaintext document.
 * @param buffer - the whole file.
 * @returns the concatenated plaintext of all complete frames.
 */
export function decodeFrames(buffer) {
  const { frames } = scanFrames(buffer);
  const parts = [];
  for (const frame of frames) parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
  return Buffer.concat(parts);
}

/**
 * Parse a decoded log into its JSONL records.
 * @param buffer - the whole file.
 * @returns parsed records, or `undefined` when any line is not JSON.
 */
export function parseRecords(buffer) {
  const text = decodeFrames(buffer).toString('utf8');
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const records = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      return undefined;
    }
  }
  return records;
}

/**
 * Re-point a session log at a different project folder.
 *
 * Only the first frame is rebuilt: it holds the header record alone, so the
 * rest of the log — every durable event — is copied byte for byte and stays
 * exactly as the Harness wrote it. The result is validated by decoding it
 * again before the caller is allowed to publish it.
 * @param buffer - the whole session log.
 * @param cwd - the folder this computer will use for the chat.
 * @returns the rewritten bytes, or `undefined` when the log is not a session.
 */
export function rewriteHeaderCwd(buffer, cwd) {
  const { frames, tornStart } = scanFrames(buffer);
  if (frames.length === 0 || tornStart !== undefined) return undefined;
  const first = frames[0];
  let headerText;
  try {
    headerText = zstdDecompressSync(buffer.subarray(first.start, first.end)).toString('utf8');
  } catch {
    return undefined;
  }
  if (!headerText.endsWith('\n') || headerText.indexOf('\n') !== headerText.length - 1) return undefined;
  let header;
  try {
    header = JSON.parse(headerText.slice(0, -1));
  } catch {
    return undefined;
  }
  if (typeof header !== 'object' || header === null || header.type !== 'session' || typeof header.id !== 'string') return undefined;
  if (header.cwd === cwd) return buffer;
  const rewritten = { ...header, cwd };
  const line = `${JSON.stringify(rewritten)}\n`;
  const frame = zstdCompressSync(line, CHECKSUM_OPTIONS);
  const result = Buffer.concat([frame, buffer.subarray(first.end)]);
  // Prove the result is still a well-formed log before anyone is allowed to
  // publish it: the same number of complete frames, a final frame that holds
  // exactly the header line, and every event frame untouched by construction.
  let rescanned;
  try {
    rescanned = scanFrames(result);
  } catch {
    return undefined;
  }
  if (rescanned.tornStart !== undefined || rescanned.frames.length !== frames.length) return undefined;
  let verifyText;
  try {
    verifyText = zstdDecompressSync(result.subarray(0, rescanned.frames[0].end)).toString('utf8');
  } catch {
    return undefined;
  }
  if (!verifyText.endsWith('\n') || verifyText.indexOf('\n') !== verifyText.length - 1) return undefined;
  try {
    const verifyHeader = JSON.parse(verifyText.slice(0, -1));
    if (verifyHeader?.id !== header.id || verifyHeader?.cwd !== cwd) return undefined;
  } catch {
    return undefined;
  }
  return result;
}

/**
 * Whether a file is a Harness session log the plugin understands.
 * @param buffer - the whole file.
 * @returns the header record, or `undefined`.
 */
export function readSessionHeaderFrom(buffer) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== ZSTD_MAGIC) return undefined;
  let frames;
  try {
    frames = scanFrames(buffer, 1).frames;
  } catch {
    return undefined;
  }
  if (frames.length === 0) return undefined;
  let text;
  try {
    text = zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end)).toString('utf8');
  } catch {
    return undefined;
  }
  if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) return undefined;
  try {
    const header = JSON.parse(text.slice(0, -1));
    if (typeof header !== 'object' || header === null || header.type !== 'session' || typeof header.id !== 'string') return undefined;
    return header;
  } catch {
    return undefined;
  }
}
