import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startedSessions } from '../server/registry.js';

// What ~/.claude/sessions/<pid>.json tells of the sessions open: each in its folder, since its process started — one a
// program drives (claude -p) is none of them
test('startedSessions_Should_GiveInteractiveSessionsOpen_InTheirFolders', () => {
  const records = [
    { pid: 3373897, sessionId: 'e4f79213-dcd2-4c6e-a3dc-084adb4e8756', cwd: '/home/ann/notes', startedAt: 1792412768319, kind: 'interactive', status: 'idle', updatedAt: 1792412964166 },
    { pid: 3373900, sessionId: '9b1d2c30-5555-4666-8777-988899990000', cwd: '/home/ann/notes', startedAt: 1792412768400, kind: 'sdk', status: 'busy', updatedAt: 1792412964200 },
  ];

  assert.deepEqual(startedSessions(records), [{ id: 'e4f79213-dcd2-4c6e-a3dc-084adb4e8756', cwd: '/home/ann/notes', startedAt: 1792412768319 }]);
});
