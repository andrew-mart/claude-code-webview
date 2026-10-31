import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOf, formatAgo, formatBytes, formatDuration, formatTokens } from '../public/model/format.js';

/** @type {readonly [import('../public/model/format.js').Noun, number, string][]} */
const counts = [
  ['line', 1, '1 line'],
  ['line', 2, '2 lines'],
  ['line', 11, '11 lines'],
  ['line', 21, '21 lines'],
  ['line', 0, '0 lines'],
  ['file', 2, '2 files'],
  ['webRequest', 1, '1 web request'],
];

for (const [noun, n, expected] of counts) {
  test(`countOf_Should_AgreeNounWithNumber_${n}_${noun}`, () => {
    assert.equal(countOf(n, noun), expected);
  });
}

/** @type {readonly [number, string][]} */
const durations = [
  [400, '<1s'],
  [4200, '4s'],
  [350844, '5m 51s'],
  [3780000, '1h 3m'],
  [1382_460_000, '16d 0h'],
];

for (const [ms, expected] of durations) {
  test(`formatDuration_Should_ShowLargestUnits_${ms}`, () => {
    assert.equal(formatDuration(ms), expected);
  });
}

/** @type {readonly [number, string][]} */
const tokens = [
  [950, '950'],
  [29002, '29k'],
  [1234567, '1.2M'],
  [1_000_000, '1M'],
  [999_600, '1M'],
];

for (const [n, expected] of tokens) {
  test(`formatTokens_Should_Abbreviate_${n}`, () => {
    assert.equal(formatTokens(n), expected);
  });
}

/** @type {readonly [number, string][]} */
const sizes = [
  [0, '0 B'],
  [740, '740 B'],
  [12_800, '13 KB'],
  [3_250_000, '3.1 MB'],
  [1_048_576, '1 MB'],
  [1_048_200, '1 MB'],
  [1_073_700_000, '1 GB'],
  [1_610_612_736, '1.5 GB'],
];

for (const [bytes, expected] of sizes) {
  test(`formatBytes_Should_ShowSizeInLargestUnit_${bytes}`, () => {
    assert.equal(formatBytes(bytes), expected);
  });
}

const now = Date.parse('2026-10-09T12:00:00+03:00');
/** @type {readonly [string, number, string][]} */
const ages = [
  ['halfAMinute', now - 30_000, 'now'],
  ['fiveMinutes', now - 5 * 60_000, '5m'],
  ['threeHours', now - 3 * 3_600_000, '3h'],
  ['twoDaysAgo', Date.parse('2026-10-07T09:00:00+03:00'), 'Oct 7'],
  ['lastYear', Date.parse('2025-12-31T09:00:00+03:00'), 'Dec 31, 2025'],
];

for (const [label, then, expected] of ages) {
  test(`formatAgo_Should_ShowAgeOfSession_${label}`, () => {
    assert.equal(formatAgo(then, now), expected);
  });
}
