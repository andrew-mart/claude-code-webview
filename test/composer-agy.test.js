import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComposer } from '../server/composer.js';

const conversation = 'c2da1db1-1271-4baa-aac2-0f4026b2453a';
const rule = '─'.repeat(60);
const banner = ['      ▄▀▀▄        Antigravity CLI 1.5.4', '     ▀▀▀▀▀▀       ann@example.com (Google AI Pro)', '   ▄▀▀    ▀▀▄     ~/shop', ''];
/** @param {string} box */
const agyScreen = (box) => [...banner, rule, `> ${box}`.trimEnd(), rule, `? for shortcuts${' '.repeat(30)}Gemini 4 Argon · high`].join('\n');
const permission = [...banner, rule, 'Run command?', '  npm test', '', '> Allow once', '  Deny', '', '  ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command', 'esc to cancel'].join('\n');

/**
 * A fake herdr whose pane shows agy's screen: its box empty until text is typed, then with the text, until Enter takes
 * it — or a permission dialog in its place. Records the calls that change something.
 * @param {{ asking?: true }} [options] - asking: agy asks to run a command
 */
function fakeHerdr({ asking } = {}) {
  let box = '';
  /** @type {string[]} */
  const changes = [];
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    const [, command, pane, argument] = args;
    const keys = args.slice(3);
    if (command === 'list') return { ok: true, json: { result: { panes: [{ agent: 'agy', pane_id: 'w2:p1' }] } }, text: '' };
    if (command === 'read') return { ok: true, json: undefined, text: asking === true ? permission : agyScreen(box) };
    if (command === 'send-text' && argument !== undefined) box += argument;
    if (command === 'send-keys' && keys.includes('enter')) box = '';
    changes.push(`${command} ${pane} ${keys.join(' ')}`);
    return { ok: true, json: { result: { type: 'ok' } }, text: '' };
  };
  return { run, changes };
}

/**
 * @param {import('../server/herdr-view.js').AgentPlace} place — where agy runs the conversation
 * @param {ReturnType<typeof fakeHerdr>} herdr
 */
const composerOf = (place, herdr) => createComposer({ readRecords: async () => [], herdr: herdr.run, codexPlace: async () => ({ found: 'none' }), agyPlace: async (id) => (id === conversation ? place : { found: 'none' }) });

// An agy conversation runs in its herdr pane, at work or waiting for a prompt — what agy asks there read off its screen;
// agy holds it open outside herdr — a program's run, a terminal not told apart; or it is closed
test('liveState_Should_FindAgyConversationInItsPane_WithWhatAgyAsks_OrTellItRunsElsewhere_OrIsClosed', async () => {
  /** @type {readonly import('../server/herdr-view.js').AgentPlace[]} */
  const places = [{ found: 'pane', pane: 'w2:p1', working: true }, { found: 'pane', pane: 'w2:p1', working: false }, { found: 'elsewhere' }, { found: 'none' }];

  const states = await Promise.all(places.map((place) => composerOf(place, fakeHerdr()).liveState(conversation)));
  const asking = await composerOf({ found: 'pane', pane: 'w2:p1', working: false }, fakeHerdr({ asking: true })).liveState(conversation);

  assert.deepEqual(
    { states, asking },
    {
      states: [{ state: 'live', status: 'busy', pane: 'w2:p1', dialog: undefined, queued: [] }, { state: 'live', status: 'idle', pane: 'w2:p1', dialog: undefined, queued: [] }, { state: 'outside-herdr', status: 'idle' }, { state: 'offline' }],
      asking: {
        state: 'live',
        status: 'idle',
        pane: 'w2:p1',
        dialog: {
          lines: ['Run command?', 'npm test'],
          options: [
            { key: '', label: 'Allow once', detail: undefined, checked: undefined, current: true },
            { key: '', label: 'Deny', detail: undefined, checked: undefined, current: false },
          ],
          tabs: false,
          previews: true,
        },
        queued: [],
      },
    },
  );
});

// A prompt goes into agy's box and in with Enter, whether agy works or not — agy queues one that comes while it works;
// sent now, the same; a stop is Esc, as in its terminal
test('send_sendNow_And_interrupt_Should_TypePromptIntoAgyWithEnter_AndStopItWithEsc', async () => {
  const idle = fakeHerdr();
  const busy = fakeHerdr();

  const outcomes = [
    await composerOf({ found: 'pane', pane: 'w2:p1', working: false }, idle).send(conversation, 'Add the price filter'),
    await composerOf({ found: 'pane', pane: 'w2:p1', working: true }, busy).send(conversation, 'Then cover it with a test'),
    await composerOf({ found: 'pane', pane: 'w2:p1', working: true }, busy).sendNow(conversation, 'Keep the old sort'),
    await composerOf({ found: 'pane', pane: 'w2:p1', working: true }, busy).interrupt(conversation),
  ];

  assert.deepEqual(
    { outcomes, idle: idle.changes, busy: busy.changes },
    {
      outcomes: [{ ok: true, pane: 'w2:p1' }, { ok: true, pane: 'w2:p1' }, { ok: true, pane: 'w2:p1' }, { ok: true, pane: 'w2:p1', prompt: undefined }],
      idle: ['send-text w2:p1 Add the price filter', 'send-keys w2:p1 enter'],
      busy: ['send-text w2:p1 Then cover it with a test', 'send-keys w2:p1 enter', 'send-text w2:p1 Keep the old sort', 'send-keys w2:p1 enter', 'send-keys w2:p1 esc'],
    },
  );
});

// While agy asks something — a permission, a question — a prompt is not typed: its keys would answer it. agy has no
// side question nor rewind the viewer drives: nothing is typed for them either
test('send_btw_And_rewind_Should_TypeNothingIntoAgy_WhileItAsks_OrForWhatAgyHasNot', async () => {
  const asking = fakeHerdr({ asking: true });
  const idle = fakeHerdr();
  const composer = composerOf({ found: 'pane', pane: 'w2:p1', working: false }, idle);

  const outcomes = [
    await composerOf({ found: 'pane', pane: 'w2:p1', working: false }, asking).send(conversation, 'Add the price filter'),
    await composer.btw(conversation, 'Which page is busiest?'),
    await composer.rewind(conversation, { stepsUp: 1, prompt: 'Add the price filter', action: 'conversation' }),
  ];

  assert.deepEqual(
    { outcomes, typed: [...asking.changes, ...idle.changes] },
    {
      outcomes: [
        { ok: false, error: 'asking' },
        { ok: false, error: 'not-asked' },
        { ok: false, error: 'option-not-found' },
      ],
      typed: [],
    },
  );
});
