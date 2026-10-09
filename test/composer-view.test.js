import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composerState, outcomeMessage, parseLiveState, parseOutcome } from '../public/model/composer.js';

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';

test('composerState_Should_EnableInputOnlyForSessionRunningInHerdr', () => {
  assert.deepEqual(composerState({ state: 'live', status: 'idle', pane: 'w3D:p1' }, sessionId), {
    shown: true,
    enabled: true,
    canInterrupt: false,
    placeholder: 'Message Claude…',
    hint: "Enter to send, Shift+Enter for a new line. The text goes to the session's terminal (herdr pane w3D:p1).",
  });
  assert.deepEqual(composerState({ state: 'live', status: 'busy', pane: 'w3D:p1' }, sessionId), {
    shown: true,
    enabled: true,
    canInterrupt: true,
    placeholder: 'Claude is working — your message will be queued',
    hint: "Enter to send, Shift+Enter for a new line. The text goes to the session's terminal (herdr pane w3D:p1).",
  });
});

test('composerState_Should_HideInputWhenHerdrIsNotInstalled', () => {
  const view = composerState({ state: 'herdr-missing' }, sessionId);

  assert.equal(view.shown, false);
  assert.equal(view.enabled, false);
});

test('composerState_Should_ExplainWhyInputIsUnavailable', () => {
  /** @type {readonly import('../public/model/composer.js').LiveState[]} */
  const states = [{ state: 'offline' }, { state: 'outside-herdr', status: 'idle' }, { state: 'no-herdr', status: 'idle' }];

  assert.deepEqual(
    states.map((live) => {
      const view = composerState(live, sessionId);
      return [view.enabled, view.hint];
    }),
    [
      [false, `The session is not running. To write to it from here, open it in a herdr pane: claude --resume ${sessionId}`],
      [false, 'The session is not running in herdr — its terminal cannot receive text.'],
      [false, 'Could not reach herdr. Start the viewer from a herdr pane.'],
    ],
  );
});

test('outcomeMessage_Should_SayWhatHappenedToSentText', () => {
  assert.equal(outcomeMessage({ ok: true, pane: 'w3D:p1' }), 'Sent to the terminal.');
  assert.equal(outcomeMessage({ ok: false, error: 'send-failed' }), 'herdr did not accept the text — the pane may have closed. The text stays in the box.');
});

test('parseLiveState_Should_AcceptOnlyKnownServerReplies', () => {
  assert.deepEqual(parseLiveState({ state: 'live', status: 'idle', pane: 'w3D:p1' }), { state: 'live', status: 'idle', pane: 'w3D:p1' });
  assert.deepEqual(parseLiveState({ state: 'offline' }), { state: 'offline' });
  assert.deepEqual(parseLiveState({ state: 'herdr-missing' }), { state: 'herdr-missing' });
  assert.deepEqual(parseLiveState({ state: 'no-herdr', status: 'busy' }), { state: 'no-herdr', status: 'busy' });
  assert.equal(parseLiveState({ state: 'live', status: 'idle' }), undefined);
  assert.equal(parseLiveState('Forbidden host'), undefined);
});

test('parseOutcome_Should_AcceptOnlyKnownServerReplies', () => {
  assert.deepEqual(parseOutcome({ ok: true, pane: 'w3D:p1' }), { ok: true, pane: 'w3D:p1' });
  assert.deepEqual(parseOutcome({ ok: false, error: 'offline' }), { ok: false, error: 'offline' });
  assert.equal(parseOutcome({ ok: false, error: 'unknown' }), undefined);
});
