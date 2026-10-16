import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedCopy } from '../public/model/feed-copy.js';
import { tailCheck } from '../public/model/feed-check.js';

const at = '2026-10-16T08:00:00.000Z';
/** @param {string} uuid */
const entry = (uuid) => ({ type: 'assistant', uuid, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: uuid }] } });
/** What the viewer tells after sending these, the page to hold them all. @param {string} token @param {readonly unknown[]} held @param {number} [earlier] */
const cursor = (token, held, earlier = 0) => ({ token, shown: earlier + held.length, check: tailCheck(held.slice(-16)) });

// Entries sent after the viewer's last token are not kept: a copy going on from that token is sent them again
test('feedCopy_Should_KeepOnlyEntriesItsTokenCovers', () => {
  const copy = createFeedCopy(undefined);

  copy.take('entries', [entry('a1')]);
  copy.take('cursor', cursor('t1', [entry('a1')]));
  copy.take('entries', [entry('a2')]);

  assert.deepEqual({ held: copy.entries().length, kept: copy.kept(100) }, { held: 2, kept: { entries: [entry('a1')], earlier: 0, token: 't1' } });
});

// A copy kept is the latest entries its token covers: those left out are counted with the earlier ones
test('feedCopy_Should_KeepLatestEntries_CountingTheRestAsEarlier', () => {
  const copy = createFeedCopy(undefined);
  const held = [entry('a1'), entry('a2'), entry('a3')];

  copy.take('earlier', { count: 5 });
  copy.take('entries', held);
  copy.take('cursor', cursor('t1', held, 5));

  assert.deepEqual(copy.kept(2), { entries: [entry('a2'), entry('a3')], earlier: 6, token: 't1' });
});

// The viewer tells how many entries the page should hold and the hash of the latest: a copy with more or fewer, or other
// latest ones, is out of step — its token is not taken
test('feedCopy_Should_BeOutOfStep_When_ItHoldsOtherThanTheViewerSays', () => {
  const held = [entry('a1'), entry('a2')];
  const outcomes = [
    ['more than said', { token: 't2', shown: 1, check: tailCheck(held) }],
    ['fewer than said', { token: 't2', shown: 3, check: tailCheck(held) }],
    ['other latest entries', { token: 't2', shown: 2, check: tailCheck([entry('a1'), entry('b2')]) }],
    ['no token', { shown: 2, check: tailCheck(held) }],
  ].map(([why, told]) => {
    const copy = createFeedCopy(undefined);
    copy.take('entries', held);
    return [why, copy.take('cursor', told), copy.token()];
  });

  assert.deepEqual(outcomes, [
    ['more than said', 'out-of-step', undefined],
    ['fewer than said', 'out-of-step', undefined],
    ['other latest entries', 'out-of-step', undefined],
    ['no token', 'out-of-step', undefined],
  ]);
});

// A copy goes on from a kept one with its token, its entries and earlier count as kept; a kept copy with no token —
// from before tokens were kept — cannot go on: the copy starts empty and the session comes whole
test('feedCopy_Should_GoOnFromKeptCopyWithToken_AndStartEmptyWithout', () => {
  const kept = { entries: [entry('a1')], earlier: 3, token: 't1' };

  const goingOn = createFeedCopy(kept);
  const fromNothing = createFeedCopy({ ...kept, token: undefined });

  assert.deepEqual(
    [goingOn.entries(), goingOn.earlier(), goingOn.token(), fromNothing.entries(), fromNothing.earlier(), fromNothing.token()],
    [[entry('a1')], 3, 't1', [], 0, undefined],
  );
});

// A reset — the viewer could not go on from the token — empties the copy: the session comes whole after it
test('feedCopy_Should_EmptyCopy_When_ViewerResetsIt', () => {
  const copy = createFeedCopy({ entries: [entry('a1')], earlier: 3, token: 't1' });

  copy.take('reset', null);

  assert.deepEqual({ entries: copy.entries(), earlier: copy.earlier(), token: copy.token(), kept: copy.kept(10) }, { entries: [], earlier: 0, token: undefined, kept: { entries: [], earlier: 0, token: undefined } });
});

// A copy goes on from its token only while it holds nothing past it: entries come before the token that covers them, and
// a copy holding some not covered yet would be sent them again — it is read anew instead
test('feedCopy_Should_GoOnFromItsToken_OnlyWhileItHoldsNothingPastIt', () => {
  const copy = createFeedCopy(undefined);

  const before = copy.goOnFrom();
  copy.take('entries', [entry('a1')]);
  const pastToken = copy.goOnFrom();
  copy.take('cursor', cursor('t1', [entry('a1')]));

  assert.deepEqual([before, pastToken, copy.goOnFrom()], [undefined, undefined, 't1']);
});
