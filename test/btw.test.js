import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBtw, sidePanel } from '../server/btw.js';

/**
 * A stand-in for Claude Code's terminal with /btw. Enter on "/btw …" in the box opens the side answer over the box:
 * "Answering…" for a few looks, then the answer `height` lines at a time, indented and with a blank line above and
 * below, as Claude Code draws it; ↓ scrolls it by three lines, Esc closes it.
 * @param {{ answer: readonly string[], height?: number, answeringLooks?: number, box?: string, asks?: boolean, columns?: number }} side —
 *   box: text in the prompt box before the question; asks: false — Enter leaves the question in the box, as with a
 *   conversation that has nothing in it yet; columns: the terminal's width, the panel's top edge spans it
 */
function fakeClaude({ answer, height = 5, answeringLooks = 2, box = '', asks = true, columns = 80 }) {
  /** @type {{ box: string, typed: string[], keys: string[], overlay: { question: string, looksLeft: number, scroll: number } | undefined }} */
  const state = { box, typed: [], keys: [], overlay: undefined };
  const screen = () => {
    const above = ['● Earlier answer', '✻ Worked for 5s'];
    const overlay = state.overlay;
    if (overlay === undefined) return [...above, '─'.repeat(30), `❯ ${state.box}`, '─'.repeat(30), '  ⏵⏵ auto mode on'].join('\n');
    if (overlay.looksLeft > 0) {
      overlay.looksLeft--;
      return [...above, '▔'.repeat(columns), '', `    /btw ${overlay.question}`, '      ✽ Answering…', '    Esc to close'].join('\n');
    }
    const shown = answer.slice(overlay.scroll, overlay.scroll + height).map((line) => (line === '' ? '' : `      ${line}`));
    return [...above, '▔'.repeat(columns), '', `    /btw ${overlay.question}`, '', ...shown, '', '    ↑/↓ to scroll · c to copy · f to fork · Esc to close'].join('\n');
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
