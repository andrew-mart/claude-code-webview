import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBtw, readBtw, sidePanel } from '../server/btw.js';

/**
 * A stand-in for Claude Code's terminal with /btw. Enter on "/btw …" in the box opens the side answer over the box —
 * the side questions asked before listed over it, one line each: "Answering…" for a few looks, then the answer
 * `height` lines at a time, indented and with a blank line above and below, as Claude Code draws it; ↓ scrolls it by three
 * lines, Esc closes it.
 * @param {{ answer: readonly string[], height?: number, answeringLooks?: number, box?: string, asks?: boolean, columns?: number, before?: readonly string[], open?: boolean }} side —
 *   box: text in the prompt box before the question; asks: false — Enter leaves the question in the box, as with a
 *   conversation that has nothing in it yet; columns: the terminal's width, the panel's top edge spans it; before: the
 *   side questions asked before; open: the panel of the last of them left open in the terminal
 */
function fakeClaude({ answer, height = 5, answeringLooks = 2, box = '', asks = true, columns = 80, before = [], open = false }) {
  const last = before.at(-1);
  /** @type {{ box: string, typed: string[], keys: string[], asked: string[], overlay: { question: string, looksLeft: number, scroll: number } | undefined }} */
  const state = { box, typed: [], keys: [], asked: [...before], overlay: open && last !== undefined ? { question: last, looksLeft: 0, scroll: 0 } : undefined };
  const screen = () => {
    const above = ['● Earlier answer', '✻ Worked for 5s'];
    const overlay = state.overlay;
    if (overlay === undefined) return [...above, '─'.repeat(30), `❯ ${state.box}`, '─'.repeat(30), '  ⏵⏵ auto mode on'].join('\n');
    const asked = state.asked.map((one) => `    /btw ${one}`);
    const footer = state.asked.length > 1 ? '    ⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close' : '    ↑/↓ to scroll · c to copy · f to fork · Esc to close';
    if (overlay.looksLeft > 0) {
      overlay.looksLeft--;
      return [...above, '▔'.repeat(columns), '', ...asked, '      ✽ Answering…', '    Esc to close'].join('\n');
    }
    const shown = answer.slice(overlay.scroll, overlay.scroll + height).map((line) => (line === '' ? '' : `      ${line}`));
    return [...above, '▔'.repeat(columns), '', ...asked, '', ...shown, '', footer].join('\n');
  };
  /** @type {import('../server/claude-screen.js').Terminal} */
  const terminal = {
    read: async () => screen(),
    text: async (text) => {
      state.typed.push(text);
      state.box += text;
      return true;
    },
    keys: async (...keys) => {
      for (const key of keys) {
        state.keys.push(key);
        if (key === 'enter' && asks && state.box.startsWith('/btw ')) {
          state.overlay = { question: state.box.slice('/btw '.length), looksLeft: answeringLooks, scroll: 0 };
          state.asked.push(state.overlay.question);
          state.box = '';
        }
        if (key === 'down' && state.overlay !== undefined) state.overlay.scroll = Math.min(state.overlay.scroll + 3, Math.max(0, answer.length - height));
        if (key === 'esc') state.overlay = undefined;
      }
      return true;
    },
  };
  return { state, terminal };
}

const noWait = async () => {};
const question = 'which file holds the retry limit?';
/** Five lines in view, three more per ↓: blank lines of the answer fall on the edges of the views. */
const answer = [
  'The limit is in src/config.ts:',
  '',
  '  export const maxRetries = 5;',
  'The queue reads it on start,',
  '',
  'so a restart is needed',
  'after a change.',
  '',
  'Tests use 2 retries:',
  '  test/setup.ts sets it.',
];

// The answer is longer than the side panel shows at once: it is read to the end, and the panel is closed for the next prompt
test('driveBtw_Should_AskInTerminal_And_GiveWholeAnswerScrolledThrough_And_CloseIt', async () => {
  const claude = fakeClaude({ answer });

  const outcome = await driveBtw(claude.terminal, { question, wait: noWait });

  assert.deepEqual(outcome, { ok: true, answer: answer.join('\n') });
  assert.deepEqual({ typed: claude.state.typed, open: claude.state.overlay !== undefined, box: claude.state.box }, { typed: [`/btw ${question}`], open: false, box: '' });
});

// A draft typed in the terminal would run into the question: the box is left as it is
test('driveBtw_Should_LeaveTerminalAlone_When_ItsBoxHoldsText', async () => {
  const claude = fakeClaude({ answer, box: 'half a prompt' });

  const outcome = await driveBtw(claude.terminal, { question, wait: noWait });

  assert.deepEqual({ outcome, typed: claude.state.typed, box: claude.state.box }, { outcome: { ok: false, error: 'box-not-empty' }, typed: [], box: 'half a prompt' });
});

// Esc in a busy terminal stops Claude's turn: with no side panel to close, no Esc is pressed
test('driveBtw_Should_PressNoEsc_When_QuestionDoesNotOpenSidePanel', async () => {
  const claude = fakeClaude({ answer, asks: false });

  const outcome = await driveBtw(claude.terminal, { question, wait: noWait });

  assert.deepEqual({ outcome, keys: claude.state.keys }, { outcome: { ok: false, error: 'not-asked' }, keys: ['enter'] });
});

// A side panel that never gets its answer is closed after a few minutes, and the terminal is free again
test('driveBtw_Should_ClosePanel_When_AnswerDoesNotCome', async () => {
  const claude = fakeClaude({ answer, answeringLooks: 10_000 });

  const outcome = await driveBtw(claude.terminal, { question, wait: noWait });

  assert.deepEqual({ outcome, keys: claude.state.keys, open: claude.state.overlay !== undefined }, { outcome: { ok: false, error: 'no-answer' }, keys: ['enter', 'esc'], open: false });
});

// The panel as Claude Code 2.1 draws it at 80 columns: its top edge under the effort label, a long question cut to one
// line with an ellipsis, the answer indented by six between blank lines and wrapped at the 74 columns left
test('sidePanel_Should_ReadAnswerOfThisQuestion_FromPanelAsClaudeCodeDrawsIt', () => {
  const long = 'which word did you reply with, and how many letters does it have, counting every one of them?';
  const top = [' ▐▛███▛█   Claude Code v2.1.296', '❯ Reply with just the word: ready', '● ready', '✻ Churned for 4s'];
  const edge = `${'▔'.repeat(60)} ◉ xhigh · /effort ▔`;
  const asked = ['    /btw which word did you reply with, and how many letters does it have, cou…'];
  const answering = [...top, edge, '', ...asked, '      ✢ Answering…', '    Esc to close'].join('\n');
  const answered = [...top, edge, '', ...asked, '', '      The word is ready — five letters:   ', '', '        r-e-a-d-y', '', '    ↑/↓ to scroll · c to copy · f to fork · Esc to close'].join('\n');

  assert.deepEqual(
    [sidePanel(answering, long), sidePanel(answered, long), sidePanel(answered, 'another question')],
    [{ state: 'answering' }, { state: 'answered', lines: ['The word is ready — five letters:', '', '  r-e-a-d-y'], width: 74 }, undefined],
  );
});

// The panel wraps the answer at its width (here 30 − 6 = 24 columns): the wrapped lines are joined again, so the page
// wraps them at its own width; a table's rows stay as they are, and a line that was not full stays a line of its own
test('driveBtw_Should_JoinLinesThePanelWrapped_ButNotTableRowsOrShortLines', async () => {
  const wrapped = ['The queue reads the', 'limit on start, so a', 'restart is needed.', 'Two lines:', '┌──────┬──────┐', '│ Part │ MR   │', '└──────┴──────┘', '- one item that runs', '  over the edge'];
  const claude = fakeClaude({ answer: wrapped, height: 20, columns: 30 });

  const outcome = await driveBtw(claude.terminal, { question, wait: noWait });

  assert.deepEqual(outcome, {
    ok: true,
    answer: ['The queue reads the limit on start, so a restart is needed.', 'Two lines:', '┌──────┬──────┐', '│ Part │ MR   │', '└──────┴──────┘', '- one item that runs over the edge'].join('\n'),
  });
});

// Claude Code keeps the side questions asked: its panel lists the earlier ones over the latest, whose answer it shows,
// to be browsed with ⇧←/→ — the answer read is this question's, the latest
test('sidePanel_Should_ReadAnswerOfLatestQuestion_When_EarlierOnesAreListedOverIt', () => {
  const top = ['● Earlier answer', '✻ Brewed for 2m'];
  const edge = '▔'.repeat(80);
  const asked = ['    /btw which remote does the repo have?', `    /btw ${question}`];
  const answering = [...top, edge, '', ...asked, '      ✢ Answering…', '    Esc to close'].join('\n');
  const answered = [...top, edge, '', ...asked, '', '      The limit is in src/config.ts.', '', '    ⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close'].join('\n');

  assert.deepEqual(
    [sidePanel(answering, question), sidePanel(answered, question), sidePanel(answered, 'which remote does the repo have?')],
    [{ state: 'answering' }, { state: 'answered', lines: ['The limit is in src/config.ts.'], width: 74 }, undefined],
  );
});

// A side panel left open in the terminal — an answer read there — covers the prompt box: it is closed first, then the
// question asked and its answer read
test('driveBtw_Should_CloseSidePanelLeftOpen_ThenAsk', async () => {
  const claude = fakeClaude({ answer, before: ['which remote does the repo have?'], open: true });

  const outcome = await driveBtw(claude.terminal, { question, wait: noWait });

  assert.deepEqual({ outcome, first: claude.state.keys[0], typed: claude.state.typed, open: claude.state.overlay !== undefined }, { outcome: { ok: true, answer: answer.join('\n') }, first: 'esc', typed: [`/btw ${question}`], open: false });
});

// The page lost its request while Claude answered — the viewer restarted, the network dropped — and asks again: the
// panel open for the question is read to its end and closed, nothing typed into the terminal
test('readBtw_Should_ReadAnswerOfPanelOpenForQuestion_WithoutAskingAgain_AndCloseIt', async () => {
  const claude = fakeClaude({ answer, before: [question], open: true });

  const outcome = await readBtw(claude.terminal, { question, wait: noWait });

  assert.deepEqual({ outcome, typed: claude.state.typed, open: claude.state.overlay !== undefined }, { outcome: { ok: true, answer: answer.join('\n') }, typed: [], open: false });
});

// No panel open for the question — closed in the terminal, or open for another one — is told, nothing pressed: Esc in
// the prompt box would stop Claude's turn
test('readBtw_Should_TellPanelClosed_When_NoneIsOpenForQuestion_PressingNothing', async () => {
  const closed = fakeClaude({ answer });
  const other = fakeClaude({ answer, before: ['which remote does the repo have?'], open: true });

  const outcomes = [await readBtw(closed.terminal, { question, wait: noWait }), await readBtw(other.terminal, { question, wait: noWait })];

  assert.deepEqual({ outcomes, keys: [closed.state.keys, other.state.keys] }, { outcomes: [{ ok: false, error: 'panel-closed' }, { ok: false, error: 'panel-closed' }], keys: [[], []] });
});

// A session with many side questions: Claude Code folds the earliest into one line over the list — "(+5 earlier /btw)" —
// and the panel is still this question's, answering and then answered
test('sidePanel_Should_ReadPanel_When_EarliestQuestionsAreFoldedIntoOneLine', () => {
  const earlier = ['how big is the queue?', 'which file holds the timeout?', 'is the cache shared?', 'who calls flush?', 'what does retry do?'].map((one) => `    /btw ${one}`);
  const top = ['● Done.', '▔'.repeat(80), '', '    (+5 earlier /btw)', ...earlier, `    /btw ${question}`, ''];
  const answering = [...top, '      * Answering…', '', '    ⇧←/→ to browse · x to clear history · Esc to close'].join('\n');
  const answered = [...top, '      The limit is in src/config.ts.', '', '    ⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close'].join('\n');

  assert.deepEqual([sidePanel(answering, question)?.state, sidePanel(answered, question)], ['answering', { state: 'answered', lines: ['The limit is in src/config.ts.'], width: 74 }]);
});
