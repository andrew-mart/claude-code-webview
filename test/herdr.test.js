import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudePaneIds, foregroundPids, paneIoOf, parseSavedHerdr, resolveHerdr, toTerminalInput } from '../server/herdr.js';

test('resolveHerdr_Should_PreferPaneEnvironmentThenSavedSettingsThenPath', () => {
  const pane = { HERDR_BIN_PATH: 'C:\\tools\\herdr\\herdr.exe', HERDR_SOCKET_PATH: 'C:\\Users\\dev\\.config\\herdr\\sessions\\main\\herdr.sock' };
  const saved = { binPath: 'D:\\old\\herdr.exe', socketPath: 'D:\\old\\herdr.sock' };

  assert.deepEqual(resolveHerdr(pane, saved), { bin: pane.HERDR_BIN_PATH, socketPath: pane.HERDR_SOCKET_PATH, source: 'env' });
  assert.deepEqual(resolveHerdr({}, saved), { bin: 'D:\\old\\herdr.exe', socketPath: 'D:\\old\\herdr.sock', source: 'saved' });
  assert.deepEqual(resolveHerdr({}, undefined), { bin: 'herdr', socketPath: undefined, source: 'path' });
});

test('parseSavedHerdr_Should_AcceptOnlyCompleteSettings', () => {
  assert.deepEqual(parseSavedHerdr({ binPath: 'D:\\h\\herdr.exe', socketPath: 'D:\\h\\herdr.sock' }), { binPath: 'D:\\h\\herdr.exe', socketPath: 'D:\\h\\herdr.sock' });
  assert.equal(parseSavedHerdr({ binPath: 'D:\\h\\herdr.exe' }), undefined);
  assert.equal(parseSavedHerdr(undefined), undefined);
});

test('toTerminalInput_Should_KeepLinesAsLineFeedsSoEnterDoesNotSubmitEarly', () => {
  assert.equal(toTerminalInput('first\r\nsecond\rthird\n\n'), 'first\nsecond\nthird');
});

test('claudePaneIds_Should_ListOnlyPanesRunningClaude', () => {
  const list = {
    id: 'cli:pane:list',
    result: {
      panes: [
        { agent: 'claude', agent_status: 'idle', pane_id: 'w2:p1', cwd: 'C:\\projects\\notes' },
        { agent_status: 'unknown', pane_id: 'w2:p2', cwd: 'C:\\projects\\notes' },
        { agent: 'claude', agent_status: 'working', pane_id: 'w3D:p1', cwd: 'C:\\projects\\shop' },
      ],
    },
  };

  assert.deepEqual(claudePaneIds(list), ['w2:p1', 'w3D:p1']);
});

test('foregroundPids_Should_ReadProcessesInPane', () => {
  const info = {
    id: 'cli:pane:process_info',
    result: {
      process_info: {
        foreground_process_group_id: 94168,
        foreground_processes: [{ argv0: 'claude.exe', name: 'claude.exe', pid: 94168 }],
        pane_id: 'w3D:p1',
        shell_pid: 81448,
      },
      type: 'pane_process_info',
    },
  };

  assert.deepEqual(foregroundPids(info), [94168]);
  assert.deepEqual(foregroundPids({ error: { code: 'protocol_mismatch' } }), []);
});

// A terminal through the herdr program: the screen with its colours, the keys as they are
test('paneIoOf_Should_ReadScreenWithColours_AndTypeKeys', async () => {
  /** @type {string[][]} */
  const calls = [];
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    calls.push([...args]);
    return { ok: true, json: undefined, text: args[1] === 'read' ? '$ ls' : '' };
  };
  const io = paneIoOf(run);

  assert.deepEqual([await io.read('w2:p2'), await io.type('w2:p2', 'ls\r')], [{ ok: true, text: '$ ls' }, { ok: true }]);
  assert.deepEqual(calls, [
    ['pane', 'read', 'w2:p2', '--source', 'visible', '--format', 'ansi'],
    ['pane', 'send-text', 'w2:p2', 'ls\r'],
  ]);
});

// The page tells "herdr is not running" from "this pane is closed"
test('paneIoOf_Should_TellHerdrMissing_FromPaneGone', async () => {
  const missing = paneIoOf(async () => ({ ok: false, error: 'spawn herdr ENOENT', missing: true }));
  const gone = paneIoOf(async () => ({ ok: false, error: 'pane not found', missing: false }));

  assert.deepEqual(
    [await missing.read('w2:p2'), await missing.type('w2:p2', 'x'), await gone.read('w2:p2'), await gone.type('w2:p2', 'x')],
    [{ ok: false, missing: true }, { ok: false, error: 'herdr-missing' }, { ok: false, missing: false }, { ok: false, error: 'gone' }],
  );
});
