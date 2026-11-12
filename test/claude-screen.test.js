import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputBox, plainScreen, settleWhileChanging } from '../server/claude-screen.js';

// Claude Code's prompt box is between two rules; browsing its prompt history it titles the top one — still its box,
// not a menu over it
test('inputBox_Should_ReadBoxBetweenItsRules_TheTopOneTitledWhileHistoryIsBrowsed', () => {
  const plain = ['● Done.', '', '────────────────', '❯ fix the test', '────────────────', '  ⏵⏵ bypass permissions on'].join('\n');
  const browsing = ['● Done.', '', '─── History 89/89 ────────────', '❯ /btw where is it written?', '────────────────', '  ⏵⏵ bypass permissions on'].join('\n');

  assert.deepEqual([inputBox(plain), inputBox(browsing)], ['fix the test', '/btw where is it written?']);
});

// An empty box shows a reply Claude Code suggests — dim, Tab takes it — which is not in the box until taken: read with
// its styles, the screen shows the box empty; words typed there, drawn as they are, stay, and the screen reads as
// herdr's text of it does, its last line ended
test('plainScreen_Should_LeaveSuggestedPromptOutOfBox_ButKeepWordsTyped', () => {
  const rule = '\u001b[2m────────────────\u001b[0m\r';
  /** @param {string} line */
  const screenWith = (line) => ['\u001b[1m●\u001b[0m Тесты запускать?\r', rule, line, rule, '  \u001b[2m⏵⏵ bypass permissions on\u001b[0m\r'].join('\n');
  const suggested = screenWith('❯\u00a0\u001b[0m\u001b[2mда, запускай тесты\u001b[0m\r');
  const typed = screenWith('❯\u00a0\u001b[0mда, запускай тесты\r');

  assert.deepEqual([inputBox(plainScreen(suggested)), plainScreen(typed)], ['', ['● Тесты запускать?', '────────────────', '❯\u00a0да, запускай тесты', '────────────────', '  ⏵⏵ bypass permissions on', ''].join('\n')]);
});

// A blank screen — a shell cleared — is read as herdr's text of it is: nothing
test('plainScreen_Should_ReadBlankScreenAsNothing', () => {
  assert.equal(plainScreen(''), '');
});

// The wait for a screen to be ready goes on while the part watched keeps changing, but not for ever: a box that changes
// at every look and never shows what is waited for is given up after so many looks in all; one standing still, after
// it has stood so many
test('settleWhileChanging_Should_GiveUp_AfterSoManyLooksInAll_OrStandingStill', async () => {
  const looksAt = async (/** @type {(look: number) => string} */ screenAt) => {
    let looks = 0;
    const terminal = { read: async () => screenAt(looks++), keys: async () => true, text: async () => true };
    const ready = await settleWhileChanging(terminal, async () => undefined, (screen) => screen === 'done', (screen) => screen, { still: 3, most: 50 });
    return { ready, looks };
  };

  assert.deepEqual([await looksAt((look) => `typing ${look}`), await looksAt(() => 'typing'), await looksAt((look) => (look < 30 ? `typing ${look}` : 'done'))], [
    { ready: undefined, looks: 50 },
    { ready: undefined, looks: 4 },
    { ready: 'done', looks: 31 },
  ]);
});
