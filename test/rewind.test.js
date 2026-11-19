import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputBox } from '../server/claude-screen.js';
import { confirmShows, driveRewind, optionKey, rewindTarget } from '../server/rewind.js';

// Screens of Claude Code 2.1 in a narrow terminal, as `herdr pane read --source visible` returns them.
const idleTyped = `● Write(note.txt)
  ⎿  Wrote 1 line to
     note.txt
      1 one
✻ Crunched for 9s · done 7:33 PM
❯ Reply with the single word
  OK.
● OK
✻ Sautéed for 3s · done 7:42 PM
────────────────────────────────
❯ half-typed text
────────────────────────────────
  📁 …/home/ann/lab
  ⏵⏵ accept edits on`;

const idleEmpty = idleTyped.replace('❯ half-typed text', '❯');

const list = `❯ Reply with the single word
  OK.
● OK
✻ Sautéed for 3s · done 7:42 PM
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
   Rewind
   Restore the code and/or
   conversation to the point
   before…
     Create a file note.tx…
     note.txt +1
     Reply with the single…
     No code changes
   ❯ (current)
   Enter to continue · Esc to
   cancel`;

const confirmNoCode = `❯ Reply with the single word
  OK.
● OK
✻ Sautéed for 3s · done 7:42 PM
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
   Rewind
   Confirm you want to
   restore to the point
   before you sent this
   message:
   │ Reply with the single
   │ word OK.
   │ (20s ago)
   The conversation will be
   forked.
   The code will be
   unchanged.
   ❯ 1. Restore conversation
     2. Summarize from here
     3. Summarize up to here
     4. Never mind`;

const confirmCode = `   Confirm you want to
   restore to the point
   before you sent this
   message:
   │ Create a file note.txt
   │ containing the single
   │ word one. Do nothing
   │ else.
   │ (9m ago)
   The conversation will be
   forked.
   The code will be restored
   -1 in note.txt.
   ❯ 1. Restore code and
        conversation
     2. Restore conversation
     3. Restore code
     4. Summarize from here
   ↓ 5. Summarize up to here
   ⚠ Rewinding does not
   affect files edited
   manually or via bash.`;

// Claude Code 2.1.327's confirmation, in a wide terminal: worded anew, with what the rewind does under the message
const confirmNow = `❯ Reply with the single word OK
● OK
✻ Churned for 2s · done 10:39 AM
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Rewind

  Restore to the point before you sent this message:

  │ Create a file note.txt containing the word one. Reply with one word.
  │ (45s ago)

  The conversation goes back to before this message.
  The code will be restored -1 in note.txt.

  ❯ 1. Restore code and conversation
    2. Restore conversation
    3. Restore code
    4. Summarize from here
    5. Summarize up to here
    6. Never mind

  ⚠ Restored files go back whole, losing later changes by anyone. Bash changes to other files are not undone.`;

test('inputBox_Should_ReadPromptBoxAndNothingWhileMenuIsOpen', () => {
  assert.equal(inputBox(idleTyped), 'half-typed text');
  assert.equal(inputBox(idleEmpty), '');
  assert.equal(inputBox(list), undefined);
});

test('confirmShows_Should_LookOnlyAtMessageInConfirmationNotAtConversationAbove', () => {
  assert.equal(confirmShows(confirmNoCode, 'Reply with the single word OK.'), true);
  assert.equal(confirmShows(confirmCode, 'Create a file note.txt containing the single word one. Do nothing else.'), true);
  // the same words stand in the conversation above the menu, but the confirmation names another message
  assert.equal(confirmShows(confirmCode, 'Reply with the single word OK.'), false);
  assert.equal(confirmShows(list, 'Reply with the single word OK.'), false);
});

test('confirmShows_Should_FindMessageInConfirmationAsClaudeCodeNowWordsIt', () => {
  assert.equal(confirmShows(confirmNow, 'Create a file note.txt containing the word one. Reply with one word.'), true);
  // the message above the menu is not the one the confirmation names
  assert.equal(confirmShows(confirmNow, 'Reply with the single word OK'), false);
  assert.equal(optionKey(confirmNow, 'code'), '3');
});

test('optionKey_Should_FindNumberOfActionAsMenuNumbersIt', () => {
  assert.equal(optionKey(confirmCode, 'both'), '1');
  assert.equal(optionKey(confirmCode, 'code'), '3');
  assert.equal(optionKey(confirmCode, 'summarize-up-to'), '5');
  assert.equal(optionKey(confirmNoCode, 'conversation'), '1');
  assert.equal(optionKey(confirmNoCode, 'summarize-from'), '2');
  assert.equal(optionKey(confirmNoCode, 'code'), undefined);
});

/**
 * A stand-in for Claude Code's rewind menu: the prompt box, the list of sent messages, the confirmation.
 * @param {readonly { text: string, code: boolean, ago?: string }[]} prompts — ago: as the confirmation tells it, 1m ago
 *   unless told
 * @param {string} [typed] - text already in the prompt box
 */
function fakeClaude(prompts, typed = '') {
  /**
   * refill — like Claude Code, the rewound message reaches the box a moment after the menu closes: on the second look;
   * after a summary from it, once the summary is written: on the thirtieth
   * @type {{ mode: 'input' | 'list' | 'confirm', input: string, cursor: number, escAt: number, keys: number, restored: { text: string, action: string, ago?: string } | undefined, refill: { text: string, looks: number, after: number } | undefined }}
   */
  const state = { mode: 'input', input: typed, cursor: prompts.length, escAt: -1, keys: 0, restored: undefined, refill: undefined };
  const labels = { both: 'Restore code and conversation', conversation: 'Restore conversation', code: 'Restore code', from: 'Summarize from here', upTo: 'Summarize up to here' };
  const options = (/** @type {{ code: boolean }} */ prompt) =>
    prompt.code ? [labels.both, labels.conversation, labels.code, labels.from, labels.upTo, 'Never mind'] : [labels.conversation, labels.from, labels.upTo, 'Never mind'];
  const screen = () => {
    if (state.refill !== undefined && ++state.refill.looks >= state.refill.after) {
      state.input = state.refill.text;
      state.refill = undefined;
    }
    if (state.mode === 'input') return `● OK\n────────\n❯ ${state.input}\n────────\n  ⏵⏵ accept edits on`;
    if (state.mode === 'list') {
      const rows = [...prompts.map((p) => p.text.slice(0, 20)), '(current)'].map((label, i) => `${i === state.cursor ? '❯' : ' '} ${label}`);
      return `▔▔▔▔\n Rewind\n Restore the code and/or conversation to the point before…\n${rows.join('\n')}\n Enter to continue · Esc to cancel`;
    }
    const prompt = prompts[state.cursor];
    return `▔▔▔▔\n  Rewind\n\n  Restore to the point before you sent this message:\n\n  │ ${prompt?.text}\n  │ (${prompt?.ago ?? '1m ago'})\n\n  The conversation goes back to before this message.\n\n${options(prompt ?? { code: false })
      .map((o, i) => `  ${i + 1}. ${o}`)
      .join('\n')}`;
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
          state.keys++;
          if (state.mode === 'input' && key === 'esc') {
            // a second Esc right after the first clears the box, or opens the menu when the box is empty
            if (state.escAt === state.keys - 1) {
              if (state.input === '') state.mode = 'list';
              state.input = '';
            }
            state.escAt = state.keys;
          } else if (state.mode === 'input' && key === 'enter' && state.input === '/rewind') {
            state.mode = 'list';
            state.input = '';
            state.cursor = prompts.length;
          } else if (state.mode === 'list' && key === 'up') state.cursor = Math.max(0, state.cursor - 1);
          else if (state.mode === 'list' && key === 'down') state.cursor = Math.min(prompts.length, state.cursor + 1);
          else if (state.mode === 'list' && key === 'esc') state.mode = 'input';
          else if (state.mode === 'list' && key === 'enter' && state.cursor < prompts.length) state.mode = 'confirm';
          else if (state.mode === 'confirm' && key === 'esc') state.mode = 'list';
          else if (state.mode === 'confirm' && /^\d$/.test(key)) {
            const prompt = prompts[state.cursor];
            const action = prompt === undefined ? undefined : options(prompt)[Number(key) - 1];
            if (action === undefined || prompt === undefined) continue;
            if (action === 'Never mind') {
              state.mode = 'list';
              continue;
            }
            state.restored = { text: prompt.text, action, ...(prompt.ago === undefined ? {} : { ago: prompt.ago }) };
            state.mode = 'input';
            state.input = '';
            if (action === labels.conversation || action === labels.both || action === labels.from) state.refill = { text: prompt.text, looks: 0, after: action === labels.from ? 30 : 2 };
          }
        }
        return true;
      },
    },
  };
}

const sent = [
  { text: 'Create a file note.txt containing the word one', code: true },
  { text: 'Reply with the single word OK', code: false },
  { text: 'Append the word two to note.txt', code: true },
];
const noWait = async () => {};

test('driveRewind_Should_RestoreChosenMessageAndTakeItsTextOutOfTerminalBox', async () => {
  const claude = fakeClaude(sent);

  const outcome = await driveRewind(claude.terminal, { stepsUp: 2, prompt: 'Reply with the single word OK', sentAt: undefined, now: 0, action: 'conversation', wait: noWait });

  assert.deepEqual(outcome, { ok: true, restoredPrompt: true });
  assert.deepEqual(claude.state.restored, { text: 'Reply with the single word OK', action: 'Restore conversation' });
  assert.deepEqual({ mode: claude.state.mode, input: claude.state.input }, { mode: 'input', input: '' });
});

test('driveRewind_Should_FindMessageWhenMenuListsOneMoreOrLessThanCounted', async () => {
  for (const stepsUp of [1, 3]) {
    const claude = fakeClaude(sent);

    const outcome = await driveRewind(claude.terminal, { stepsUp, prompt: 'Reply with the single word OK', sentAt: undefined, now: 0, action: 'conversation', wait: noWait });

    assert.deepEqual(outcome, { ok: true, restoredPrompt: true }, `counted ${stepsUp} steps up`);
    assert.deepEqual(claude.state.restored, { text: 'Reply with the single word OK', action: 'Restore conversation' });
  }
});

// A message sent again word for word is told apart by when it was sent, as the confirmation tells: the menu listing
// more than counted, the counted place holds the same words sent hours earlier — no match — and the message asked for,
// two minutes old, is found beside it
test('driveRewind_Should_TellMessagesOfTheSameWordsApartByTheirAge', async () => {
  const same = 'Add the harbour weather station as a source';
  const now = Date.parse('2026-11-18T18:02:00Z');
  const claude = fakeClaude([
    { text: same, code: false, ago: '8h ago' },
    { text: 'That station reads too warm', code: false, ago: '6h ago' },
    { text: same, code: false, ago: '2m ago' },
    { text: same, code: false, ago: '1m ago' },
  ]);

  const outcome = await driveRewind(claude.terminal, { stepsUp: 4, prompt: same, sentAt: now - 2 * 60_000, now, action: 'conversation', wait: noWait });

  assert.deepEqual({ outcome, restored: claude.state.restored }, { outcome: { ok: true, restoredPrompt: true }, restored: { text: same, action: 'Restore conversation', ago: '2m ago' } });
});

// The confirmation tells the message's age as it is when shown — the menu gone through key by key, neighbours tried —
// seconds after the rewind began: a message sent just before is still found
test('driveRewind_Should_FindMessageSentSecondsAgo_When_ConfirmationShowsItOlderByTheTimeOfTheKeys', async () => {
  const now = Date.parse('2026-11-18T18:02:00Z');
  const claude = fakeClaude([{ text: 'Rename the column to price', code: false, ago: '40s ago' }]);

  const outcome = await driveRewind(claude.terminal, { stepsUp: 1, prompt: 'Rename the column to price', sentAt: now - 5000, now, action: 'conversation', wait: noWait });

  assert.deepEqual({ outcome, restored: claude.state.restored }, { outcome: { ok: true, restoredPrompt: true }, restored: { text: 'Rename the column to price', action: 'Restore conversation', ago: '40s ago' } });
});

// /rewind typed in the page's box opens the menu in the terminal, where the page cannot go on with it
test('driveRewind_Should_CloseRewindMenuLeftOpenFirst', async () => {
  const claude = fakeClaude(sent);
  claude.state.mode = 'list';

  const outcome = await driveRewind(claude.terminal, { stepsUp: 2, prompt: 'Reply with the single word OK', sentAt: undefined, now: 0, action: 'conversation', wait: noWait });

  assert.deepEqual({ outcome, restored: claude.state.restored }, { outcome: { ok: true, restoredPrompt: true }, restored: { text: 'Reply with the single word OK', action: 'Restore conversation' } });
});

// The menu's words quoted in the conversation over the box are no menu: Esc there twice would itself open the rewind
test('driveRewind_Should_PressNoEsc_When_ConversationOverTheBoxQuotesTheMenu', async () => {
  const claude = fakeClaude(sent);
  /** @type {string[]} */
  const pressed = [];
  const terminal = {
    ...claude.terminal,
    read: async () => `${pressed.length === 0 ? 'It said: Restore to the point before you sent this message\n' : ''}${await claude.terminal.read()}`,
    keys: async (/** @type {string[]} */ ...keys) => {
      pressed.push(...keys);
      return claude.terminal.keys(...keys);
    },
  };

  await driveRewind(terminal, { stepsUp: 2, prompt: 'Reply with the single word OK', sentAt: undefined, now: 0, action: 'conversation', wait: noWait });

  assert.equal(pressed[0], 'enter', 'the first key sends /rewind');
});

// A summary from the message is written by the model, a while: the message comes back into the box once it is done
test('driveRewind_Should_TakeMessageBack_When_SummaryFromItTakesAWhile', async () => {
  const claude = fakeClaude(sent);

  const outcome = await driveRewind(claude.terminal, { stepsUp: 2, prompt: 'Reply with the single word OK', sentAt: undefined, now: 0, action: 'summarize-from', wait: noWait });

  assert.deepEqual({ outcome, box: claude.state.input }, { outcome: { ok: true, restoredPrompt: true }, box: '' });
});

test('driveRewind_Should_ClearTextTypedInTerminalBeforeOpeningMenu', async () => {
  const claude = fakeClaude(sent, 'half-typed text');

  const outcome = await driveRewind(claude.terminal, { stepsUp: 1, prompt: 'Append the word two to note.txt', sentAt: undefined, now: 0, action: 'code', wait: noWait });

  assert.deepEqual(outcome, { ok: true, restoredPrompt: false });
  assert.deepEqual(claude.state.restored, { text: 'Append the word two to note.txt', action: 'Restore code' });
});

test('driveRewind_Should_RefuseToRestoreCodeOfMessageWithoutCodeChangesAndCloseMenu', async () => {
  const claude = fakeClaude(sent);

  const outcome = await driveRewind(claude.terminal, { stepsUp: 2, prompt: 'Reply with the single word OK', sentAt: undefined, now: 0, action: 'code', wait: noWait });

  assert.deepEqual(outcome, { ok: false, error: 'no-code-changes' });
  assert.equal(claude.state.restored, undefined);
  assert.equal(claude.state.mode, 'input');
});

// A message without code changes has no code options in the menu: the code and the conversation asked for, the
// conversation is restored — there is no code to restore
test('driveRewind_Should_RestoreConversation_When_CodeAndConversationAskedOfMessageWithoutCodeChanges', async () => {
  const claude = fakeClaude(sent);

  const outcome = await driveRewind(claude.terminal, { stepsUp: 2, prompt: 'Reply with the single word OK', sentAt: undefined, now: 0, action: 'both', wait: noWait });

  assert.deepEqual(outcome, { ok: true, restoredPrompt: true });
  assert.deepEqual(claude.state.restored, { text: 'Reply with the single word OK', action: 'Restore conversation' });
});

test('driveRewind_Should_GiveUpAndCloseMenuWhenMessageIsNotInIt', async () => {
  const claude = fakeClaude(sent);

  const outcome = await driveRewind(claude.terminal, { stepsUp: 2, prompt: 'A message from another session', sentAt: undefined, now: 0, action: 'conversation', wait: noWait });

  assert.deepEqual(outcome, { ok: false, error: 'message-not-found' });
  assert.equal(claude.state.restored, undefined);
  assert.equal(claude.state.mode, 'input');
});

/** @param {string} uuid @param {string | null} parentUuid @param {unknown} content */
const user = (uuid, parentUuid, content) => ({ type: 'user', uuid, parentUuid, message: { role: 'user', content } });
/** @param {string} uuid @param {string} parentUuid */
const reply = (uuid, parentUuid) => ({ type: 'assistant', uuid, parentUuid, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });

test('rewindTarget_Should_CountMessagesTheMenuListsAfterChosenOne', () => {
  const records = [
    user('p1', null, 'Build it'),
    reply('a1', 'p1'),
    user('r1', 'a1', [{ type: 'tool_result', tool_use_id: 't', content: 'done' }]),
    reply('a2', 'r1'),
    user('c1', 'a2', '<command-name>/model</command-name>'),
    { ...user('p2', 'c1', [{ type: 'text', text: 'Now test it' }]), timestamp: '2026-11-18T18:00:08.250Z' },
    reply('a3', 'p2'),
    user('i1', 'a3', [{ type: 'text', text: '[Request interrupted by user]' }]),
    user('p3', 'i1', 'Rewound later'),
    user('p4', 'i1', 'And deploy'),
  ];

  assert.deepEqual(rewindTarget(records, 'p2'), { stepsUp: 2, prompt: 'Now test it', sentAt: Date.parse('2026-11-18T18:00:08.250Z') });
  assert.deepEqual(rewindTarget(records, 'p1'), { stepsUp: 3, prompt: 'Build it', sentAt: undefined });
  assert.equal(rewindTarget(records, 'p3'), undefined, 'a rewound message is no longer in the menu');
  assert.equal(rewindTarget(records, 'a1'), undefined);
});
