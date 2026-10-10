import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComposer } from '../server/composer.js';

const sessionId = '7d4e1b20-2222-4333-8444-955566667777';
const record = { pid: 94168, sessionId, kind: 'interactive', status: 'busy', updatedAt: 1791541557691 };

/**
 * A fake herdr: two panes with Claude, the target one is w3D:p1 with process 94168. Records every call.
 * fail — herdr is installed but does not answer; missing — herdr is not installed at all; screens — what the pane
 * shows, one per read, the last one stays.
 * @param {{ fail?: boolean, missing?: boolean, screens?: readonly string[] }} [options]
 */
function fakeHerdr({ fail = false, missing = false, screens = [''] } = {}) {
  let reads = 0;
  /** @type {string[][]} */
  const calls = [];
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    calls.push([...args]);
    if (missing) return { ok: false, error: 'spawn herdr ENOENT', missing: true };
    if (fail) return { ok: false, error: 'no herdr server is running', missing: false };
    const [, command, , pane] = args;
    if (command === 'list') return { ok: true, json: { result: { panes: [{ agent: 'claude', pane_id: 'w2:p1' }, { agent: 'claude', pane_id: 'w3D:p1' }] } }, text: '' };
    if (command === 'read') return { ok: true, json: undefined, text: screens[Math.min(reads++, screens.length - 1)] ?? '' };
    if (command === 'process-info') return { ok: true, json: { result: { process_info: { foreground_processes: [{ pid: pane === 'w3D:p1' ? 94168 : 555 }] } } }, text: '' };
    return { ok: true, json: { result: { type: 'ok' } }, text: '' };
  };
  return { run, calls };
}

/** @param {readonly unknown[]} records @param {ReturnType<typeof fakeHerdr>} herdr */
const composerOf = (records, herdr) => createComposer({ readRecords: async () => records, herdr: herdr.run });

test('liveState_Should_FindPaneWhereSessionRuns', async () => {
  const herdr = fakeHerdr();

  assert.deepEqual(await composerOf([record], herdr).liveState(sessionId), { state: 'live', status: 'busy', pane: 'w3D:p1' });
});

test('liveState_Should_ReportHerdrNotInstalledWhetherSessionRunsOrNot', async () => {
  const herdr = fakeHerdr({ missing: true });

  assert.deepEqual(await composerOf([record], herdr).liveState(sessionId), { state: 'herdr-missing' });
  assert.deepEqual(await composerOf([], herdr).liveState(sessionId), { state: 'herdr-missing' });
  assert.deepEqual(await composerOf([record], herdr).send(sessionId, 'some text'), { ok: false, error: 'herdr-missing' });
});

test('send_Should_TypeTextIntoSessionPaneAndPressEnter', async () => {
  const herdr = fakeHerdr();

  const outcome = await composerOf([record], herdr).send(sessionId, 'first\r\nsecond\n');

  assert.deepEqual(outcome, { ok: true, pane: 'w3D:p1' });
  assert.deepEqual(herdr.calls.slice(-2), [
    ['pane', 'send-text', 'w3D:p1', 'first\nsecond'],
    ['pane', 'send-keys', 'w3D:p1', 'enter'],
  ]);
});

test('send_Should_RefuseEmptyTextAndOfflineSessionWithoutTouchingTerminal', async () => {
  const herdr = fakeHerdr();

  assert.deepEqual(await composerOf([record], herdr).send(sessionId, '  \n '), { ok: false, error: 'empty' });
  assert.deepEqual(await composerOf([], herdr).send(sessionId, 'some text'), { ok: false, error: 'offline' });
  assert.deepEqual(herdr.calls.filter((call) => call[1] === 'send-text' || call[1] === 'send-keys'), []);
});

test('interrupt_Should_PressEscapeInSessionPane', async () => {
  const herdr = fakeHerdr();

  assert.deepEqual(await composerOf([record], herdr).interrupt(sessionId), { ok: true, pane: 'w3D:p1', prompt: undefined });
  assert.deepEqual(herdr.calls.at(-1), ['pane', 'send-keys', 'w3D:p1', 'esc']);
});

test('interrupt_Should_GiveBackPromptThePageSentExactlyWhenClaudeHadNotStartedOnIt', async () => {
  const box = (/** @type {string} */ text) => `● Earlier answer\n────────\n❯ ${text}\n────────\n  ⏵⏵ auto mode on`;
  const herdr = fakeHerdr({ screens: [box(''), box('Explain the failing\n  test in detail'), box('')] });
  const composer = composerOf([record], herdr);
  await composer.send(sessionId, 'Explain the failing\ntest in detail');

  assert.deepEqual(await composer.interrupt(sessionId), { ok: true, pane: 'w3D:p1', prompt: 'Explain the failing\ntest in detail' });
});

test('liveState_Should_SearchPanesOnlyOnceForRunningProcess', async () => {
  const herdr = fakeHerdr();
  const composer = composerOf([record], herdr);

  await composer.liveState(sessionId);
  await composer.liveState(sessionId);

  assert.equal(herdr.calls.filter((call) => call[1] === 'process-info').length, 2, 'two panes with Claude — one request for each, and only the first time');
});

test('liveState_Should_ExplainWhySessionCannotReceiveText', async () => {
  const elsewhere = { ...record, pid: 777 };

  assert.deepEqual(await composerOf([], fakeHerdr()).liveState(sessionId), { state: 'offline' });
  assert.deepEqual(await composerOf([elsewhere], fakeHerdr()).liveState(sessionId), { state: 'outside-herdr', status: 'busy' });
  assert.deepEqual(await composerOf([record], fakeHerdr({ fail: true })).liveState(sessionId), { state: 'no-herdr', status: 'busy' });
});

test('liveState_Should_TreatHerdrErrorReplyAsUnavailable', async () => {
  // This is how herdr replies when the client is older than the running server.
  /** @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const mismatch = async () => ({ ok: true, json: { id: 'cli:pane:list', error: { code: 'protocol_mismatch', message: 'upgrade the Herdr client' } }, text: '' });
  const composer = createComposer({ readRecords: async () => [record], herdr: mismatch });

  assert.deepEqual(await composer.liveState(sessionId), { state: 'no-herdr', status: 'busy' });
});

test('rewind_Should_TouchTerminalOnlyWhileClaudeWaitsForInput', async () => {
  const request = { stepsUp: 1, prompt: 'Now test it', action: /** @type {const} */ ('conversation') };
  const busy = fakeHerdr();
  const offline = fakeHerdr();

  assert.deepEqual(await composerOf([record], busy).rewind(sessionId, request), { ok: false, error: 'busy' });
  assert.deepEqual(await composerOf([], offline).rewind(sessionId, request), { ok: false, error: 'offline' });
  assert.deepEqual([...busy.calls, ...offline.calls].filter(([, command]) => command === 'send-keys' || command === 'send-text'), []);
});
