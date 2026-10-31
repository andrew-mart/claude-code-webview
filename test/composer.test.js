import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComposer } from '../server/composer.js';

const sessionId = '7d4e1b20-2222-4333-8444-955566667777';
const record = { pid: 94168, sessionId, kind: 'interactive', status: 'busy', updatedAt: 1791541557691 };

/**
 * A fake herdr: two panes with Claude, the target one is w3D:p1 with process 94168. Records every call.
 * fail — herdr is installed but does not answer; missing — herdr is not installed at all; screens — what the pane
 * shows, one per read, the last one stays; runsIn — the pane process 94168 runs in now.
 * @param {{ fail?: boolean, missing?: boolean, screens?: readonly string[], runsIn?: () => string }} [options]
 */
function fakeHerdr({ fail = false, missing = false, screens = [''], runsIn = () => 'w3D:p1' } = {}) {
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
    if (command === 'process-info') return { ok: true, json: { result: { process_info: { foreground_processes: [{ pid: pane === runsIn() ? 94168 : 555 }] } } }, text: '' };
    return { ok: true, json: { result: { type: 'ok' } }, text: '' };
  };
  return { run, calls };
}

/** @param {readonly unknown[]} records @param {ReturnType<typeof fakeHerdr>} herdr */
const composerOf = (records, herdr) => createComposer({ readRecords: async () => records, herdr: herdr.run, codexPlace: async () => ({ found: 'none' }) });

test('liveState_Should_FindPaneWhereSessionRuns', async () => {
  const herdr = fakeHerdr();

  assert.deepEqual(await composerOf([record], herdr).liveState(sessionId), { state: 'live', status: 'busy', pane: 'w3D:p1', dialog: undefined, queued: [] });
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
  assert.deepEqual(herdr.calls.filter(([, command]) => command === 'send-text' || command === 'send-keys'), [
    ['pane', 'send-text', 'w3D:p1', 'first\nsecond'],
    ['pane', 'send-keys', 'w3D:p1', 'enter'],
  ]);
});

// A long text comes into Claude Code as a paste, and an Enter that comes while it is still being pasted joins it as a
// line break — nothing is sent. Enter waits until the prompt box shows the text
test('send_Should_PressEnter_OnceTextHasLandedInPromptBox', async () => {
  const box = (/** @type {string} */ text) => ['● Done.', '────────', `❯ ${text}`, '────────'].join('\n');
  // the box before typing, as it is typed into, and with the paste in it
  const herdr = fakeHerdr({ screens: [box(''), box(''), box('[Pasted text #1 +40 lines]'), box('')] });
  const long = Array.from({ length: 40 }, (_, line) => `line ${line} of a long text`).join('\n');

  await composerOf([record], herdr).send(sessionId, long);

  const commands = herdr.calls.map(([, command]) => command);
  // the box looked at once more after Enter: it let the prompt go
  assert.deepEqual(commands.slice(commands.indexOf('send-text')), ['send-text', 'read', 'read', 'send-keys', 'read']);
});

// Claude Code's send-now key (Ctrl+X Ctrl+S, the spelling of Ctrl+Enter every terminal passes on) sends what waits in
// its queue at once, the box's text with it: the text goes into the box without Enter, which would only queue it; with no
// text the queue goes alone
test('sendNow_Should_TypeTextAndPressSendNowKey', async () => {
  const herdr = fakeHerdr();
  const composer = composerOf([record], herdr);

  const outcomes = [await composer.sendNow(sessionId, 'stop and check the logs'), await composer.sendNow(sessionId, '  ')];

  assert.deepEqual(outcomes, [{ ok: true, pane: 'w3D:p1' }, { ok: true, pane: 'w3D:p1' }]);
  assert.deepEqual(herdr.calls.filter((call) => call[1] === 'send-text' || call[1] === 'send-keys'), [
    ['pane', 'send-text', 'w3D:p1', 'stop and check the logs'],
    ['pane', 'send-keys', 'w3D:p1', 'ctrl+x'],
    ['pane', 'send-keys', 'w3D:p1', 'ctrl+s'],
    ['pane', 'send-keys', 'w3D:p1', 'ctrl+x'],
    ['pane', 'send-keys', 'w3D:p1', 'ctrl+s'],
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
  const sent = box('Explain the failing\n  test in detail');
  // the box before typing; the send waits for its text in it, and for the box to let it go after Enter; then the box
  // before Esc, the prompt given back into it, the box cleared
  const herdr = fakeHerdr({ screens: [box(''), sent, box(''), box(''), sent, box('')] });
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

// A process's number goes to another once it is gone: a session of a new process under an old one's number is looked for
// anew — its prompt goes to its own pane, not to the one the old process ran in
test('send_Should_FindPaneAnew_When_ProcessNumberIsTakenByAnotherClaude', async () => {
  let runsIn = 'w3D:p1';
  let records = [{ ...record, startedAt: 1000 }];
  const herdr = fakeHerdr({ runsIn: () => runsIn });
  const composer = createComposer({ readRecords: async () => records, herdr: herdr.run, codexPlace: async () => ({ found: 'none' }) });
  const later = '9b1c2d30-1111-4222-8333-944455556666';

  const first = await composer.send(sessionId, 'one');
  runsIn = 'w2:p1';
  records = [{ ...record, sessionId: later, startedAt: 2000 }];
  const second = await composer.send(later, 'two');

  assert.deepEqual([first, second], [{ ok: true, pane: 'w3D:p1' }, { ok: true, pane: 'w2:p1' }]);
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
  const composer = createComposer({ readRecords: async () => [record], herdr: mismatch, codexPlace: async () => ({ found: 'none' }) });

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

/**
 * herdr in front of Claude Code with /btw: the session's pane shows the prompt box, or after Enter on "/btw …" the side
 * panel with its answer, until Esc closes it. Records every call.
 * @param {string} answer
 * @param {string} [suggested] - a reply Claude Code suggests in its empty box: dim when read in ansi, read as text it
 *   looks typed
 * @param {string} [open] - a side question whose panel is open already, asked before
 */
function sidePanelHerdr(answer, suggested = '', open = undefined) {
  const herdr = fakeHerdr();
  let box = '';
  /** @type {string | undefined} */
  let asked = open;
  /** @param {'ansi' | 'text'} format */
  const shownInBox = (format) => (box !== '' || suggested === '' ? box : format === 'ansi' ? `\u001b[2m${suggested}\u001b[0m` : suggested);
  const screen = (/** @type {'ansi' | 'text'} */ format) =>
    asked === undefined
      ? ['● Done.', '────────', `❯ ${shownInBox(format)}`, '────────'].join('\n')
      : ['● Done.', '▔'.repeat(20), `    /btw ${asked}`, `      ${answer}`, '    ↑/↓ to scroll · c to copy · f to fork · Esc to close'].join('\n');
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    const [, command, , ...rest] = args;
    if (command === 'read') {
      herdr.calls.push([...args]);
      return { ok: true, json: undefined, text: screen(args.includes('ansi') ? 'ansi' : 'text') };
    }
    if (command === 'send-text') box += rest.join('');
    for (const key of command === 'send-keys' ? rest : []) {
      if (key === 'enter' && box.startsWith('/btw ')) asked = box.slice('/btw '.length);
      if (key === 'enter') box = '';
      if (key === 'esc') asked = undefined;
    }
    return herdr.run(args);
  };
  return { run, calls: herdr.calls };
}

/** What was typed into the pane: text and keys, in order. @param {readonly string[][]} calls */
const typedInto = (calls) => calls.filter(([, command]) => command === 'send-text' || command === 'send-keys').flatMap(([, , , ...typed]) => typed);

// A side question goes to the session's own terminal as /btw, and its answer comes back from the side panel
test('btw_Should_AskInSessionPane_And_GiveAnswerFromSidePanel', async () => {
  const herdr = sidePanelHerdr('The limit is in src/config.ts.');

  const outcome = await composerOf([record], herdr).btw(sessionId, 'where is the retry limit?');

  assert.deepEqual({ outcome, typed: typedInto(herdr.calls) }, { outcome: { ok: true, answer: 'The limit is in src/config.ts.' }, typed: ['/btw where is the retry limit?', 'enter', 'down', 'esc'] });
});

// An empty box showing a reply Claude Code suggests — dim, Tab takes it — is empty: the side question goes, the
// suggestion giving way to it as to anything typed
test('btw_Should_Ask_When_BoxShowsOnlyClaudeCodesSuggestion', async () => {
  const herdr = sidePanelHerdr('The limit is in src/config.ts.', 'да, запускай тесты');

  const outcome = await composerOf([record], herdr).btw(sessionId, 'where is the retry limit?');

  assert.deepEqual({ outcome, typed: typedInto(herdr.calls) }, { outcome: { ok: true, answer: 'The limit is in src/config.ts.' }, typed: ['/btw where is the retry limit?', 'enter', 'down', 'esc'] });
});

// The page lost its request while Claude answered and asks again: the question still answered here is joined — asked
// once, its one answer given to both
test('resumeBtw_Should_JoinQuestionStillAnswered', async () => {
  const herdr = sidePanelHerdr('The limit is in src/config.ts.');
  const composer = composerOf([record], herdr);

  const outcomes = await Promise.all([composer.btw(sessionId, 'where is the retry limit?'), composer.resumeBtw(sessionId, 'where is the retry limit?')]);

  assert.deepEqual({ outcomes, typed: typedInto(herdr.calls) }, { outcomes: [{ ok: true, answer: 'The limit is in src/config.ts.' }, { ok: true, answer: 'The limit is in src/config.ts.' }], typed: ['/btw where is the retry limit?', 'enter', 'down', 'esc'] });
});

// The viewer restarted while Claude answered: asked again, the answer is read off the panel still open for the question,
// nothing typed — none open for it, it says so
test('resumeBtw_Should_ReadPanelStillOpen_When_ViewerRestartedMeanwhile', async () => {
  const open = sidePanelHerdr('The limit is in src/config.ts.', '', 'where is the retry limit?');
  const closed = sidePanelHerdr('The limit is in src/config.ts.');

  const outcomes = [await composerOf([record], open).resumeBtw(sessionId, 'where is the retry limit?'), await composerOf([record], closed).resumeBtw(sessionId, 'where is the retry limit?')];

  assert.deepEqual({ outcomes, typed: [typedInto(open.calls), typedInto(closed.calls)] }, { outcomes: [{ ok: true, answer: 'The limit is in src/config.ts.' }, { ok: false, error: 'panel-closed' }], typed: [['down', 'esc'], []] });
});

// A side panel left open in the terminal — a side question the page gave up on, an answer read there — covers the box and
// would take the prompt's keys as its own: it is closed first, then the prompt typed
test('send_Should_CloseSidePanelLeftOpen_ThenType', async () => {
  const herdr = sidePanelHerdr('The limit is in src/config.ts.', '', 'where is the retry limit?');

  const outcome = await composerOf([record], herdr).send(sessionId, 'fix the flaky test');

  assert.deepEqual({ outcome, typed: typedInto(herdr.calls) }, { outcome: { ok: true, pane: 'w3D:p1' }, typed: ['esc', 'fix the flaky test', 'enter'] });
});

// Claude Code may take an Enter that comes right after a long paste for none: the prompt stays in its box. Enter is
// pressed again until the box lets the prompt go — sent, or queued
test('send_Should_PressEnterAgain_When_ClaudeCodeLeftPromptInItsBox', async () => {
  const box = (/** @type {string} */ typed) => ['● Done.', '────────', `❯ ${typed}`, '────────'].join('\n');
  const typed = 'nothing extra in the porridge, it seems';
  // the box before typing, with the text; after the first Enter still with it, after the second empty
  const herdr = fakeHerdr({ screens: [box(''), box(typed), ...Array.from({ length: 8 }, () => box(typed)), box('')] });

  const outcome = await composerOf([record], herdr).send(sessionId, typed);

  assert.deepEqual({ outcome, typed: typedInto(herdr.calls) }, { outcome: { ok: true, pane: 'w3D:p1' }, typed: [typed, 'enter', 'enter'] });
});

// The prompt still in the box after Enter thrice: the page is told it was not sent — the terminal holds it — to keep it
test('send_Should_RefuseAsNotSent_When_PromptStaysInBoxAfterEnters', async () => {
  const box = (/** @type {string} */ typed) => ['● Done.', '────────', `❯ ${typed}`, '────────'].join('\n');
  const herdr = fakeHerdr({ screens: [box(''), box('fix the flaky test')] });

  const outcome = await composerOf([record], herdr).send(sessionId, 'fix the flaky test');

  assert.deepEqual({ outcome, typed: typedInto(herdr.calls) }, { outcome: { ok: false, error: 'not-sent' }, typed: ['fix the flaky test', 'enter', 'enter', 'enter'] });
});

// The box in view, and the text typed never shows in it — something on the screen took the keys, a dialog over the box:
// Enter is not pressed, and the page is told the prompt was not typed, to keep it
test('send_Should_NotPressEnter_When_TextNeverShowsInBox', async () => {
  const box = ['● Done.', '────────', '❯ ', '────────'].join('\n');
  const herdr = fakeHerdr({ screens: [box] });

  const outcome = await composerOf([record], herdr).send(sessionId, 'fix the flaky test');

  assert.deepEqual({ outcome, typed: typedInto(herdr.calls) }, { outcome: { ok: false, error: 'not-typed' }, typed: ['fix the flaky test'] });
});

// The keys of a prompt typed into an open side panel would be the panel's own (f forks, c copies): the prompt waits
test('send_Should_WaitUntilSidePanelIsClosed', async () => {
  const herdr = sidePanelHerdr('The limit is in src/config.ts.');
  const composer = composerOf([record], herdr);

  await Promise.all([composer.btw(sessionId, 'where is the retry limit?'), composer.send(sessionId, 'fix the flaky test')]);

  assert.deepEqual(typedInto(herdr.calls), ['/btw where is the retry limit?', 'enter', 'down', 'esc', 'fix the flaky test', 'enter']);
});

// Claude Code asking — its AskUserQuestion dialog in the session's pane — is part of what the page learns about it
test('liveState_Should_TellChoiceClaudeCodeWaitsFor', async () => {
  const asking = ['● Let me ask.', '─'.repeat(40), 'Which colour do you prefer?', '❯ 1. Red', '  2. Green', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel'].join('\n');
  const herdr = fakeHerdr({ screens: [asking] });

  const live = await composerOf([record], herdr).liveState(sessionId);

  assert.deepEqual(live, {
    state: 'live',
    status: 'busy',
    pane: 'w3D:p1',
    dialog: {
      lines: ['Which colour do you prefer?'],
      options: [
        { key: '1', label: 'Red', detail: undefined, checked: undefined, current: true },
        { key: '2', label: 'Green', detail: undefined, checked: undefined, current: false },
      ],
      tabs: false,
      previews: false,
    },
    queued: [],
  });
});

/** Claude Code's AskUserQuestion dialog in the session's pane. */
const askingScreen = ['● Let me ask.', '─'.repeat(40), 'Which colour do you prefer?', '❯ 1. Red', '  2. Green', '  3. Type something.', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel'].join('\n');

// An answer from the page is the keys and text the terminal would get: the digit of a choice, or "Type something",
// the words, Enter
test('answer_Should_TypeAnswerIntoDialog_StepByStep', async () => {
  const herdr = fakeHerdr({ screens: [askingScreen] });

  const outcome = await composerOf([record], herdr).answer(sessionId, [{ key: '3' }, { text: 'Purple' }, { key: 'enter' }]);

  assert.deepEqual({ outcome, typed: typedInto(herdr.calls) }, { outcome: { ok: true }, typed: ['3', 'Purple', 'enter'] });
});

// The dialog may be gone — answered in the terminal: then the digits would be typed into the prompt box as text
test('answer_Should_TypeNothing_When_NoDialogIsShown', async () => {
  const herdr = fakeHerdr({ screens: [['● Done.', '────────', '❯ ', '────────'].join('\n')] });

  const outcome = await composerOf([record], herdr).answer(sessionId, [{ key: '2' }]);

  assert.deepEqual({ outcome, typed: typedInto(herdr.calls) }, { outcome: { ok: false, error: 'no-dialog' }, typed: [] });
});
