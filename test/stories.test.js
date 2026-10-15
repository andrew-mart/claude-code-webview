import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jokeAt, stories, storyAt, storyOf } from '../public/model/stories.js';

// Each agent at work has a story of its own, the same each time it is drawn, and the agents around show all of them
test('storyOf_Should_GiveEachKeyItsOwnStory_TheSameEachTime_AllOfThemAround', () => {
  const keys = Array.from({ length: 40 }, (_, index) => `w${index % 7}:p${index}`);

  assert.deepEqual(
    { same: keys.every((key) => storyOf(key) === storyOf(key)), all: [...new Set(keys.map(storyOf))].sort() },
    { same: true, all: [...stories].sort() },
  );
});

// herdr's workspaces take the stories in turn by their numbers — the first six each its own — so every story is seen
test('storyAt_Should_GiveWorkspacesStoriesInTurnByTheirNumbers', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(storyAt), ['assembly', 'mine', 'garden', 'rocket', 'coffee', 'pole', 'assembly']);
});

// A finished agent's face has a joke beside it — herdr's workspaces take them in turn by their numbers, as the stories
test('jokeAt_Should_GiveWorkspacesJokesInTurnByTheirNumbers', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(jokeAt), ['thumbs-up', 'joint', 'cocktail', 'popper', 'notes', 'thumbs-up', 'joint']);
});
