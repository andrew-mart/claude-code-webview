import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputBox } from '../server/claude-screen.js';

// Claude Code's prompt box is between two rules; browsing its prompt history it titles the top one — still its box,
// not a menu over it
test('inputBox_Should_ReadBoxBetweenItsRules_TheTopOneTitledWhileHistoryIsBrowsed', () => {
  const plain = ['● Done.', '', '────────────────', '❯ fix the test', '────────────────', '  ⏵⏵ bypass permissions on'].join('\n');
  const browsing = ['● Done.', '', '─── History 89/89 ────────────', '❯ /btw where is it written?', '────────────────', '  ⏵⏵ bypass permissions on'].join('\n');

  assert.deepEqual([inputBox(plain), inputBox(browsing)], ['fix the test', '/btw where is it written?']);
});
