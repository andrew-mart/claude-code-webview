import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhrases, phraseOf, topPhrases, withPhraseSent } from '../public/model/phrases.js';

// A prompt counts as a phrase when it is one line and short — a command, a word or a few — its spaces as one; a long
// prompt, one of several lines, or nothing at all is none
test('phraseOf_Should_TakeShortOneLinePrompts_TheirSpacesAsOne', () => {
  assert.deepEqual(['  давай  ', '/clear', 'go   on\tplease', 'first line\nsecond line', '   ', 'x'.repeat(121), 'x'.repeat(120)].map(phraseOf), [
    'давай',
    '/clear',
    'go on please',
    undefined,
    undefined,
    undefined,
    'x'.repeat(120),
  ]);
});

// The phrases sent most, the most first — of as many, the one sent last first — each as it was typed last, a phrase's
// case aside; so many of them at most
test('topPhrases_Should_GiveThePhrasesSentMost_AsTypedLast', () => {
  const sent = [
    ['давай', 1],
    ['/clear', 2],
    ['Давай', 3],
    ['проверь', 4],
    ['/clear', 5],
    ['давай', 6],
    ['go on', 7],
  ].reduce((phrases, [text, at]) => withPhraseSent(phrases, String(text), Number(at)), /** @type {import('../public/model/phrases.js').Phrase[]} */ ([]));

  assert.deepEqual(topPhrases(sent, 3), [
    { text: 'давай', count: 3, at: 6 },
    { text: '/clear', count: 2, at: 5 },
    { text: 'go on', count: 1, at: 7 },
  ]);
});

// The phrases the viewer tells, as the page takes them: a text and how many times it was sent; anything else left out,
// a reply of no phrases at all none
test('parsePhrases_Should_TakeTextsAndCounts_LeavingOutAnythingElse', () => {
  assert.deepEqual([parsePhrases([{ text: 'давай', count: 12 }, { text: 7, count: 1 }, { text: '/clear' }, 'проверь']), parsePhrases({ error: 'x' })], [[{ text: 'давай', count: 12 }], []]);
});
