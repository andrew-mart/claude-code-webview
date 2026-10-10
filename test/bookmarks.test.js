import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorLabel, changeBookmarks, parseBookmarks } from '../public/model/bookmarks.js';

/** @typedef {import('../public/model/bookmarks.js').Bookmark} Bookmark */

/** @type {Bookmark} */
const report = { id: 'a1:0', kind: 'answer', label: 'Test results', at: '2026-10-09T10:05:00.000Z' };
/** @type {Bookmark} */
const question = { id: 'u1', kind: 'prompt', label: 'Build a viewer', at: '2026-10-09T10:00:00.000Z' };

test('changeBookmarks_Should_AddInFeedOrderAndRemoveById', () => {
  const added = changeBookmarks([report], { action: 'add', bookmark: question });

  assert.deepEqual(added, [question, report]);
  assert.deepEqual(changeBookmarks(added, { action: 'remove', id: question.id }), [report]);
});

test('changeBookmarks_Should_LeaveListAsIsWhenAddingPresentOrRemovingAbsentBookmark', () => {
  // two devices send the same change: the second one must not undo the first
  assert.deepEqual(changeBookmarks([question, report], { action: 'add', bookmark: question }), [question, report]);
  assert.deepEqual(changeBookmarks([report], { action: 'remove', id: question.id }), [report]);
});

test('parseBookmarks_Should_KeepOnlyWellFormedStoredBookmarks', () => {
  const stored = [report, { id: 'x', kind: 'unknown', label: 'L', at: 'now' }, { id: 1 }, 'garbage'];

  assert.deepEqual(parseBookmarks(stored), [report]);
  assert.deepEqual(parseBookmarks({ not: 'a list' }), []);
});

/** @type {readonly [string, string, string][]} */
const labels = [
  ['answerHeading', '## Test results\n\nReport text', 'Test results'],
  ['markupInFirstLine', '**No answers** anywhere — `D:/dev/x` and [docs](https://a.b)', 'No answers anywhere — D:/dev/x and docs'],
  ['leadingBlankLines', '   \n\nFirst line\nsecond', 'First line'],
  ['underscoresInNames', 'Field file_path and __init__ stay intact', 'Field file_path and __init__ stay intact'],
  ['longLine', 'a'.repeat(100), `${'a'.repeat(80)}…`],
];

for (const [label, source, expected] of labels) {
  test(`anchorLabel_Should_TakeReadableFirstLine_${label}`, () => {
    assert.equal(anchorLabel(source), expected);
  });
}
