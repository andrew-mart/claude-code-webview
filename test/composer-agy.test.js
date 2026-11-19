import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComposer } from '../server/composer.js';
import { dialogPrint } from '../public/model/dialog.js';

const conversation = 'c2da1db1-1271-4baa-aac2-0f4026b2453a';
const rule = '─'.repeat(60);
const banner = ['      ▄▀▀▄        Antigravity CLI 1.5.4', '     ▀▀▀▀▀▀       ann@example.com (Google AI Pro)', '   ▄▀▀    ▀▀▄     ~/shop', ''];
/** @param {string} box */
const agyScreen = (box) => [...banner, rule, `> ${box}`.trimEnd(), rule, `? for shortcuts${' '.repeat(30)}Gemini 4 Argon · high`].join('\n');
const permission = [...banner, rule, 'Run command?', '  npm test', '', '> Allow once', '  Deny', '', '  ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command', 'esc to cancel'].join('\n');

/**
 * A fake herdr whose pane shows agy's screen: its box empty until text is typed, then with the text, until Enter takes
 * it — or a permission dialog in its place. Records the calls that change something.
 * @param {{ asking?: true, takes?: number, scrolled?: true, panel?: readonly string[] }} [options] - asking: agy asks to
 *   run a command; panel: the lines of a panel of agy's under its box — /mcp — the keys going to it; takes: the
 *   characters typed that agy's box takes between two looks at the screen — all at once if not told; scrolled: the pane
 *   scrolled up in herdr, what is in view its earlier lines, its box under them — the screen's last lines are as ever
 */
function fakeHerdr({ asking, takes = Number.POSITIVE_INFINITY, scrolled, panel } = {}) {
  let box = '';
  // typed, not in the box yet
  let coming = '';
  /** @type {string[]} */
  const changes = [];
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    const [, command, pane, argument] = args;
    const keys = args.slice(3);
    if (command === 'list') return { ok: true, json: { result: { panes: [{ agent: 'agy', pane_id: 'w2:p1' }] } }, text: '' };
    if (command === 'read') {
      box += coming.slice(0, takes);
      coming = coming.slice(takes);
      const inView = scrolled === true && args.includes('visible');
      return { ok: true, json: undefined, text: asking === true ? permission : inView ? banner.join('\n') : panel !== undefined ? [agyScreen(box), ...panel].join('\n') : agyScreen(box) };
    }
    if ((command === 'send-text' || command === 'paste-text') && argument !== undefined) coming += argument;
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
// sent now, the same; a stop is Esc, as in its terminal. The prompt goes in as a paste: typed, agy takes it a few
// characters at a time
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
      idle: ['paste-text w2:p1 Add the price filter', 'send-keys w2:p1 enter'],
      busy: ['paste-text w2:p1 Then cover it with a test', 'send-keys w2:p1 enter', 'paste-text w2:p1 Keep the old sort', 'send-keys w2:p1 enter', 'send-keys w2:p1 esc'],
    },
  );
});

// agy takes a long prompt a few characters at a time, drawing its box anew for each, when it comes typed — herdr's
// program has no paste — on Windows tens of seconds: while its box keeps growing the prompt is still coming, and Enter
// follows once its end is there
test('send_Should_WaitWhileAgyTakesALongPromptSlowly_ThenPressEnter', async () => {
  const slow = fakeHerdr({ takes: 4 });
  const prompt = 'Add the price filter to the catalogue page, the cheapest first, and keep the old sort for the admin list';

  const outcome = await composerOf({ found: 'pane', pane: 'w2:p1', working: false }, slow).send(conversation, prompt);

  assert.deepEqual({ outcome, typed: slow.changes }, { outcome: { ok: true, pane: 'w2:p1' }, typed: [`paste-text w2:p1 ${prompt}`, 'send-keys w2:p1 enter'] });
});

// agy's pane scrolled up in herdr — someone read its earlier lines there — shows its box out of view: a prompt still
// goes in, the screen's last lines read as they are
test('send_Should_TypePromptIntoAgy_ThoughItsPaneIsScrolledUp', async () => {
  const scrolled = fakeHerdr({ scrolled: true });

  const outcome = await composerOf({ found: 'pane', pane: 'w2:p1', working: false }, scrolled).send(conversation, 'Add the price filter');

  assert.deepEqual({ outcome, typed: scrolled.changes }, { outcome: { ok: true, pane: 'w2:p1' }, typed: ['paste-text w2:p1 Add the price filter', 'send-keys w2:p1 enter'] });
});

// agy rewound — its conversation and the files changed since — through its /rewind, typed into its box; not while it
// works: the keys would go into its turn
test('rewind_Should_TypeRewindIntoIdleAgy_AndNothingWhileItWorks', async () => {
  const idle = fakeHerdr();
  const busy = fakeHerdr();
  const request = { stepsUp: 1, prompt: 'Add the price filter', sentAt: undefined, action: /** @type {const} */ ('both') };

  const outcomes = [await composerOf({ found: 'pane', pane: 'w2:p1', working: true }, busy).rewind(conversation, request), await composerOf({ found: 'pane', pane: 'w2:p1', working: false }, idle).rewind(conversation, request)];

  // this agy shows no /rewind panel: the rewind gives up, nothing chosen in it
  assert.deepEqual({ outcomes, busy: busy.changes, idle: idle.changes }, { outcomes: [{ ok: false, error: 'busy' }, { ok: false, error: 'menu-not-shown' }], busy: [], idle: ['send-text w2:p1 /rewind', 'send-keys w2:p1 enter'] });
});

// agy's /mcp open under its box takes the keys, the box still on the screen: the page is told what it shows — its
// servers — and answers it with keys; a prompt is not typed into it
test('liveState_answer_And_send_Should_ShowAgysMcpServers_AnswerThemWithKeys_AndTypeNoPromptIntoThem', async () => {
  const herdr = fakeHerdr({ panel: ['MCP Servers', '>  ✓ shop-db  Tools: list_orders, +12 more', '   ✓ browser  Tools: browser_open, +30 more', 'Keyboard: ↑/↓ Navigate  enter Actions  esc Exit'] });
  const composer = composerOf({ found: 'pane', pane: 'w2:p1', working: false }, herdr);

  const live = await composer.liveState(conversation);
  const answered = await composer.answer(conversation, [{ key: 'down' }, { key: 'enter' }], live.state === 'live' && live.dialog !== undefined ? dialogPrint(live.dialog) : '', async () => []);
  const sent = await composer.send(conversation, 'Add the price filter');

  assert.deepEqual(
    { servers: live.state === 'live' ? live.dialog?.options.map((option) => option.label) : undefined, answered, sent, typed: herdr.changes },
    { servers: ['✓ shop-db', '✓ browser'], answered: { ok: true }, sent: { ok: false, error: 'asking' }, typed: ['send-keys w2:p1 down', 'send-keys w2:p1 enter'] },
  );
});

// While agy asks something — a permission, a question — a prompt is not typed: its keys would answer it. agy has no
// side question the viewer drives, and rewinds its conversation only with the files changed since: nothing is typed for
// a side question, nor for the conversation rewound alone
test('send_btw_And_rewind_Should_TypeNothingIntoAgy_WhileItAsks_OrForWhatAgyHasNot', async () => {
  const asking = fakeHerdr({ asking: true });
  const idle = fakeHerdr();
  const composer = composerOf({ found: 'pane', pane: 'w2:p1', working: false }, idle);

  const outcomes = [
    await composerOf({ found: 'pane', pane: 'w2:p1', working: false }, asking).send(conversation, 'Add the price filter'),
    await composer.btw(conversation, 'Which page is busiest?'),
    await composer.rewind(conversation, { stepsUp: 1, prompt: 'Add the price filter', sentAt: undefined, action: 'conversation' }),
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
