import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudePaneIds, foregroundPids, parseSavedHerdr, resolveHerdr, toTerminalInput } from '../server/herdr.js';

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
