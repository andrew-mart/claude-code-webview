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
