// @ts-check
// Resizing a side panel by dragging its inner edge.

/**
 * The panel's width after its edge moved: a panel on the left grows as its right edge goes right, a panel on the
 * right grows as its left edge goes left. Counted from where the drag started, so it works wherever the panel is.
 * @param {{ side: 'left' | 'right', startWidth: number, moved: number, min: number, max: number }} drag
 *   moved — how far the pointer went, px, positive to the right
 * @returns {number}
 */
export function draggedWidth({ side, startWidth, moved, min, max }) {
  const width = side === 'left' ? startWidth + moved : startWidth - moved;
  return Math.round(Math.min(Math.max(width, min), Math.max(min, max)));
}
