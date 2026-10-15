// Temp folders for tests, removed when the test process exits rather than after each test: by then whatever a test
// started that works in its folder — a server, a watcher — is done with it, or the process would not be exiting.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The process's temp folders are kept in one of its own, so one exit handler removes them all — one per folder would
// set off Node's warning of a leak past ten
const root = join(tmpdir(), `ccw-test-${process.pid}`);
// Windows may hold a file a moment after it is closed, hence the retries
process.once('exit', () => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));

/**
 * A new empty folder for a test, removed when the test process exits.
 * @param {string} prefix - starts the folder's name, telling whose it is
 * @returns {string} the folder's path
 */
export function tempDir(prefix) {
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, prefix));
}
