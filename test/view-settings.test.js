import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionLabel, choices, textSizeStep } from '../public/model/view-settings.js';

/** @type {readonly [import('../public/model/view-settings.js').SettingKey, string, string][]} */
const labels = [
  ['activity', 'compact', 'Show in detail'],
  ['activity', 'detailed', 'Show briefly'],
  ['service', 'hidden', 'Show Claude Code service messages'],
  ['service', 'shown', 'Hide Claude Code service messages'],
  ['theme', 'auto', 'Light theme'],
  ['theme', 'light', 'Dark theme'],
  ['theme', 'dark', 'System theme'],
  ['outline', 'shown', 'Hide outline'],
  ['outline', 'hidden', 'Show outline'],
  ['tables', 'fit', 'Widen tables everywhere'],
  ['tables', 'wide', 'Fit tables to the width everywhere'],
  ['width', 'column', 'Show the conversation at full width'],
  ['width', 'full', 'Show the conversation in a column'],
  ['copy', 'markdown', 'Ctrl+C copies selections as plain text — Ctrl+Shift+C as markdown'],
  ['copy', 'plain', 'Ctrl+C copies selections as markdown, as Ctrl+Shift+C does'],
  ['lamps', 'robots', 'Show lamps instead of robots'],
  ['lamps', 'lamps', 'Show robots at work and at rest'],
  ['notes', 'live', 'Edit notes as blocks, as Notion does (Milkdown)'],
  ['notes', 'blocks', 'Edit notes with a live preview, as Obsidian does (CodeMirror)'],
];

for (const [key, current, expected] of labels) {
  test(`actionLabel_Should_NameWhatClickDoes_${key}_${current}`, () => {
    assert.equal(actionLabel(key, current), expected);
  });
}

// The conversation's text is made a step smaller or larger — from the usual size, 100% — and stays at either end of the
// sizes; one the browser kept that is not among them goes from the usual size
test('textSizeStep_Should_GoAStepSmallerOrLarger_AndStayAtEitherEnd', () => {
  assert.deepEqual(
    [textSizeStep(choices.size[0], -1), textSizeStep('100', 1), textSizeStep('85', -1), textSizeStep('150', 1), textSizeStep('97', 1)],
    ['90', '110', '85', '150', '110'],
  );
});
