import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agyDialog, agyInputBox } from '../server/agy-screen.js';

const banner = ['      ▄▀▀▄        Antigravity CLI 1.5.4', '     ▀▀▀▀▀▀       ann@example.com (Google AI Pro)', '    ▀▀▀▀▀▀▀▀      Gemini 4 Argon (High)', '   ▄▀▀    ▀▀▄     ~/shop', '  ▄▀▀      ▀▀▄', ''];
const rule = '─'.repeat(60);
const footer = `? for shortcuts${' '.repeat(30)}Gemini 4 Argon · high`;

/** A screen of agy's: its banner, then these lines. @param {readonly string[]} lines */
const screenOf = (lines) => [...banner, ...lines].join('\n');

// agy's prompt box, between two rules, its line opened by ">": what is typed there — none while a dialog takes its
// place; the slash menu under it is no box, nor is it what asks
test('agyInputBox_Should_ReadPromptBoxBetweenRules_NoneWhileDialogAsks', () => {
  const idle = screenOf([rule, '>', rule, footer]);
  const typed = screenOf([rule, '> add the price filter to the catalog', rule, footer]);
  const slashMenu = screenOf([rule, '> /config', rule, '> /config  Open settings panel', '', '  ↑/↓ Navigate · enter Select · tab Complete', `esc to cancel${' '.repeat(30)}Gemini 4 Argon · high`]);
  const asking = screenOf([rule, 'Run command?', '  npm test', '', '> Allow once', '  Deny', '', '  ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command', 'esc to cancel']);

  assert.deepEqual(
    { boxes: [agyInputBox(idle), agyInputBox(typed), agyInputBox(slashMenu), agyInputBox(asking)], dialog: agyDialog(slashMenu) },
    { boxes: ['', 'add the price filter to the catalog', '/config', undefined], dialog: undefined },
  );
});

// A message sent stays on agy's screen as it was typed — a rule, its line opened by ">" — and agy's own lines follow it:
// it is no box, whatever rule comes under it; the box is where only the typed text is between two rules
test('agyInputBox_Should_TakeNoSentMessageForTheBox', () => {
  const echo = [rule, '> add the price filter to the catalog', '  and cover it with a test', '', '● Explored 1 file (catalog.md)', '● Ran (npm test)'];
  const working = screenOf([...echo, '⠋ Running the tests', rule, '>', rule, 'esc to cancel']);
  const drawingTool = screenOf([...echo, 'Command', rule, '  npm test']);

  assert.deepEqual([agyInputBox(working), agyInputBox(drawingTool)], ['', undefined]);
});

// What agy asks, in place of its box, over a row of the keys that answer it: what it says above its choices — the
// command to run, the question — and the choices, the chosen one marked ">" and each one's note beside it; answered
// with the arrows and Enter. A permission, a question it may be skipped, the trust in a folder alike
test('agyDialog_Should_ReadWhatAgyAsks_ItsChoicesAnsweredWithArrows', () => {
  const permission = screenOf([rule, 'Run command?', '  npm test -- --watch=false', '', '  Allow once', '> Allow for this conversation', '  Deny', '', '  ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command', 'esc to cancel']);
  const question = screenOf([rule, 'Which catalog page gets the filter?', '', '> 1. Shoes    the busiest page', '  2. Bags', '', '  ↑/↓ Navigate · enter Select · esc Skip', 'esc to cancel']);
  const trust = screenOf(['Do you trust the contents of this project?', 'agy may read and run files in ~/shop.', '', '> Yes, I trust this folder', '  No, exit', '', '  ↑/↓ Navigate · enter Confirm']);

  assert.deepEqual([agyDialog(permission), agyDialog(question), agyDialog(trust)], [
    {
      lines: ['Run command?', 'npm test -- --watch=false'],
      options: [
        { key: '', label: 'Allow once', detail: undefined, checked: undefined, current: false },
        { key: '', label: 'Allow for this conversation', detail: undefined, checked: undefined, current: true },
        { key: '', label: 'Deny', detail: undefined, checked: undefined, current: false },
      ],
      tabs: false,
      previews: true,
    },
    {
      lines: ['Which catalog page gets the filter?'],
      options: [
        { key: '', label: 'Shoes', detail: 'the busiest page', checked: undefined, current: true },
        { key: '', label: 'Bags', detail: undefined, checked: undefined, current: false },
      ],
      tabs: false,
      previews: true,
    },
    {
      lines: ['Do you trust the contents of this project?', 'agy may read and run files in ~/shop.'],
      options: [
        { key: '', label: 'Yes, I trust this folder', detail: undefined, checked: undefined, current: true },
        { key: '', label: 'No, exit', detail: undefined, checked: undefined, current: false },
      ],
      tabs: false,
      previews: true,
    },
  ]);
});

// agy asks several questions one after another: each "Question n/m" under a head of its own, ← and → going back to the
// one before and on to the next, as the keys' row tells — the first one has no way back, the last one none on — and
// the questions' choices answered as a single question's are
test('agyDialog_Should_ReadOneOfSeveralQuestions_GoneBetweenWithArrows', () => {
  /** @param {string} keys */
  const question = (keys) => screenOf(['? Who comes to the meeting?', '? What is it for?', '', 'Question', rule, '', 'Question 2/3: What is it for?', '', '> 1. (Recommended) Agree on a pilot', '  2. A demo only', '  3. Write-in...', '', `  ${keys}`, 'esc to cancel']);
  const options = [
    { key: '', label: '(Recommended) Agree on a pilot', detail: undefined, checked: undefined, current: true },
    { key: '', label: 'A demo only', detail: undefined, checked: undefined, current: false },
    { key: '', label: 'Write-in...', detail: undefined, checked: undefined, current: false },
  ];

  assert.deepEqual(
    ['↑/↓ Navigate · → Next · enter Select · esc Skip', '↑/↓ Navigate · ← Back · → Next · enter Select · esc Skip', '↑/↓ Navigate · ← Back · enter Select · esc Skip'].map((keys) => agyDialog(question(keys))),
    [
      { lines: ['Question 2/3: What is it for?'], options, tabs: true, previews: true },
      { lines: ['Question 2/3: What is it for?'], options, tabs: true, previews: true },
      { lines: ['Question 2/3: What is it for?'], options, tabs: true, previews: true },
    ],
  );
});

// A question of several answers: each choice ticked or not — "[ ]", "[x]" — Space ticking the one under the cursor,
// Enter doing what the keys' row names, sending them all; a choice too long for the screen goes on in the line under
// it, from the line's start, and is one choice; one of the questions' own words has no box to tick
test('agyDialog_Should_ReadQuestionOfSeveralAnswers_TickedWithSpace_LongChoicesWhole', () => {
  const screen = screenOf([
    '? Which repository?',
    '? How are the pictures made?',
    '',
    'Question',
    rule,
    '',
    'Question 2/2: How are the pictures made?',
    '',
    '> 1. [ ] (Recommended) Taken by a script on a demo collection with the interface in English, the export',
    'formats too',
    '  2. [x] Taken by hand',
    '  3. Write-in...',
    '',
    '  ↑/↓ Navigate · ← Back · space Toggle · enter Submit All · esc Skip',
    'esc to cancel',
  ]);

  assert.deepEqual(agyDialog(screen), {
    lines: ['Question 2/2: How are the pictures made?'],
    options: [
      { key: '', label: '(Recommended) Taken by a script on a demo collection with the interface in English, the export formats too', detail: undefined, checked: false, current: true },
      { key: '', label: 'Taken by hand', detail: undefined, checked: true, current: false },
      { key: '', label: 'Write-in...', detail: undefined, checked: undefined, current: false },
    ],
    tabs: true,
    previews: true,
    toggles: { enter: 'Submit All' },
  });
});

/** agy's /mcp, drawn under its prompt box — still on the screen, keys going to the panel — over its keys' row. */
const mcpPanel = (/** @type {readonly string[]} */ lines, /** @type {string} */ keys) =>
  screenOf([rule, '>', rule, 'MCP Servers', 'Plugins (~/.gemini/config/plugins)', ...lines, keys, `${' '.repeat(40)}Gemini 4 Argon · high`]);

// /mcp shows agy's MCP servers under its box: each row a server's state and name, its tools after a gap, the chosen
// one marked ">" — gone along with ↑/↓, Enter opening its actions; the actions in a row under it, the chosen one in
// brackets — gone along with ←/→, Enter doing it, Esc back to the servers. While it shows, the box takes no keys
test('agyMcp_Should_ReadServersAndTheirActions_AsWhatAgyAsks_TheBoxTakingNoKeysMeanwhile', () => {
  const servers = [
    '>  ✓ shop-db  Tools: list_orders, refund_order, +12 more',
    '   ✓ browser  Tools: browser_open, browser_click, +30 more',
    '   ⣯ notes  initializing...',
  ];
  const list = mcpPanel(servers, 'Keyboard: ↑/↓ Navigate  enter Actions  esc Exit');
  const actions = mcpPanel([servers[0] ?? '', '    [Restart]   Disable', ...servers.slice(1)], 'Keyboard: ↑/↓ Navigate  ←/→ Action  enter Select  esc Cancel');

  assert.deepEqual({ dialogs: [agyDialog(list), agyDialog(actions)], boxes: [agyInputBox(list), agyInputBox(actions)] }, {
    dialogs: [
      {
        lines: ['MCP Servers', 'Plugins (~/.gemini/config/plugins)'],
        options: [
          { key: '', label: '✓ shop-db', detail: 'Tools: list_orders, refund_order, +12 more', checked: undefined, current: true },
          { key: '', label: '✓ browser', detail: 'Tools: browser_open, browser_click, +30 more', checked: undefined, current: false },
          { key: '', label: '⣯ notes', detail: 'initializing...', checked: undefined, current: false },
        ],
        tabs: false,
        previews: true,
      },
      {
        lines: ['MCP Servers', '✓ shop-db', 'Tools: list_orders, refund_order, +12 more'],
        options: [
          { key: '', label: 'Restart', detail: undefined, checked: undefined, current: true },
          { key: '', label: 'Disable', detail: undefined, checked: undefined, current: false },
        ],
        tabs: false,
        previews: true,
        sideways: true,
        goesBack: true,
      },
    ],
    boxes: [undefined, undefined],
  });
});

// agy's /rewind, opened by hand: the user's messages under its box — each cut short, how long ago under it — over
// "(current)", the chosen one marked ">"; Enter rewinds at once, the conversation and the files changed since, and the
// card says so above them. While it shows, the box takes no keys
test('agyRewind_Should_ReadTheMessagesToRewindTo_AsWhatAgyAsks_SayingEnterRewindsAtOnce', () => {
  const panel = screenOf([rule, '>', rule, 'Rewind Conversation', '', '  Add the price filter to the catalo...', '    (2h ago)', '', '  Run the tests', '    (1h ago)', '', '> (current)', 'Keyboard: ↑/↓ Navigate  enter Select  esc Cancel', `${' '.repeat(40)}Gemini 4 Argon · high`]);

  assert.deepEqual({ dialog: agyDialog(panel), box: agyInputBox(panel) }, {
    dialog: {
      lines: ['Rewind Conversation', 'A message picked rewinds at once: the conversation, and the file edits made since.'],
      options: [
        { key: '', label: 'Add the price filter to the catalo...', detail: '(2h ago)', checked: undefined, current: false },
        { key: '', label: 'Run the tests', detail: '(1h ago)', checked: undefined, current: false },
        { key: '', label: '(current)', detail: undefined, checked: undefined, current: true },
      ],
      tabs: false,
      previews: true,
    },
    box: undefined,
  });
});

/** agy's /model under its box: the models, and under them the chosen one's effort gauge, if it has one. */
const modelPanel = (/** @type {readonly string[]} */ rows, /** @type {readonly string[]} */ gauge, /** @type {string} */ keys) =>
  screenOf([rule, '>', rule, 'Switch Model', '  Search:', `          ${'─'.repeat(20)}`, ...rows, ...gauge, keys, `${' '.repeat(40)}Gemini 4 Argon · high`]);

// /model shows agy's models under its box, the chosen one marked ">", the one in use "(current)" — gone along with
// ↑/↓ — and the chosen one's effort gauge, its levels named under it, the one set ◉ — gone along with ←/→; Enter picks
// the model at that effort, Esc goes back. A model with one effort has no gauge. While it shows, the box takes no keys
test('agyModel_Should_ReadTheModelsAndTheChosenOnesEffort_AsWhatAgyAsks_TheBoxTakingNoKeysMeanwhile', () => {
  const rows = ['  Gemini 4 Carbon', '> Gemini 4 Argon        (current)', '  GPT-OSS 120B (Medium)'];
  const withGauge = modelPanel(rows, ['  Effort  ◂      ●━━━━━━━━━━◉──────────○──────────○      ▸', '                low      medium      high       xhigh', '            Balanced speed and reasoning quality for most tasks'], 'Keyboard: ↑/↓ Navigate  ←/→ Effort  enter Select  esc Go Back');
  const noGauge = modelPanel(['  Gemini 4 Carbon', '  Gemini 4 Argon        (current)', '> GPT-OSS 120B (Medium)'], [], 'Keyboard: ↑/↓ Navigate  enter Select  esc Go Back');
  /** @param {number} at — the row the cursor is on */
  const models = (at) =>
    ['Gemini 4 Carbon', 'Gemini 4 Argon', 'GPT-OSS 120B (Medium)'].map((label, index) => ({ key: '', label, detail: index === 1 ? '(current)' : undefined, checked: undefined, current: index === at }));

  assert.deepEqual({ dialogs: [agyDialog(withGauge), agyDialog(noGauge)], boxes: [agyInputBox(withGauge), agyInputBox(noGauge)] }, {
    dialogs: [
      { lines: ['Switch Model'], options: models(1), tabs: false, previews: true, goesBack: true, picker: { levels: ['low', 'medium', 'high', 'xhigh'], chosen: 1, about: 'Balanced speed and reasoning quality for most tasks' } },
      { lines: ['Switch Model'], options: models(2), tabs: false, previews: true, goesBack: true, picker: { levels: [], chosen: undefined, about: undefined } },
    ],
    boxes: [undefined, undefined],
  });
});
