import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutActivity } from '../public/model/activity.js';

/** @typedef {import('../public/model/activity.js').ActivityItem} ActivityItem */

/** @type {ActivityItem} */
const thinking = { kind: 'thinking' };
/** @param {import('../public/model/tool.js').ToolFamily} family @param {'pending' | 'done' | 'error'} state @returns {ActivityItem} */
const tool = (family, state = 'done') => ({ kind: 'tool', family, state });

const collapsed = { mode: 'compact', expanded: false };

test('layoutActivity_Should_CollapseSeriesIntoCountsByKindWithErrors', () => {
  const items = [thinking, tool('shell'), tool('read'), tool('read', 'error'), thinking];

  assert.deepEqual(layoutActivity(items, collapsed), {
    header: { kind: 'summary', parts: ['1 command', '2 reads', '2 thoughts'], errors: '1 error', expanded: false },
    visible: [false, false, false, false, false],
  });
});

test('layoutActivity_Should_ShowSingleCallAsIsAndHideLoneThinking', () => {
  assert.deepEqual(layoutActivity([thinking, tool('edit')], collapsed), { header: { kind: 'none' }, visible: [false, true] });
  assert.deepEqual(layoutActivity([thinking, thinking], collapsed), { header: { kind: 'none' }, visible: [false, false] });
});

test('layoutActivity_Should_ShowEveryRowInDetailedModeFoldingLongSeriesToLastFour', () => {
  const short = [thinking, tool('shell'), tool('read')];
  const long = Array.from({ length: 10 }, () => tool('shell'));

  assert.deepEqual(layoutActivity(short, { mode: 'detailed', expanded: false }), { header: { kind: 'none' }, visible: [true, true, true] });
  assert.deepEqual(layoutActivity(long, { mode: 'detailed', expanded: false }), {
    header: { kind: 'fold', hidden: '6 earlier actions' },
    visible: [false, false, false, false, false, false, true, true, true, true],
  });
  assert.deepEqual(layoutActivity(long, { mode: 'detailed', expanded: true }), { header: { kind: 'unfold' }, visible: long.map(() => true) });
});

test('layoutActivity_Should_ShowEveryRowUnderOpenedSummary', () => {
  const layout = layoutActivity([thinking, tool('shell'), tool('read')], { mode: 'compact', expanded: true });

  assert.deepEqual(layout.visible, [true, true, true]);
  assert.equal(layout.header.kind === 'summary' && layout.header.expanded, true);
});

test('layoutActivity_Should_KeepRunningCallVisibleUnderSummary', () => {
  const layout = layoutActivity([tool('shell'), thinking, tool('shell', 'pending')], collapsed);

  assert.deepEqual(layout.visible, [false, false, true]);
});
