import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveAgyRewind } from '../server/agy-rewind.js';

const rule = '─'.repeat(60);

/**
 * A stand-in for agy's /rewind: its prompt box between two rules, and under it, the box still drawn, the panel listing
 * the user's messages — each cut at so many characters, how long ago under it — over "(current)", the cursor ">" on
 * the chosen row. Enter on a message rewinds at once — no confirmation — and puts the message back into the box.
 * @param {readonly string[]} prompts — the messages, the oldest first
 * @param {string} [typed] - text already in the box
 */
function fakeAgy(prompts, typed = '') {
  /** @type {{ mode: 'input' | 'list', input: string, cursor: number, rewound: string[] }} */
  const state = { mode: 'input', input: typed, cursor: prompts.length, rewound: [] };
  const cut = (/** @type {string} */ text) => (text.length > 24 ? `${text.slice(0, 24)}...` : text);
  const screen = () => {
    const box = [rule, `> ${state.input}`.trimEnd(), rule];
    if (state.mode === 'input') return [...box, '? for shortcuts'].join('\n');
    const rows = prompts.flatMap((text, at) => [`${at === state.cursor ? '>' : ' '} ${cut(text)}`, '    (5m ago)', '']);
    return [rule, '>', rule, 'Rewind Conversation', '', ...rows, `${state.cursor === prompts.length ? '>' : ' '} (current)`, 'Keyboard: ↑/↓ Navigate  enter Select  esc Cancel'].join('\n');
  };
  return {
    state,
    terminal: {
      read: async () => screen(),
      text: async (/** @type {string} */ text) => {
        if (state.mode === 'input') state.input += text;
        return true;
      },
      keys: async (/** @type {string[]} */ ...keys) => {
        for (const key of keys) {
          if (state.mode === 'input' && key === 'backspace') state.input = state.input.slice(0, -1);
          else if (state.mode === 'input' && key === 'enter' && state.input === '/rewind') {
            state.mode = 'list';
            state.input = '';
            state.cursor = prompts.length;
          } else if (state.mode === 'list' && key === 'up') state.cursor = Math.max(0, state.cursor - 1);
          else if (state.mode === 'list' && key === 'down') state.cursor = Math.min(prompts.length, state.cursor + 1);
          else if (state.mode === 'list' && key === 'esc') state.mode = 'input';
          else if (state.mode === 'list' && key === 'enter' && state.cursor < prompts.length) {
            const text = prompts[state.cursor] ?? '';
            state.rewound.push(text);
            state.mode = 'input';
            state.input = text;
          }
        }
        return true;
      },
    },
  };
}

const sent = ['Add the price filter to the catalog page', 'Run the tests', 'Cover the filter with a test of its own'];
const noWait = async () => {};

// A message chosen on the page: /rewind typed into agy's empty box, the arrows to the message — counted from the
// newest, checked against the row the cursor is on before Enter, which rewinds at once — and the message, back in agy's
// box, taken out of it for the page's box
test('driveAgyRewind_Should_RewindToTheChosenMessage_AndTakeItsTextOutOfAgysBox', async () => {
  const agy = fakeAgy(sent);

  const outcome = await driveAgyRewind(agy.terminal, { stepsUp: 2, prompt: 'Run the tests', wait: noWait });

  assert.deepEqual({ outcome, rewound: agy.state.rewound, mode: agy.state.mode, input: agy.state.input }, { outcome: { ok: true, restoredPrompt: true }, rewound: ['Run the tests'], mode: 'input', input: '' });
});

// The list may hold a message or two the count did not: the rows around the counted one are tried, each checked before
// Enter — no other message is rewound to on the way; one not in the list at all rewinds nothing, the panel closed
test('driveAgyRewind_Should_FindTheMessageAroundTheCountedRow_AndRewindNothingWhenItIsNotThere', async () => {
  const counts = await Promise.all(
    [1, 3].map(async (stepsUp) => {
      const agy = fakeAgy(sent);
      const outcome = await driveAgyRewind(agy.terminal, { stepsUp, prompt: 'Run the tests', wait: noWait });
      return { outcome, rewound: agy.state.rewound };
    }),
  );
  const missing = fakeAgy(sent);
  const notThere = await driveAgyRewind(missing.terminal, { stepsUp: 2, prompt: 'Deploy the shop', wait: noWait });

  assert.deepEqual(
    { counts, notThere: { outcome: notThere, rewound: missing.state.rewound, mode: missing.state.mode } },
    {
      counts: [
        { outcome: { ok: true, restoredPrompt: true }, rewound: ['Run the tests'] },
        { outcome: { ok: true, restoredPrompt: true }, rewound: ['Run the tests'] },
      ],
      notThere: { outcome: { ok: false, error: 'message-not-found' }, rewound: [], mode: 'input' },
    },
  );
});

// Text typed into agy's box before is erased first: /rewind goes into an empty box
test('driveAgyRewind_Should_EraseTextInAgysBox_BeforeTypingRewind', async () => {
  const agy = fakeAgy(sent, 'half-typed');

  const outcome = await driveAgyRewind(agy.terminal, { stepsUp: 1, prompt: 'Cover the filter with a test of its own', wait: noWait });

  assert.deepEqual({ outcome, rewound: agy.state.rewound }, { outcome: { ok: true, restoredPrompt: true }, rewound: ['Cover the filter with a test of its own'] });
});
