import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { choiceDialog } from '../server/dialog.js';
import { parseDialog, parseSteps } from '../public/model/dialog.js';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// The icons are drawn when their module loads: the DOM is set up before it.
Object.assign(globalThis, { window, document: window.document });
const { createDialogCard } = await import('../public/view/dialog-card.js');

/**
 * @param {Partial<import('../public/model/dialog.js').DialogOption> & { key: string, label: string }} option
 * @returns {import('../public/model/dialog.js').DialogOption}
 */
const optionOf = (option) => ({ detail: undefined, checked: undefined, current: false, ...option });

/** The first of two questions Claude Code asks, with an answer of one's own. */
const colour = {
  lines: ['←  ☐ Colour  ☐ Sizes  ✔ Submit  →', 'Which colour do you prefer?'],
  options: [optionOf({ key: '1', label: 'Red', detail: 'Warm', current: true }), optionOf({ key: '2', label: 'Green' }), optionOf({ key: '3', label: 'Type something.' }), optionOf({ key: '4', label: 'Chat about this' })],
  tabs: true,
  previews: false,
};

/** A card above the box, answers recorded; every answer is taken. */
function cardAboveBox() {
  /** @type {import('../public/model/dialog.js').DialogStep[][]} */
  const answers = [];
  const card = createDialogCard({
    asker: 'Claude Code',
    answer: async (steps) => {
      answers.push([...steps]);
      return { ok: true };
    },
  });
  card.show(colour);
  /** @param {string} name — a button's text */
  const press = (name) => {
    const button = [...card.element.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(name));
    assert.ok(button, `no button ${name}`);
    button.click();
  };
  return { card, answers, press };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test('modelPicker_Should_ChangeOnlyThisSession_WithoutSavingGlobalClaudeDefaults', async () => {
  const { card, answers, press } = cardAboveBox();
  const screen = ['Select model', ' > 1. GPT-6 Sol', '   2. GPT-6 Astra', 'Enter to set as default · s to use this session only · Esc to cancel'].join('\n');
  card.show(parseDialog(choiceDialog(screen)));
  press('GPT-6 Astra');
  await settled();

  assert.deepEqual(answers, [[{ key: 'down' }, { key: 's' }]]);
  assert.deepEqual(parseSteps(answers[0]), [{ key: 'down' }, { key: 's' }]);
});

// What Claude Code asks shows above the box, its choices as buttons: a click picks one with its digit; an answer of
// one's own goes as the terminal takes it — "Type something", the words, Enter
test('dialogCard_Should_ShowQuestion_And_AnswerWithChoiceOrOwnWords', async () => {
  const { card, answers, press } = cardAboveBox();
  const question = card.element.textContent?.includes('Which colour do you prefer?');

  press('Green');
  await settled();
  const own = card.element.querySelector('input');
  assert.ok(own instanceof window.HTMLInputElement);
  own.value = 'Purple';
  press('Answer');
  await settled();

  assert.deepEqual({ question, answers }, { question: true, answers: [[{ key: '2' }], [{ key: '3' }, { text: 'Purple' }, { key: 'enter' }]] });
});

// One's own words are asked for where the terminal has "Type something" — among the answers, above "Chat about this",
// not under them all, out of sight in a card scrolled by long answers
test('dialogCard_Should_AskForOwnWords_WhereTheTerminalHasTypeSomething', () => {
  const { card } = cardAboveBox();
  const own = card.element.querySelector('input');
  const chat = [...card.element.querySelectorAll('button')].find((button) => button.textContent?.includes('Chat about this'));
  assert.ok(own && chat);

  assert.equal(own.compareDocumentPosition(chat) & window.Node.DOCUMENT_POSITION_FOLLOWING, window.Node.DOCUMENT_POSITION_FOLLOWING);
});

// In a question with several answers one's own words are ticked as the terminal takes them: the arrows to "Type
// something", the words — typed on it, they tick it — and ↑ off it, where a digit would be typed into the words
test('dialogCard_Should_TickOwnWords_InQuestionWithSeveralAnswers', async () => {
  const { card, answers } = cardAboveBox();
  const rule = '─'.repeat(40);
  const sizes = ['←  ☐ Colour  ☐ Sizes  ✔ Submit  →', 'Which sizes?', '❯ 1. [ ] Small', '         Small size', '  2. [ ] Large', '         Large size', '  3. [ ] Type something', '     Submit', rule, '  4. Chat about this', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'];
  card.show(choiceDialog(['❯ Ask me', rule, ...sizes].join('\n')));
  const own = card.element.querySelector('input');
  assert.ok(own instanceof window.HTMLInputElement);
  own.value = 'Medium';
  own.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  await settled();

  assert.deepEqual(answers, [[{ key: 'down' }, { key: 'down' }, { text: 'Medium' }, { key: 'up' }]]);
});

// The card folds to its head — who asks, and the question's own line — leaving the conversation the room; it stays
// folded as long as something is asked, the question changing or not — a choice ticked, another question gone to — and
// the next thing asked, once this is answered, shows unfolded
test('dialogCard_Should_FoldToItsHead_StayFoldedWhileAsked_AndUnfoldForWhatIsAskedNext', () => {
  const { card } = cardAboveBox();
  const fold = () => card.element.querySelector('.dialog-card-head')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const seen = () => ({
    folded: card.element.classList.contains('folded'),
    expanded: card.element.querySelector('.dialog-card-fold')?.getAttribute('aria-expanded'),
    question: card.element.querySelector('.dialog-card-question')?.textContent,
  });

  fold();
  const folded = seen();
  card.show({ ...colour, lines: [colour.lines[0] ?? '', 'Which sizes?'] });
  const otherQuestion = seen();
  fold();
  const unfolded = seen();
  fold();
  card.show(undefined);
  card.show(colour);
  const next = seen();

  assert.deepEqual(
    { folded, otherQuestion, unfolded, next },
    {
      folded: { folded: true, expanded: 'false', question: 'Which colour do you prefer?' },
      otherQuestion: { folded: true, expanded: 'false', question: 'Which sizes?' },
      unfolded: { folded: false, expanded: 'true', question: 'Which sizes?' },
      next: { folded: false, expanded: 'true', question: 'Which colour do you prefer?' },
    },
  );
});

// Several questions are gone through with ← and →; Esc cancels them; with nothing asked the card is gone
test('dialogCard_Should_GoBetweenQuestions_CancelThem_And_HideWhenNothingIsAsked', async () => {
  const { card, answers, press } = cardAboveBox();

  // each answer goes before the next: meanwhile the buttons wait, so a second press is not a second key
  for (const name of ['Next', 'Previous', 'Cancel']) {
    press(name);
    await settled();
  }
  card.show(undefined);

  assert.deepEqual({ answers, hidden: card.element.hidden }, { answers: [[{ key: 'right' }], [{ key: 'left' }], [{ key: 'esc' }]], hidden: true });
});

// Beside previews a digit picks nothing: the answer is gone to with the arrows from the one under the cursor, then Enter
test('dialogCard_Should_AnswerWithArrowsAndEnter_BesidePreviews', async () => {
  const { card, answers, press } = cardAboveBox();
  card.show({
    lines: ['☐ Cache', 'Which cache?'],
    options: [optionOf({ key: '1', label: 'Redis' }), optionOf({ key: '2', label: 'Files', current: true }), optionOf({ key: '3', label: 'None' })],
    tabs: false,
    previews: true,
  });

  press('None');
  await settled();
  press('Redis');
  await settled();

  assert.deepEqual(answers, [
    [{ key: 'down' }, { key: 'enter' }],
    [{ key: 'up' }, { key: 'enter' }],
  ]);
});

// What Codex asks shows under its name, and an answer goes as Codex picks: the arrows from the option under its cursor
// to the one picked, then Enter
test('dialogCard_Should_ShowWhatCodexAsks_AndPickWithArrows', async () => {
  /** @type {import('../public/model/dialog.js').DialogStep[][]} */
  const answers = [];
  const card = createDialogCard({
    asker: 'Codex',
    answer: async (steps) => {
      answers.push([...steps]);
      return { ok: true };
    },
  });
  card.show({
    lines: ['Trust this folder?'],
    options: [
      { key: '1', label: 'Trust and continue', detail: undefined, checked: undefined, current: true },
      { key: '2', label: 'Quit', detail: undefined, checked: undefined, current: false },
    ],
    tabs: false,
    previews: true,
  });
  const quit = [...card.element.querySelectorAll('button')].find((button) => button.textContent?.includes('Quit'));
  assert.ok(quit);
  quit.click();
  await settled();

  assert.deepEqual({ head: card.element.querySelector('.dialog-card-asker')?.textContent, answers }, { head: 'Codex asks', answers: [[{ key: 'down' }, { key: 'enter' }]] });
});
