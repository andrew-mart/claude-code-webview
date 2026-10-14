import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionLabel } from '../public/model/view-settings.js';

/** @type {readonly [import('../public/model/view-settings.js').SettingKey, string, string][]} */
const labels = [
  ['activity', 'compact', 'Show in detail'],
  ['activity', 'detailed', 'Show briefly'],
  ['service', 'hidden', 'Show Claude Code service messages'],
  ['service', 'shown', 'Hide Claude Code service messages'],
  ['font', 'serif', 'Sans-serif answers'],
  ['font', 'sans', 'Serif answers'],
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
];

for (const [key, current, expected] of labels) {
  test(`actionLabel_Should_NameWhatClickDoes_${key}_${current}`, () => {
    assert.equal(actionLabel(key, current), expected);
  });
}
