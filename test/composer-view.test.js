import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composerState, outcomeMessage, parseBtwReply, parseLiveState, parseOutcome, parseStopOutcome, promptForBox, sideQuestionOf } from '../public/model/composer.js';

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';

test('composerState_Should_EnableInputOnlyForSessionRunningInHerdr', () => {
  assert.deepEqual(composerState({ state: 'live', status: 'idle', pane: 'w3D:p1', dialog: undefined }, sessionId, 'physical'), {
    shown: true,
    enabled: true,
    canInterrupt: false,
    canReopen: false,
    placeholder: 'Message Claude…',
    hint: "Enter to send, Shift+Enter for a new line. The text goes to the session's terminal (herdr pane w3D:p1).",
  });
  assert.deepEqual(composerState({ state: 'live', status: 'busy', pane: 'w3D:p1', dialog: undefined }, sessionId, 'physical'), {
    shown: true,
    enabled: true,
    canInterrupt: true,
    canReopen: false,
    placeholder: 'Claude is working — your message will be queued',
    hint: "Enter to send, Shift+Enter for a new line. The text goes to the session's terminal (herdr pane w3D:p1).",
  });
});

test('composerState_Should_ExplainSendingByButtonOnTouchKeyboard', () => {
  // a phone keyboard has no Shift+Enter: Enter starts a new line, the button sends
  assert.equal(
    composerState({ state: 'live', status: 'idle', pane: 'w3D:p1', dialog: undefined }, sessionId, 'touch').hint,
    "The ↑ button sends, Enter starts a new line. The text goes to the session's terminal (herdr pane w3D:p1).",
  );
});

test('composerState_Should_HideInputWhenHerdrIsNotInstalled', () => {
  const view = composerState({ state: 'herdr-missing' }, sessionId, 'physical');

  assert.equal(view.shown, false);
  assert.equal(view.enabled, false);
});

test('composerState_Should_ExplainWhyInputIsUnavailable', () => {
  /** @type {readonly import('../public/model/composer.js').LiveState[]} */
  const states = [{ state: 'offline' }, { state: 'outside-herdr', status: 'idle' }, { state: 'no-herdr', status: 'idle' }];

  assert.deepEqual(
    states.map((live) => {
      const view = composerState(live, sessionId, 'physical');
      return [view.enabled, view.hint];
    }),
    [
      [false, `The session is not running. Open it in herdr again — where it ran — or in a herdr pane: claude --resume ${sessionId}`],
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
  assert.deepEqual(parseLiveState({ state: 'live', status: 'idle', pane: 'w3D:p1' }), { state: 'live', status: 'idle', pane: 'w3D:p1', dialog: undefined });
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

test('parseStopOutcome_Should_AcceptPromptGivenBackAndKnownRefusalsOnly', () => {
  assert.deepEqual(parseStopOutcome({ ok: true, pane: 'w3D:p1', prompt: 'Now test it' }), { ok: true, pane: 'w3D:p1', prompt: 'Now test it' });
  assert.deepEqual(parseStopOutcome({ ok: true, pane: 'w3D:p1' }), { ok: true, pane: 'w3D:p1', prompt: undefined });
  assert.deepEqual(parseStopOutcome({ ok: false, error: 'box-not-cleared' }), { ok: false, error: 'box-not-cleared' });
  assert.deepEqual(parseStopOutcome({ ok: false, error: 'offline' }), { ok: false, error: 'offline' });
  assert.equal(parseStopOutcome({ ok: false, error: 'unknown' }), undefined);
});

test('promptForBox_Should_PutPromptBeforeDraftAndItsSavedImagesBackAsAttachments', () => {
  const prompt = 'Why does it fail?\n\nAttached images:\nC:\\Users\\ann\\.claude-code-webview\\uploads\\a1b2-c3.png';

  assert.deepEqual(promptForBox(prompt, ''), { text: 'Why does it fail?', images: ['/api/upload/a1b2-c3.png'] });
  assert.deepEqual(promptForBox('Now test it', 'and the edge cases'), { text: 'Now test it\n\nand the edge cases', images: [] });
});

test('promptForBox_Should_LeaveImageListAsTextWhenViewerDidNotSaveEveryImage', () => {
  const prompt = 'Compare them\n\nAttached images:\nC:\\Users\\ann\\.claude-code-webview\\uploads\\a1b2-c3.png\nD:\\shots\\b.png';

  assert.deepEqual(promptForBox(prompt, ''), { text: prompt, images: [] });
});

// "/btw" in the box asks aside, as in the terminal; bare "/btw" is a side question with nothing asked yet — sent to the
// terminal it would reopen the last answer there and leave the panel open
test('sideQuestionOf_Should_TakeQuestionAfterBtw_OnlyAtStartOfBox', () => {
  assert.deepEqual(
    ['/btw where is the retry limit?', '  /btw  which file\nand which line? ', '/btw', '/btwx go on', 'Fix it, /btw keep the tests'].map(sideQuestionOf),
    ['where is the retry limit?', 'which file\nand which line?', '', undefined, undefined],
  );
});

test('parseBtwReply_Should_TakeAnswerOrKnownRefusal_And_NothingElse', () => {
  assert.deepEqual(
    [{ ok: true, answer: 'In src/config.ts.' }, { ok: false, error: 'box-not-empty' }, { ok: true }, { ok: false, error: 'exploded' }].map(parseBtwReply),
    [{ ok: true, answer: 'In src/config.ts.' }, { ok: false, error: 'box-not-empty' }, undefined, undefined],
  );
});

/** Claude Code's AskUserQuestion dialog, as the viewer reads it off the terminal. */
const asking = {
  lines: ['Which colour do you prefer?'],
  options: [
    { key: '1', label: 'Red', detail: 'Warm', checked: undefined, current: true },
    { key: '2', label: 'Green', detail: undefined, checked: false, current: false },
  ],
  tabs: false,
};

// The page learns of a choice Claude Code waits for; a dialog it cannot read is no reason to lose the rest of the state
test('parseLiveState_Should_TakeChoiceClaudeCodeWaitsFor_And_LeaveOutOneItCannotRead', () => {
  assert.deepEqual(
    [{ state: 'live', status: 'busy', pane: 'w3D:p1', dialog: asking }, { state: 'live', status: 'busy', pane: 'w3D:p1', dialog: { lines: 'Which?' } }].map(parseLiveState),
    [
      { state: 'live', status: 'busy', pane: 'w3D:p1', dialog: asking },
      { state: 'live', status: 'busy', pane: 'w3D:p1', dialog: undefined },
    ],
  );
});

// Typed while Claude Code asks, a prompt would land in its dialog — its digits picking answers: the box waits
test('composerState_Should_HoldBox_WhileClaudeCodeAsks', () => {
  const view = composerState({ state: 'live', status: 'busy', pane: 'w3D:p1', dialog: asking }, sessionId, 'physical');

  assert.deepEqual({ enabled: view.enabled, canInterrupt: view.canInterrupt, placeholder: view.placeholder }, { enabled: false, canInterrupt: false, placeholder: 'Claude Code is asking — answer above' });
});

// A session that is not running can be opened again in herdr from the page — where it ran, or by its folder
test('composerState_Should_OfferToOpenSessionAgain_OnlyWhenItIsNotRunning', () => {
  /** @type {readonly import('../public/model/composer.js').LiveState[]} */
  const states = [{ state: 'offline' }, { state: 'live', status: 'idle', pane: 'w3D:p1', dialog: undefined }, { state: 'herdr-missing' }, { state: 'no-herdr', status: 'idle' }];

  assert.deepEqual(states.map((live) => composerState(live, sessionId, 'physical').canReopen), [true, false, false, false]);
});
