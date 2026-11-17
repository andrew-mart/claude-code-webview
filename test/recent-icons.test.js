import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconsAtHand, withIconUsed } from '../public/model/recent-icons.js';

// An icon used goes first among those used last, out of the place it had there; so many are kept, the earliest used
// let go first
test('withIconUsed_Should_PutIconFirst_OutOfItsEarlierPlace_KeepingSoMany', () => {
  const many = Array.from({ length: 30 }, (_, at) => `lucide:icon-${at}`);

  assert.deepEqual([withIconUsed([], '🚀'), withIconUsed(['🐞', '🚀', 'lucide:wallet'], '🚀'), withIconUsed(many, '🧪').slice(-2)], [['🚀'], ['🚀', '🐞', 'lucide:wallet'], ['lucide:icon-21', 'lucide:icon-22']]);
});

// A picker has at hand the emoji used last, the latest first, then its usual ones that are not among them — as many as
// its usual ones; an icon of Lucide's is not at hand, nor is one twice
test('iconsAtHand_Should_PutEmojiUsedLastAhead_OfTheUsualOnes', () => {
  const usual = ['🚀', '🐞', '🧪', '🔧'];

  assert.deepEqual([iconsAtHand([], usual), iconsAtHand(['🍉', 'lucide:wallet@green', '🧪'], usual), iconsAtHand(['🍉', '🦊', '🐢', '🌵', '🍄'], usual)], [
    ['🚀', '🐞', '🧪', '🔧'],
    ['🍉', '🧪', '🚀', '🐞'],
    ['🍉', '🦊', '🐢', '🌵'],
  ]);
});
