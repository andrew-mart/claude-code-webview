import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { endProcess } from '../server/end-process.js';

// A process running ends, and is waited for: told gone once it is; one gone already is gone too
test('endProcess_Should_EndRunningProcess_AndTellItGone', async () => {
  const running = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' });
  const exited = once(running, 'exit');
  const brief = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(brief, 'exit');
  assert.ok(running.pid !== undefined && brief.pid !== undefined);

  const ended = await endProcess(running.pid, { waitMs: 10_000, stepMs: 50 });
  const [code, signal] = await exited;

  assert.deepEqual({ ended, stopped: code !== 0 || signal !== null, goneAlready: await endProcess(brief.pid, { waitMs: 1_000, stepMs: 50 }) }, { ended: true, stopped: true, goneAlready: true });
});
