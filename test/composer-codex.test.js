import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComposer } from '../server/composer.js';

const thread = '01a13a06-5376-7481-9aa7-ec19297d2f7c';
const footer = ['', '  D:\\gits\\shop · main · No changes · GPT-6-Astra xhigh', '  ← for agents · ? for shortcuts'];
/** @param {string} box */
const codexScreen = (box) => ['› Add a rate limit', '', '• Added.', '', '', `› ${box}`, ...footer].join('\n');
/** What Codex shows a sub-agent's thread with, once something was typed into it. */
const subagentBanner = ['■ This sub-agent is controlled by its parent. Direct input is', 'disabled.', ''];

/**
 * A fake herdr whose pane shows Codex's screen: its box empty until text is typed, then with the text, until Enter or
 * Tab takes it — or a picker in its place. Records the calls that change something.
 * @param {{ picker?: string, stuck?: 'subagent' | 'silently', blank?: number, long?: 'pasted' | 'scrolled' }} [options] - picker:
 *   what the screen shows instead of the box; stuck: Codex takes nothing typed — a sub-agent's thread shows, saying so
 *   once something was typed, or it says nothing; blank: how many reads find the screen blank first, Codex drawing it
 *   anew; long: how a long text shows in the box — as a paste's mark, taken out whole by one backspace, or its end only,
 *   the box scrolled
 */
function fakeHerdr({ picker, stuck, blank = 0, long } = {}) {
  let blanks = blank;
  const placeholder = 'Ask Codex to do anything';
  let box = placeholder;
  let refused = false;
  /** @type {string[]} */
  const changes = [];
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    const [, command, pane, argument] = args;
    const keys = args.slice(3);
    if (command === 'list') return { ok: true, json: { result: { panes: [{ agent: 'codex', pane_id: 'w4:p1' }] } }, text: '' };
    if (command === 'read' && blanks > 0) {
      blanks -= 1;
      return { ok: true, json: undefined, text: '' };
    }
    const shown = long === 'scrolled' && box.length > 100 ? box.slice(-100) : box;
    if (command === 'read') return { ok: true, json: undefined, text: picker ?? [...(refused && stuck === 'subagent' ? subagentBanner : []), codexScreen(shown)].join('\n') };
    const typed = long === 'pasted' && argument !== undefined && argument.length > 1000 ? `[Pasted Content ${argument.length} chars]` : argument;
    if (command === 'send-text' && typed !== undefined) box = box === placeholder ? typed : box + typed;
    if (command === 'send-keys' && (keys.includes('enter') || keys.includes('tab'))) {
      if (stuck === undefined) box = placeholder;
      else refused = true;
    }
    const erased = keys.filter((key) => key === 'backspace').length;
    const paste = /\[Pasted Content \d+ chars\]$/.exec(box);
    if (command === 'send-keys' && erased > 0 && paste !== null) box = box.slice(0, -paste[0].length) === '' ? placeholder : box.slice(0, -paste[0].length);
    else if (command === 'send-keys' && erased > 0) box = box.slice(0, -erased) === '' ? placeholder : box.slice(0, -erased);
    changes.push(command === 'send-keys' && erased > 0 ? `send-keys ${pane} backspace ×${erased}` : `${command} ${pane} ${keys.join(' ')}`);
    return { ok: true, json: { result: { type: 'ok' } }, text: '' };
  };
  return { run, changes, box: () => box };
}

/**
 * @param {import('../server/herdr-view.js').CodexPlace} place — where the Codex session runs
 * @param {ReturnType<typeof fakeHerdr>} herdr
 */
const composerOf = (place, herdr) => createComposer({ readRecords: async () => [], herdr: herdr.run, codexPlace: async (id) => (id === thread ? place : { found: 'none' }) });

// A Codex session runs in its herdr pane, at work or waiting for a prompt; Codex has it open outside herdr; or it is closed
test('liveState_Should_FindCodexSessionInItsPane_OrTellItRunsElsewhere_OrIsClosed', async () => {
  const herdr = fakeHerdr();
  /** @type {readonly import('../server/herdr-view.js').CodexPlace[]} */
  const places = [{ found: 'pane', pane: 'w4:p1', working: true }, { found: 'pane', pane: 'w4:p1', working: false }, { found: 'elsewhere' }, { found: 'none' }];

  assert.deepEqual(await Promise.all(places.map((place) => composerOf(place, herdr).liveState(thread))), [
    { state: 'live', status: 'busy', pane: 'w4:p1', dialog: undefined, queued: [] },
    { state: 'live', status: 'idle', pane: 'w4:p1', dialog: undefined, queued: [] },
    { state: 'outside-herdr', status: 'idle' },
    { state: 'offline' },
  ]);
});

// A prompt goes into Codex's box and, once the box shows it, is sent with Enter; while Codex works, Tab queues it for
// the next turn — Enter would put it into the turn under way
test('send_Should_SendPromptToCodexWithEnter_OrQueueItWithTabWhileCodexWorks', async () => {
  const idle = fakeHerdr();
  const busy = fakeHerdr();

  const outcomes = [
    await composerOf({ found: 'pane', pane: 'w4:p1', working: false }, idle).send(thread, 'Cover the limit with a test'),
    await composerOf({ found: 'pane', pane: 'w4:p1', working: true }, busy).send(thread, 'Then update the docs'),
  ];

  assert.deepEqual(
    { outcomes, idle: idle.changes, busy: busy.changes },
    {
      outcomes: [
        { ok: true, pane: 'w4:p1' },
        { ok: true, pane: 'w4:p1' },
      ],
      idle: ['send-text w4:p1 Cover the limit with a test', 'send-keys w4:p1 enter'],
      busy: ['send-text w4:p1 Then update the docs', 'send-keys w4:p1 tab'],
    },
  );
});

// Sent now, a prompt goes into the turn under way — Enter in Codex's box; a stop is Esc, as in its terminal
test('sendNow_And_interrupt_Should_SteerCodexsTurnWithEnter_AndStopItWithEsc', async () => {
  const herdr = fakeHerdr();
  const composer = composerOf({ found: 'pane', pane: 'w4:p1', working: true }, herdr);

  const outcomes = [await composer.sendNow(thread, 'Use the existing limiter'), await composer.interrupt(thread)];

  assert.deepEqual(
    { outcomes, changes: herdr.changes },
    {
      outcomes: [
        { ok: true, pane: 'w4:p1' },
        { ok: true, pane: 'w4:p1', prompt: undefined },
      ],
      changes: ['send-text w4:p1 Use the existing limiter', 'send-keys w4:p1 enter', 'send-keys w4:p1 esc'],
    },
  );
});

// While Codex asks something in its terminal — an update offer, a picker, its chosen option marked as its box is — a
// prompt is not typed: its Enter would pick the option
test('send_Should_NotTypeIntoCodex_WhileItAsksSomethingInItsTerminal', async () => {
  const herdr = fakeHerdr({ picker: ['  Update available · 0.162.0 → 0.162.1', '› 1. Update now (runs `npm install -g @openai/codex`)', '  2. Skip', '  enter continue · esc skip'].join('\n') });
  const composer = composerOf({ found: 'pane', pane: 'w4:p1', working: false }, herdr);

  const outcomes = [await composer.send(thread, 'Cover the limit with a test'), await composer.sendNow(thread, 'Use the existing limiter')];

  assert.deepEqual({ outcomes, changes: herdr.changes }, { outcomes: [{ ok: false, error: 'asking' }, { ok: false, error: 'asking' }], changes: [] });
});

// What Codex asks shows on the page with its options, and is answered from there — the keys go to its terminal; with
// its box back on the screen, nothing is asked and nothing is answered
test('liveState_And_answer_Should_ShowWhatCodexAsks_AndAnswerItFromThePage', async () => {
  const asking = fakeHerdr({ picker: ['  Trust this folder?', '', '› 1. Trust and continue', '  2. Quit', '', '  enter continue · esc quit'].join('\n') });
  const typing = fakeHerdr();
  const place = /** @type {const} */ ({ found: 'pane', pane: 'w4:p1', working: false });

  const live = await composerOf(place, asking).liveState(thread);
  const answered = await composerOf(place, asking).answer(thread, [{ key: 'down' }, { key: 'enter' }]);
  const notAsked = await composerOf(place, typing).answer(thread, [{ key: 'enter' }]);

  assert.deepEqual(
    { dialog: live.state === 'live' ? live.dialog?.options.map((option) => option.label) : undefined, answered, notAsked, keys: asking.changes, untouched: typing.changes },
    { dialog: ['Trust and continue', 'Quit'], answered: { ok: true }, notAsked: { ok: false, error: 'no-dialog' }, keys: ['send-keys w4:p1 down', 'send-keys w4:p1 enter'], untouched: [] },
  );
});

// A long prompt Codex does not take is taken out as well: Codex shows a long paste by its mark, which goes whole, or the
// end of a long text, its box scrolled
test('send_Should_TakeLongPromptBackOut_When_CodexDoesNotTakeIt', async () => {
  const long = 'word '.repeat(300).trim();
  const pasted = fakeHerdr({ stuck: 'silently', long: 'pasted' });
  const scrolled = fakeHerdr({ stuck: 'silently', long: 'scrolled' });
  const place = /** @type {const} */ ({ found: 'pane', pane: 'w4:p1', working: false });

  const outcomes = [await composerOf(place, pasted).send(thread, long), await composerOf(place, scrolled).send(thread, long)];

  assert.deepEqual({ outcomes, boxes: [pasted.box(), scrolled.box()] }, { outcomes: [{ ok: false, error: 'not-taken' }, { ok: false, error: 'not-taken' }], boxes: ['Ask Codex to do anything', 'Ask Codex to do anything'] });
});

// A prompt Codex does not take — it shows a sub-agent's thread, whose input its parent controls, or Enter does nothing
// — is not left in its box to be joined by the next one: it is taken out again, and the page is told; once Codex says
// it shows a sub-agent, nothing is typed at all
test('send_Should_TakePromptBackOutOfCodexsBox_When_CodexDoesNotTakeIt', async () => {
  const subagent = fakeHerdr({ stuck: 'subagent' });
  const silent = fakeHerdr({ stuck: 'silently' });
  // its box says so as well, before anything is typed
  const viewing = fakeHerdr({ picker: codexScreen('Viewing sub-agent — direct input is disabled') });
  const place = /** @type {const} */ ({ found: 'pane', pane: 'w4:p1', working: false });

  const outcomes = [
    await composerOf(place, subagent).send(thread, 'unity installed'),
    await composerOf(place, subagent).send(thread, 'all installed'),
    await composerOf(place, silent).send(thread, 'unity installed'),
    await composerOf(place, viewing).send(thread, 'unity installed'),
  ];

  assert.deepEqual(
    { outcomes, subagent: subagent.changes, viewing: viewing.changes, boxes: [subagent.box(), silent.box()] },
    {
      outcomes: [
        { ok: false, error: 'not-taken' },
        { ok: false, error: 'subagent' },
        { ok: false, error: 'not-taken' },
        { ok: false, error: 'subagent' },
      ],
      subagent: ['send-text w4:p1 unity installed', 'send-keys w4:p1 enter', 'send-keys w4:p1 backspace ×15'],
      viewing: [],
      boxes: ['Ask Codex to do anything', 'Ask Codex to do anything'],
    },
  );
});

// While Codex's terminal shows a sub-agent's thread, the page is told at once, not on the next prompt
test('liveState_Should_TellCodexShowsSubagent', async () => {
  const viewing = fakeHerdr({ picker: codexScreen('Viewing sub-agent — direct input is disabled') });

  const live = await composerOf({ found: 'pane', pane: 'w4:p1', working: false }, viewing).liveState(thread);

  assert.deepEqual(live, { state: 'live', status: 'subagent', pane: 'w4:p1', dialog: undefined, queued: [] });
});

// Codex rewinds the conversation alone — its files stay as they are: restoring code is refused before any key, as is a
// rewind while Codex works or shows a sub-agent's thread
test('rewind_Should_RefuseWhatCodexCannotRewind_BeforeAnyKey', async () => {
  const idle = fakeHerdr();
  const busy = fakeHerdr();
  const viewing = fakeHerdr({ picker: codexScreen('Viewing sub-agent — direct input is disabled') });
  const at = /** @param {boolean} working */ (working) => /** @type {const} */ ({ found: 'pane', pane: 'w4:p1', working });

  const replies = [
    await composerOf(at(false), idle).rewind(thread, { stepsUp: 1, prompt: 'Add a rate limit', action: 'both' }),
    await composerOf(at(true), busy).rewind(thread, { stepsUp: 1, prompt: 'Add a rate limit', action: 'conversation' }),
    await composerOf(at(false), viewing).rewind(thread, { stepsUp: 1, prompt: 'Add a rate limit', action: 'conversation' }),
  ];

  assert.deepEqual({ replies, keys: [...idle.changes, ...busy.changes, ...viewing.changes] }, { replies: [{ ok: false, error: 'option-not-found' }, { ok: false, error: 'busy' }, { ok: false, error: 'subagent' }], keys: [] });
});

// Left in a side conversation — its /btw — Codex's terminal would take a prompt for a follow-up question: the page is
// told, and nothing is typed
test('liveState_And_send_Should_TellCodexShowsSideConversation', async () => {
  const side = fakeHerdr({ picker: ['› which word?', '• one', '  Worked for 8s • 8:00 PM', '', '› Ask a follow-up question', '', '  ~ · GPT-6-Astra low', '  Side from main thread · ctrl+/ to switch'].join('\n') });
  const place = /** @type {const} */ ({ found: 'pane', pane: 'w4:p1', working: false });

  const live = await composerOf(place, side).liveState(thread);
  const sent = await composerOf(place, side).send(thread, 'Now the levels');

  assert.deepEqual({ status: live.state === 'live' ? live.status : undefined, sent, keys: side.changes }, { status: 'side', sent: { ok: false, error: 'side' }, keys: [] });
});

// A screen Codex is drawing anew — after a side conversation, a resize — shows no box for a moment: the prompt waits for
// it, it is not refused as though Codex asked something
test('send_Should_WaitForCodexsBox_WhileItDrawsItsScreenAnew', async () => {
  const herdr = fakeHerdr({ blank: 2 });

  const sent = await composerOf({ found: 'pane', pane: 'w4:p1', working: false }, herdr).send(thread, 'Now the levels');

  assert.deepEqual({ sent, keys: herdr.changes }, { sent: { ok: true, pane: 'w4:p1' }, keys: ['send-text w4:p1 Now the levels', 'send-keys w4:p1 enter'] });
});

// What Codex queued to send next — Tab while it works — comes with its live state, for the page to show
test('liveState_Should_TellWhatCodexQueued', async () => {
  const queued = fakeHerdr({ picker: ['Working (7s • esc to interrupt)', '• Queued follow-up inputs', '  ↳ Then update the docs.', '    shift+← edit last queued message', '› Ask Codex to do anything', ...footer].join('\n') });

  const live = await composerOf({ found: 'pane', pane: 'w4:p1', working: true }, queued).liveState(thread);

  assert.deepEqual(live, { state: 'live', status: 'busy', pane: 'w4:p1', dialog: undefined, queued: ['Then update the docs.'] });
});
