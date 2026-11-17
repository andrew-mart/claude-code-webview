import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runningRecords, startedSessions } from '../server/registry.js';

// Claude Code takes its record away when it ends; one ended with the computer, or killed, leaves it behind. A record
// counts while its process runs, and only if it started since the computer did: before that, its number may have gone
// to another process. One that does not tell when it started counts while a process of its number runs
test('runningRecords_Should_LeaveOutRecordsOfEndedProcesses_AndOfOnesStartedBeforeTheComputer', () => {
  const bootedAt = 1794888374000;
  /** @param {number} pid @param {number | undefined} startedAt */
  const record = (pid, startedAt) => ({ pid, sessionId: `9b1d2c30-5555-4666-8777-98889999${pid}`, cwd: '/home/ann/notes', ...(startedAt === undefined ? {} : { startedAt }), kind: 'interactive', status: 'idle', updatedAt: bootedAt + 9000 });
  const records = [record(1001, bootedAt + 1000), record(1002, bootedAt + 2000), record(1003, bootedAt - 60_000), record(1004, undefined)];

  assert.deepEqual(
    runningRecords(records, { alive: (pid) => pid !== 1002, bootedAt }).map((one) => (typeof one === 'object' && one !== null && 'pid' in one ? one.pid : undefined)),
    [1001, 1004],
  );
});

// What ~/.claude/sessions/<pid>.json tells of the sessions open: each in its folder, since its process started — one a
// program drives (claude -p) is none of them
test('startedSessions_Should_GiveInteractiveSessionsOpen_InTheirFolders', () => {
  const records = [
    { pid: 3373897, sessionId: 'e4f79213-dcd2-4c6e-a3dc-084adb4e8756', cwd: '/home/ann/notes', startedAt: 1792412768319, kind: 'interactive', status: 'idle', updatedAt: 1792412964166 },
    { pid: 3373900, sessionId: '9b1d2c30-5555-4666-8777-988899990000', cwd: '/home/ann/notes', startedAt: 1792412768400, kind: 'sdk', status: 'busy', updatedAt: 1792412964200 },
  ];

  assert.deepEqual(startedSessions(records), [{ id: 'e4f79213-dcd2-4c6e-a3dc-084adb4e8756', cwd: '/home/ann/notes', startedAt: 1792412768319, agent: 'claude' }]);
});
