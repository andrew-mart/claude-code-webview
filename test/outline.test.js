import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentIndex, stepTarget } from '../public/model/outline.js';

// tops — the top of each prompt relative to the top of the scroll area, in feed order.
const line = 80;
// A jump puts a prompt's top 16 px below the top of the feed.
const view = { readingLine: line, landing: 16 };

test('currentIndex_Should_PickLastPromptStartedAboveReadingLine', () => {
  assert.equal(currentIndex([-500, -20, 300, 900], line), 1);
  assert.equal(currentIndex([200, 400], line), -1);
  assert.equal(currentIndex([], line), -1);
});

test('stepTarget_Should_MoveToNeighbourOrBackToStartOfCurrentPrompt', () => {
  assert.equal(stepTarget([-500, 78, 300], view, 'next'), 2);
  assert.equal(stepTarget([-500, 78, 300], view, 'previous'), 0);
  assert.equal(stepTarget([-500, 16, 300], view, 'previous'), 0, 'right after a jump to a prompt — to the previous one');
  assert.equal(stepTarget([-500, -300, 300], view, 'previous'), 1, 'in the middle of an answer — to the start of the current prompt');
  assert.equal(stepTarget([-500, 78], view, 'next'), undefined, 'last prompt');
  assert.equal(stepTarget([200, 400], view, 'previous'), undefined, 'above the first prompt');
  assert.equal(stepTarget([200, 400], view, 'next'), 0);
});
