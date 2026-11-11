// @ts-check
// The pages' diagnostics (public/view/diagnostics.js), written down by the viewer a line each: when, from which browser,
// what the page told of its frames, its keys' waits, its requests — to tell what keeps a device's page slow. A log grown
// past its size goes to its .1 — the one there before let go — and a new one is begun.
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * @param {string} file — ~/.claude-code-webview/diagnostics.jsonl
 * @param {{ maxBytes: number }} options — maxBytes: past it the log is begun anew
 * @returns {{ record: (report: Record<string, unknown>, from: { at: number, agent: string }) => Promise<void> }}
 */
export function createDiagnosticsLog(file, { maxBytes }) {
  /** Lines written one after another, each after the one before. */
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  return {
    record(report, { at, agent }) {
      const written = queue.then(async () => {
        const size = await stat(file).then((found) => found.size, () => 0);
        if (size > maxBytes) await rename(file, `${file}.1`);
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify({ at: new Date(at).toISOString(), agent, report })}\n`);
      });
      queue = written.catch(() => undefined);
      return written;
    },
  };
}
