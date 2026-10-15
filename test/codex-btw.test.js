import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveCodexBtw } from '../server/codex-btw.js';

const placeholder = 'Ask Codex to do anything';
const mainFooter = '  ? for shortcuts';
/** @param {string} key */
const sideFooter = (key) => `  Side from main thread · ${key} to switch`;

/**
 * A fake Codex 0.162: /btw in its box opens a side conversation that answers after a few looks; the key its footer
 * names goes back to the main thread — but Ctrl+/, which does not come through herdr on Windows. A thread with nothing
 * said yet opens none: the question is left in the box. answer: the side answer's lines; draft: what its box holds to
 * begin with; fresh: the thread has nothing said yet; switch: the key to go back, as Codex is set up; rows: how many lines
 * the terminal shows — what is over them scrolled off, kept in what it showed recently.
 * @param {{ answer: readonly string[], draft?: string, looksToAnswer?: number, fresh?: boolean, switchKey?: string, rows?: number }} options
 */
function fakeCodex({ answer, draft = '', looksToAnswer = 2, fresh = false, switchKey = 'f12', rows = 40 }) {
  let box = draft;
  /** @type {'main' | 'side'} */
  let view = 'main';
  let asked = '';
  let looks = 0;
  /** @type {string[]} */
  const keys = [];
  const main = ['› Reply with the single word one.', '• one', '  Worked for 4s • 8:00 PM', ''];
  const drawn = () => {
    if (view === 'main') return [...main, '', `› ${box === '' ? placeholder : box}`, '', '  ~ · GPT-6-Astra low', mainFooter];
    looks += 1;
    const answered = looks > looksToAnswer;
    return [...main, '', `› ${asked}`, ...(answered ? [...answer, '  Worked for 8s • 8:00 PM'] : ['Working (2s • esc to interrupt)']), '', '› Ask a follow-up question', '', '  ~ · GPT-6-Astra low', sideFooter(switchKey)];
  };
  const read = async () => drawn().slice(-rows).join('\n');
  const recent = async () => drawn().join('\n');
  const terminal = {
    read,
    /** @param {...string} pressed */
    keys: async (...pressed) => {
      for (const key of pressed) {
        keys.push(key);
        if (key === 'enter' && view === 'main' && box.startsWith('/btw ')) {
          asked = box.slice('/btw '.length);
          box = fresh ? asked : '';
          view = fresh ? 'main' : 'side';
        }
        if (key === switchKey && key !== 'ctrl+/' && view === 'side') view = 'main';
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
  return { terminal, recent, keys, view: () => view, box: () => box };
}

const wait = async () => undefined;

// A side question goes to Codex as its /btw: the answer of its side conversation is read off the screen, and Codex is
// switched back to the main thread with the key its footer names — the page's next prompt goes there, not into the side
// conversation. Its Ctrl+/ does not come through on Windows: the answer comes all the same, the terminal stays
test('driveCodexBtw_Should_ReadSideAnswer_AndSwitchBackWithKeyCodexNames', async () => {
  const f12 = fakeCodex({ answer: ['• The word was one,', '  as asked.'] });
  const ctrlSlash = fakeCodex({ answer: ['• one'], switchKey: 'ctrl+/' });

  const outcomes = [await driveCodexBtw(f12.terminal, { question: 'which word did\nyou reply with?', wait, recent: f12.recent }), await driveCodexBtw(ctrlSlash.terminal, { question: 'which word?', wait, recent: ctrlSlash.recent })];

  assert.deepEqual(
    { outcomes, keys: [f12.keys, ctrlSlash.keys], views: [f12.view(), ctrlSlash.view()] },
    {
      outcomes: [
        { ok: true, answer: 'The word was one,\nas asked.' },
        { ok: true, answer: 'one' },
      ],
      keys: [
        ['enter', 'f12'],
        ['enter', 'ctrl+/'],
      ],
      views: ['main', 'side'],
    },
  );
});

// An answer taller than the terminal is read whole: its start, scrolled off the screen, from what the terminal showed
// lately
test('driveCodexBtw_Should_ReadTallAnswerWhole_ItsStartFromWhatScrolledOff', async () => {
  const answer = ['• one', ...['two', 'three', 'four', 'five', 'six', 'seven', 'eight'].map((word) => `  ${word}`)];
  const codex = fakeCodex({ answer, rows: 8 });

  assert.deepEqual(await driveCodexBtw(codex.terminal, { question: 'count to eight', wait, recent: codex.recent }), { ok: true, answer: 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight' });
});

// A draft in Codex's box would run into the question: it is not asked
test('driveCodexBtw_Should_NotAsk_OverDraftInCodexsBox', async () => {
  const codex = fakeCodex({ answer: ['• one'], draft: 'half-typed' });

  assert.deepEqual(await driveCodexBtw(codex.terminal, { question: 'which word?', wait, recent: codex.recent }), { ok: false, error: 'box-not-empty' });
});

// A thread with nothing said yet opens no side conversation: the question Codex leaves in its box is taken out
test('driveCodexBtw_Should_TakeQuestionOutOfBox_When_CodexOpensNoSideConversation', async () => {
  const codex = fakeCodex({ answer: ['• one'], fresh: true });

  const outcome = await driveCodexBtw(codex.terminal, { question: 'which word?', wait, recent: codex.recent });

  assert.deepEqual({ outcome, box: codex.box(), view: codex.view() }, { outcome: { ok: false, error: 'not-asked' }, box: '', view: 'main' });
});
