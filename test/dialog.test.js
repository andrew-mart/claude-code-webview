import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDialogReply } from '../public/model/dialog.js';
import { choiceDialog } from '../server/dialog.js';

const rule = '─'.repeat(60);
const footer = 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel';
const tabs = '←  ☐ Colour  ☐ Sizes  ✔ Submit  →';
/** The conversation above the dialog: the prompt that asked, with a numbered list in it that is no choice. */
const above = [' ▐▛███▛█   Claude Code v2.1.296', '❯ Ask me two questions:', '  1. a colour', '  2. the sizes', ''];

test('choiceDialog_Should_ShowGptModelPicker_AndUseArrowNavigation', () => {
  const picker = [rule, '  Select model', '  Switch between models.', '', '  1. Default (recommended)', ' > 2. GPT-6 Sol √            Custom model (gpt-6-sol)', ' ↓ 3. GPT-6.1 Sol            Custom model (gpt-6.1-sol)', '    … +1 model', '', '  Enter to set as default · s to use this session only · Esc to', '  cancel'].join('\n');
  const dialog = choiceDialog(picker);

  assert.deepEqual(dialog?.options.map((option) => [option.key, option.current]), [['1', false], ['2', true], ['3', false]]);
  assert.match(dialog?.options[1]?.label ?? '', /GPT-6 Sol/);
  assert.equal(dialog?.previews, true);
});

test('choiceDialog_Should_ShowModelSwitchConfirmation_WithNewTerminalRule', () => {
  const confirm = ['▔'.repeat(70), '  Switch model?', '  Your next response will be slower and use more tokens', '', '  This conversation is cached for the current model.', '  Switching to GPT-6 Astra means the history gets re-read.', '', '  ❯ 1. Yes, switch to GPT-6 Astra', '    2. No, go back', ''].join('\n');
  const dialog = choiceDialog(confirm);

  assert.deepEqual(dialog?.options.map((option) => [option.key, option.current]), [['1', true], ['2', false]]);
  assert.equal(dialog?.previews, true);
  assert.ok(dialog?.lines.includes('Switch model?'));
});

/** @param {readonly string[]} dialog — the lines between the dialog's top edge and its footer */
const screen = (dialog) => [...above, rule, ...dialog, '', footer, ''].join('\n');

// Claude Code asks with AskUserQuestion: the page gets what the dialog says above its choices, and the choices with
// the digit that picks each — the one under the cursor, a ticked one, the description under one
test('choiceDialog_Should_ReadQuestionAndItsChoices_AsClaudeCodeDrawsThem', () => {
  const first = screen([tabs, '', 'Which colour do you prefer?', '', '❯ 1. Red', '     Warm', '  2. Green', '     Calm', '  3. Type something.', rule, '  4. Chat about this']);
  const several = screen(['←  ☒ Colour  ☒ Sizes  ✔ Submit  →', 'Which sizes do you need?', '  1. [✔] Small', '         Fits a pocket', '❯ 2. [ ] Medium', '  3. [✔] Large', '  4. [ ] Type something', '     Submit', rule, '  5. Chat about this']);
  // the review of the answers has no footer: its last choice ends the screen
  const review = [...above, rule, '←  ☒ Colour  ☒ Sizes  ✔ Submit  →', '', 'Review your answers', '', ' ● Which colour do you prefer?', '   → Green', '', 'Ready to submit your answers?', '', '❯ 1. Submit answers', '  2. Cancel', ''].join('\n');

  assert.deepEqual([first, several, review].map(choiceDialog), [
    {
      lines: [tabs, 'Which colour do you prefer?'],
      options: [
        { key: '1', label: 'Red', detail: 'Warm', checked: undefined, current: true },
        { key: '2', label: 'Green', detail: 'Calm', checked: undefined, current: false },
        { key: '3', label: 'Type something.', detail: undefined, checked: undefined, current: false },
        { key: '4', label: 'Chat about this', detail: undefined, checked: undefined, current: false },
      ],
      tabs: true,
      previews: false,
    },
    {
      lines: ['←  ☒ Colour  ☒ Sizes  ✔ Submit  →', 'Which sizes do you need?'],
      options: [
        { key: '1', label: 'Small', detail: 'Fits a pocket', checked: true, current: false },
        { key: '2', label: 'Medium', detail: undefined, checked: false, current: true },
        { key: '3', label: 'Large', detail: undefined, checked: true, current: false },
        { key: '4', label: 'Type something', detail: undefined, checked: false, current: false },
        { key: '5', label: 'Chat about this', detail: undefined, checked: undefined, current: false },
      ],
      tabs: true,
      previews: false,
    },
    {
      lines: ['←  ☒ Colour  ☒ Sizes  ✔ Submit  →', 'Review your answers', '● Which colour do you prefer?', '→ Green', 'Ready to submit your answers?'],
      options: [
        { key: '1', label: 'Submit answers', detail: undefined, checked: undefined, current: true },
        { key: '2', label: 'Cancel', detail: undefined, checked: undefined, current: false },
      ],
      tabs: true,
      previews: false,
    },
  ]);
});

// Answers with a preview are drawn beside it: the question set off by a bar, each answer's line running on into the
// preview's frame, the frame and a note on notes under them, and "Chat about this" alone under a rule, unnumbered. The
// page gets the question and the answers — not the frame
test('choiceDialog_Should_ReadQuestionAndChoices_DrawnBesidePreviews', () => {
  const pad = ' '.repeat(34);
  const withPreviews = [
    ...above,
    rule,
    ' ☐ Storage',
    '',
    '│ Where should the cache live? Redis needs a server; files need',
    '│ a folder the app can write to.',
    '',
    '❯ 1. Redis (Recommended)          ┌──────────────────────┐',
    '  2. Files on disk                │ cache:               │',
    '  3. No cache                     │   driver: redis      │',
    `${pad}│   ttl: 300           │`,
    `${pad}└──────────────────────┘`,
    '',
    `${pad}Notes: press n to add notes`,
    '',
    rule,
    '  Chat about this',
    '',
    'Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel',
    '',
  ].join('\n');

  assert.deepEqual(choiceDialog(withPreviews), {
    lines: ['☐ Storage', 'Where should the cache live? Redis needs a server; files need', 'a folder the app can write to.'],
    options: [
      { key: '1', label: 'Redis (Recommended)', detail: undefined, checked: undefined, current: true },
      { key: '2', label: 'Files on disk', detail: undefined, checked: undefined, current: false },
      { key: '3', label: 'No cache', detail: undefined, checked: undefined, current: false },
    ],
    tabs: false,
    previews: true,
  });
});

// While the prompt box is there nothing waits for a choice, numbered lists in the conversation included
test('choiceDialog_Should_FindNothing_When_PromptBoxIsShown', () => {
  const waiting = [...above, rule, '● Here is the plan:', '  1. Read the config', '  2. Fix the test', 'Press Esc to cancel it.', rule, '❯ ', rule, '  ⏵⏵ auto mode on'].join('\n');

  assert.equal(choiceDialog(waiting), undefined);
});

// What the viewer says to an answer; any other reply — or none — is an answer that did not reach the terminal
test('parseDialogReply_Should_TakeKnownReplies_And_CountAnyOtherAsNotSent', () => {
  assert.deepEqual(
    [{ ok: true }, { ok: false, error: 'no-dialog' }, { ok: false, error: 'exploded' }, undefined].map(parseDialogReply),
    [{ ok: true }, { ok: false, error: 'no-dialog' }, { ok: false, error: 'send-failed' }, { ok: false, error: 'send-failed' }],
  );
});
