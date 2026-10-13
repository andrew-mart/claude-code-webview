import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvDelimiterOf, csvLines } from '../public/model/csv.js';

// A table is told apart by the sign that splits every row the same way: a comma in a quoted cell does not count
test('csvDelimiterOf_Should_PickSignThatSplitsEveryRowAlike', () => {
  assert.deepEqual(
    ['name;price;note\nmilk;1,20;"fresh, cold"\nbread;0,90;', 'name,price\nmilk,"1;20"\n', 'name\tprice\nmilk\t1.20\n', 'just one column\nof words\n'].map(csvDelimiterOf),
    [';', ',', '\t', ','],
  );
});

// Each cell of a line is told by its column, so the columns can be told apart by colour; the splitting signs belong to
// no column; a quoted cell keeps its signs and its line breaks, its column going on in the next line
test('csvLines_Should_TellColumnOfEachCell_ThroughQuotesAndLineBreaksInThem', () => {
  const cell = (/** @type {string} */ text, /** @type {number} */ column) => ({ text, column });
  const sign = (/** @type {string} */ text) => ({ text, column: undefined });

  assert.deepEqual(csvLines('a,"b,c",d\n1,"two\nlines",3', ','), [
    [cell('a', 0), sign(','), cell('"b,c"', 1), sign(','), cell('d', 2)],
    [cell('1', 0), sign(','), cell('"two', 1)],
    [cell('lines"', 1), sign(','), cell('3', 2)],
  ]);
});

// An empty cell has nothing to colour, and a line of nothing is a line still
test('csvLines_Should_KeepEmptyCellsAndEmptyLines', () => {
  assert.deepEqual(csvLines(';x\n\n', ';'), [
    [{ text: ';', column: undefined }, { text: 'x', column: 1 }],
    [],
    [],
  ]);
});
