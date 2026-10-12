import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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
