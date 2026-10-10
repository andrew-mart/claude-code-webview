import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draggedWidth } from '../public/model/resize.js';

const limits = { min: 200, max: 520 };

test('draggedWidth_Should_WidenLeftPanelDraggedRightAndRightPanelDraggedLeft', () => {
  // the session list is on the left: its handle is its right edge
  assert.equal(draggedWidth({ side: 'left', startWidth: 288, moved: 60, ...limits }), 348);
  // the outline and the file panel are on the right: their handle is their left edge
  assert.equal(draggedWidth({ side: 'right', startWidth: 288, moved: -60, ...limits }), 348);
  assert.equal(draggedWidth({ side: 'right', startWidth: 288, moved: 60, ...limits }), 228);
});

test('draggedWidth_Should_StayWithinLimits', () => {
  assert.equal(draggedWidth({ side: 'left', startWidth: 288, moved: -500, ...limits }), 200);
  assert.equal(draggedWidth({ side: 'left', startWidth: 288, moved: 900, ...limits }), 520);
});
