// @ts-check
// Files read as one: a Codex session goes on in a new file once its user edits a prompt and sends it again, from the
// point the new file names in the one before — what the one before has past that point is no longer the session. Its
// parts read in turn, each up to where the session leaves it, make one transcript with offsets counted across all.
import { open } from 'node:fs/promises';

/**
 * @typedef {{ path: string, end: number | undefined }} Part — end: where the session leaves the file, none: at its end
 * @typedef {{ size: number, read: (buffer: Buffer, position: number) => Promise<number>, close: () => Promise<void> }} Joined
 *   — read: fills the buffer from the position on, as far as the parts go, and tells how many bytes it put there
 */

/**
 * @param {readonly Part[]} parts — in the session's order
 * @returns {Promise<Joined>}
 */
export async function openJoined(parts) {
  /** @type {import('node:fs/promises').FileHandle[]} */
  const handles = [];
  try {
    for (const part of parts) handles.push(await open(part.path, 'r'));
    const spans = await Promise.all(handles.map(async (handle, i) => ({ handle, length: lengthOf((await handle.stat()).size, parts[i]?.end) })));
    const size = spans.reduce((sum, span) => sum + span.length, 0);
    return {
      size,
      async read(buffer, position) {
        let filled = 0;
        let start = 0;
        for (const { handle, length } of spans) {
          const from = position + filled - start;
          if (filled < buffer.length && from >= 0 && from < length) {
            const { bytesRead } = await handle.read(buffer, filled, Math.min(buffer.length - filled, length - from), from);
            filled += bytesRead;
          }
          start += length;
        }
        return filled;
      },
      close: () => closeAll(handles),
    };
  } catch (error) {
    await closeAll(handles);
    throw error;
  }
}

/**
 * @param {number} size — the file's
 * @param {number | undefined} end
 */
function lengthOf(size, end) {
  return end === undefined ? size : Math.min(end, size);
}

/** @param {readonly import('node:fs/promises').FileHandle[]} handles */
async function closeAll(handles) {
  await Promise.all(handles.map((handle) => handle.close()));
}
