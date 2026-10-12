import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerBlocks } from '../public/model/side-answer.js';

// Claude Code draws a markdown table in the terminal with box lines, a cell's text wrapped over the lines of its row;
// on the page it is a table again, its first row the header, each cell's text whole
test('answerBlocks_Should_TurnTableDrawnInTerminalIntoRowsOfCells_BetweenItsText', () => {
  const answer = [
    'Two of the three parts are in master:',
    '',
    '┌────────┬──────────┬──────────────────────────────┐',
    '│  Part  │    MR    │       State in master        │',
    '├────────┼──────────┼──────────────────────────────┤',
    '│ Album  │ !72      │ Merged on 07.10; the mark no │',
    '│ mark   │          │ longer carries over.         │',
    '├────────┼──────────┼──────────────────────────────┤',
    '│ Photo  │ — (none) │ Not started.                 │',
    '└────────┴──────────┴──────────────────────────────┘',
    '',
    'The third needs its own MR.',
  ].join('\n');

  assert.deepEqual(answerBlocks(answer), [
    { kind: 'text', text: 'Two of the three parts are in master:' },
    {
      kind: 'table',
      rows: [
        ['Part', 'MR', 'State in master'],
        ['Album mark', '!72', 'Merged on 07.10; the mark no longer carries over.'],
        ['Photo', '— (none)', 'Not started.'],
      ],
    },
    { kind: 'text', text: 'The third needs its own MR.' },
  ]);
});

// A box whose rows do not line up — a cell's text with a bar of its own — is no table to rebuild: it stays as drawn
test('answerBlocks_Should_KeepBoxAsDrawn_When_ItsRowsDoNotLineUp', () => {
  const box = ['┌──────┬──────┐', '│ a │ b │ c │', '└──────┴──────┘'].join('\n');

  assert.deepEqual(answerBlocks(box), [{ kind: 'preformatted', text: box }]);
});
