import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// CodeMirror's view looks for the DOM as its module loads: it is set up first
Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver });
const { EditorSelection, EditorState } = await import('@codemirror/state');
const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
const { ensureSyntaxTree } = await import('@codemirror/language');
const { blockDecorations, focusChanged, previewDecorations, trackFocus } = await import('../public/view/live-preview.js');

/**
 * A note's markdown with the cursor at a place in it, its syntax read through — in an editor with the focus, being
 * edited, unless asked otherwise.
 * @param {string} doc @param {number} cursor @param {'focused' | 'unfocused'} [focus]
 */
const noteAt = (doc, cursor, focus = 'focused') => {
  const made = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage }), trackFocus] });
  const state = focus === 'focused' ? made.update({ effects: focusChanged.of(true) }).state : made;
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
};

/**
 * What the preview lays over the text, in words: what it hides, the widgets it puts in, the classes of lines and of
 * spans — each with the text it lies over; in the order of the text, a line's class first, of two at one place the wider.
 * @param {import('@codemirror/state').EditorState} state
 * @param {import('@codemirror/view').DecorationSet} decorations
 * @returns {string[]}
 */
const laid = (state, decorations) => {
  /** @type {{ from: number, to: number, told: string }[]} */
  const found = [];
  decorations.between(0, state.doc.length, (from, to, decoration) => {
    const text = JSON.stringify(state.doc.sliceString(from, to));
    /** @type {{ widget?: { shows?: string }, class?: string, attributes?: Record<string, string> }} */
    const spec = decoration.spec;
    const attributes = spec.attributes === undefined ? '' : ` ${JSON.stringify(spec.attributes)}`;
    const told = spec.widget !== undefined ? `widget ${spec.widget.shows ?? '?'} over ${text}` : spec.class === undefined ? `hide ${text}` : from === to ? `line ${spec.class}` : `${spec.class}${attributes} over ${text}`;
    found.push({ from, to, told });
  });
  // a line's class lies at its start, as wide as nothing: it goes first there
  const width = (/** @type {{ from: number, to: number }} */ one) => (one.from === one.to ? Number.POSITIVE_INFINITY : one.to - one.from);
  return found.sort((a, b) => a.from - b.from || width(b) - width(a)).map((one) => one.told);
};

/** @param {string} doc @param {number} cursor */
const previewOf = (doc, cursor) => {
  const state = noteAt(doc, cursor);
  return laid(state, previewDecorations(state, { from: 0, to: state.doc.length }));
};

// The marks of markdown are hidden while the cursor is away from what they mark — as the note reads — and shown as soon
// as it touches it, to be edited; the text itself is never changed
test('previewDecorations_Should_HideMarksAwayFromCursor_AndShowThemWhereItIs', () => {
  const doc = '**bold** and `code`\nnext';

  assert.deepEqual(
    { away: previewOf(doc, doc.length), inBold: previewOf(doc, 3) },
    {
      away: ['hide "**"', 'hide "**"', 'cm-lp-inline-code over "`code`"', 'hide "`"', 'hide "`"'],
      inBold: ['cm-lp-inline-code over "`code`"', 'hide "`"', 'hide "`"'],
    },
  );
});

// A note no one has clicked into reads as it is through and through: its cursor, at its start, marks nothing as being
// edited till the editor has the focus
test('previewDecorations_Should_HideMarksEverywhere_WhileEditorHasNoFocus', () => {
  const state = noteAt('## Plan\n**bold**', 0, 'unfocused');

  assert.deepEqual(laid(state, previewDecorations(state, { from: 0, to: state.doc.length })), ['line cm-lp-h2', 'hide "## "', 'hide "**"', 'hide "**"']);
});

// A heading's line is styled by its level; its # and the space after it are hidden unless the cursor is on its line
test('previewDecorations_Should_StyleHeadingByLevel_AndHideItsMarkOffItsLine', () => {
  const doc = '## Plan\nnext';

  assert.deepEqual({ away: previewOf(doc, doc.length), on: previewOf(doc, 4) }, { away: ['line cm-lp-h2', 'hide "## "'], on: ['line cm-lp-h2'] });
});

// A list's bullet is drawn as a dot and a task's [ ] as a box to tick, unless the cursor is on its line; a quote's > is
// hidden, its lines marked as a quote's
test('previewDecorations_Should_DrawBulletsAndTaskBoxes_AndQuotes', () => {
  const doc = '- one\n- [x] done\n> said\n\nnext';

  assert.deepEqual(previewOf(doc, doc.length), ['widget • over "-"', 'hide "- "', 'widget ☑ over "[x]"', 'line cm-lp-quote', 'hide "> "']);
});

// A code block's lines are drawn as one block, its fences giving way to its language while the cursor is outside it
test('previewDecorations_Should_DrawCodeBlockAsBlock_FencesGivingWayToLanguage', () => {
  const doc = '```cs\nvar x = 1;\n```\nnext';

  assert.deepEqual(
    { away: previewOf(doc, doc.length), inside: previewOf(doc, 8) },
    {
      away: ['line cm-lp-code cm-lp-code-first', 'widget cs over "```cs"', 'line cm-lp-code', 'line cm-lp-code cm-lp-code-last', 'hide "```"'],
      inside: ['line cm-lp-code cm-lp-code-first', 'line cm-lp-code', 'line cm-lp-code cm-lp-code-last'],
    },
  );
});

// A link shows its words, its address hidden off it — Ctrl+click opens what it names; a file's path in the text is a
// link too, to open the file at its line
test('previewDecorations_Should_LinkLinksAndPaths_ToOpenOnCtrlClick', () => {
  const doc = 'see [the plan](https://example.com/plan) and D:/dev/shop/src/limits.ts:42\nnext';

  assert.deepEqual(previewOf(doc, doc.length), [
    'cm-lp-link {"data-href":"https://example.com/plan","title":"Ctrl+click opens it"} over "[the plan](https://example.com/plan)"',
    'hide "["',
    'hide "]"',
    'hide "("',
    'hide "https://example.com/plan"',
    'hide ")"',
    'cm-lp-link {"data-path":"D:/dev/shop/src/limits.ts","data-line":"42","title":"Ctrl+click opens it"} over "D:/dev/shop/src/limits.ts:42"',
  ]);
});

// A table is drawn as a table while the cursor is outside it; with the cursor in it, its markdown is there to edit
test('blockDecorations_Should_DrawTableAsTable_UnlessCursorIsInIt', () => {
  const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n\nnext';
  const away = noteAt(doc, doc.length);
  const inside = noteAt(doc, 3);

  assert.deepEqual(
    { away: laid(away, blockDecorations(away)), inside: laid(inside, blockDecorations(inside)) },
    { away: ['widget table over "| a | b |\\n|---|---|\\n| 1 | 2 |"'], inside: [] },
  );
});

// A table's cell edited in place changes the text between its pipes in its row, nothing else: its new words padded with
// a space each side, a pipe in them escaped, a line break a space; an escaped pipe is no cell's edge; a row without a
// pipe at its start is not edited in place
test('tableCellChange_Should_ReplaceCellBetweenItsPipes_Only', async () => {
  const { tableCellChange } = await import('../public/view/live-preview.js');

  assert.deepEqual(
    [
      tableCellChange('| a | b |', 1, 'new'),
      tableCellChange('|Case|Answer|', 0, 'Limit'),
      tableCellChange('| a \\| b | c |', 1, 'x|y\nz'),
      tableCellChange('a | b', 0, 'x'),
      tableCellChange('| a | b |', 5, 'x'),
    ],
    [{ from: 5, to: 8, insert: ' new ' }, { from: 1, to: 5, insert: ' Limit ' }, { from: 10, to: 13, insert: ' x\\|y z ' }, undefined, undefined],
  );
});
