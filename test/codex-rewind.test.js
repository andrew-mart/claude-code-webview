import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexBrowsedPrompt } from '../server/codex-screen.js';
import { driveCodexRewind } from '../server/codex-rewind.js';

const placeholder = 'Ask Codex to do anything';
const footers = {
  idle: '  ? for shortcuts',
  primed: '  esc again to edit previous message',
  browsing: '  Browsing · ↑↓/jk ←→/hl · ctrl+t details · ↵ rewind · esc back',
};

/**
 * A fake Codex 0.162 with these prompts sent, answered each: Esc twice browses its prompts — the newest first, ← an
 * older one, → a newer one, the one browsed drawn in reverse video — Enter reverts the conversation to before it and puts
 * it back into the box, Esc leaves.
 * @param {readonly string[]} prompts
 */
function fakeCodex(prompts) {
  let sent = [...prompts];
  /** @type {'idle' | 'primed' | 'browsing'} */
  let mode = 'idle';
  let browsed = 0;
  let box = '';
  let reverted = false;
  /** @type {string[]} */
  const keys = [];
  /** @param {boolean} styled */
  const screen = (styled) =>
    [
      '  >_ OpenAI Codex (v0.162.0)',
      ...(reverted ? ['• Conversation reverted to this point. File changes are unchanged.'] : []),
      ...sent.flatMap((prompt, at) => [styled && mode === 'browsing' && at === browsed ? `› \u001b[7m${prompt}\u001b[0m` : `› ${prompt}`, `• answer ${at + 1}`, '']),
      '',
      `› ${box === '' ? placeholder : box}`,
      '',
      '  ~ · GPT-6-Astra low',
      footers[mode],
    ].join('\n');
  const terminal = {
    read: async () => screen(false),
    styled: async () => screen(true),
    /** @param {...string} pressed */
    keys: async (...pressed) => {
      for (const key of pressed) {
        keys.push(key);
        if (key === 'esc') {
          if (mode === 'idle' && box === '' && sent.length > 0) mode = 'primed';
          else if (mode === 'primed') {
            mode = 'browsing';
            browsed = sent.length - 1;
          } else mode = 'idle';
        } else if (mode === 'primed') mode = 'idle';
        if (mode === 'browsing' && key === 'left') browsed = Math.max(0, browsed - 1);
        if (mode === 'browsing' && key === 'right') browsed = Math.min(sent.length - 1, browsed + 1);
        if (mode === 'browsing' && key === 'enter') {
          box = sent[browsed] ?? '';
          sent = sent.slice(0, browsed);
          reverted = true;
          mode = 'idle';
        }
        if (key === 'backspace') box = box.slice(0, -1);
      }
      return true;
    },
    /** @param {string} text */
    text: async (text) => {
      box += text;
      return true;
    },
  };
  return { terminal, keys, sent: () => sent, box: () => box };
}

const wait = async () => undefined;
const prompts = ['Reply with the single word one.', 'Reply with the single word two.', 'Reply with the single word three.'];

// The prompt Codex shows browsed is the one drawn in reverse video
test('codexBrowsedPrompt_Should_ReadPromptDrawnInReverseVideo', () => {
  const browsing = ['\u001b[0m\u001b[1m\u001b[2m› \u001b[0mReply with the single word one.\r', '\u001b[0m\u001b[1m\u001b[2m› \u001b[0m\u001b[7mReply with the single word two.\u001b[0m\r'].join('\n');

  assert.deepEqual([codexBrowsedPrompt(browsing), codexBrowsedPrompt(browsing.replace('\u001b[7m', ''))], ['Reply with the single word two.', undefined]);
});

// Rewound from the page, Codex goes back to before the prompt: browsed to it — the one browsed checked by its text
// before Enter — reverted, and the prompt it puts back into its box taken out for the page's
test('driveCodexRewind_Should_RevertToBeforePrompt_CheckedByItsText', async () => {
  const codex = fakeCodex(prompts);

  const outcome = await driveCodexRewind(codex.terminal, { stepsUp: 2, prompt: 'Reply with the single word two.', wait });

  assert.deepEqual({ outcome, sent: codex.sent(), box: codex.box() }, { outcome: { ok: true, restoredPrompt: true }, sent: ['Reply with the single word one.'], box: '' });
});

// Codex may list a prompt the count did not — a message sent while it worked: the neighbours are tried by their text;
// a prompt it does not list at all is not rewound to — it leaves browsing, nothing reverted
test('driveCodexRewind_Should_FindPromptCountedOffByOne_AndRevertNothingWhenItIsNotThere', async () => {
  const counted = fakeCodex([...prompts, 'and also this']);
  const missing = fakeCodex(prompts);

  const found = await driveCodexRewind(counted.terminal, { stepsUp: 2, prompt: 'Reply with the single word two.', wait });
  const notThere = await driveCodexRewind(missing.terminal, { stepsUp: 1, prompt: 'Reply with the single word four.', wait });

  assert.deepEqual(
    { found, counted: counted.sent(), notThere, missing: missing.sent(), left: (await missing.terminal.read()).includes('Browsing') },
    { found: { ok: true, restoredPrompt: true }, counted: ['Reply with the single word one.'], notThere: { ok: false, error: 'message-not-found' }, missing: prompts, left: false },
  );
});

// The prompt browsed is checked by its whole text: a neighbour that only begins with it — "ok" and the "ok, and add
// tests too" sent while Codex worked — is not the one rewound to
test('driveCodexRewind_Should_NotRevertToNeighbour_When_ItOnlyBeginsWithPrompt', async () => {
  const codex = fakeCodex(['Reply with the single word one.', 'ok', 'ok, and add tests too']);

  const outcome = await driveCodexRewind(codex.terminal, { stepsUp: 1, prompt: 'ok', wait });

  assert.deepEqual({ outcome, sent: codex.sent() }, { outcome: { ok: true, restoredPrompt: true }, sent: ['Reply with the single word one.'] });
});
