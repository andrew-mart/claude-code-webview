import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconValue, parseIcon, searchIcons } from '../public/model/icon-choice.js';

// A workspace's icon is kept as one word: an emoji as it is, a Lucide icon as lucide:name, its colour after @ — and read
// back the same; what is neither is no icon
test('parseIcon_Should_ReadEmojiOrLucideIconWithItsColour_AsIconValueWritesThem', () => {
  const icons = [
    { kind: 'emoji', emoji: '🦊' },
    { kind: 'lucide', name: 'wallet', color: undefined },
    { kind: 'lucide', name: 'piggy-bank', color: 'green' },
  ];

  assert.deepEqual(
    { written: icons.map((icon) => iconValue(/** @type {import('../public/model/icon-choice.js').Icon} */ (icon))), read: ['🦊', 'lucide:wallet', 'lucide:piggy-bank@green', 'lucide:wallet@teal', 'lucide:../x', 'fox', ''].map(parseIcon) },
    {
      written: ['🦊', 'lucide:wallet', 'lucide:piggy-bank@green'],
      read: [...icons, { kind: 'lucide', name: 'wallet', color: undefined }, undefined, undefined, undefined],
    },
  );
});

// Icons are found by their names and by their words: the name itself first, then a whole part of a name, then a name
// that holds the query, then the ones whose words do — "finance" finds a wallet
test('searchIcons_Should_FindByNameFirst_ThenByWords', () => {
  const tags = { 'align-start': ['left'], star: ['favorite'], 'star-off': ['unfavorite'], wallet: ['money', 'finance'], coins: ['finance'], 'chart-line': ['statistics'] };

  assert.deepEqual([searchIcons(tags, 'star'), searchIcons(tags, 'finance'), searchIcons(tags, ''), searchIcons(tags, 'Line')], [['star', 'star-off', 'align-start'], ['wallet', 'coins'], Object.keys(tags), ['chart-line']]);
});
