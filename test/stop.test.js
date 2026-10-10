import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveStop } from '../server/stop.js';

/**
 * A stand-in for Claude Code working on a prompt. Esc stops the turn: a prompt Claude had not started on comes back
 * into the box a moment later, wrapped at the terminal's width; otherwise the turn is marked as interrupted. When
 * Claude waits for input, Esc twice clears the box, or opens the rewind menu when the box is empty.
 * @param {{ prompt: string, started: boolean, typed?: string, stuck?: boolean }} turn — typed: text in the box before
 *   Esc; stuck: Esc twice does not clear the box
 */
function fakeClaude({ prompt, started, typed = '', stuck = false }) {
  /** @type {{ mode: 'working' | 'input' | 'menu', box: string, marks: number, refillIn: number, keys: number, escAt: number }} */
  const state = { mode: 'working', box: typed, marks: 0, refillIn: -1, keys: 0, escAt: -1 };
  const screen = () => {
    // time passes between looks: an Esc before a look and an Esc after it are not a double Esc
    state.escAt = -1;
    if (state.refillIn >= 0 && state.refillIn-- === 0) state.box = prompt;
    if (state.mode === 'menu') return '▔▔▔▔\n Rewind\n Restore the code and/or conversation to the point before…';
    const marks = Array.from({ length: state.marks }, () => '  ⎿  Interrupted · What should Claude do instead?');
    return ['● Earlier answer', ...marks, state.mode === 'working' ? '✶ Doodling…' : '', '────────', ...boxLines(state.box), '────────', '  ⏵⏵ auto mode on'].join('\n');
  };
  return {
    state,
    terminal: {
      read: async () => screen(),
      text: async () => true,
      keys: async (/** @type {string[]} */ ...keys) => {
        for (const key of keys) {
          state.keys++;
          if (key !== 'esc') continue;
          if (state.mode === 'working') {
            state.mode = 'input';
            if (started) state.marks++;
            else state.refillIn = 2;
          } else if (state.mode === 'input' && state.escAt === state.keys - 1 && !stuck) {
            if (state.box === '') state.mode = 'menu';
            state.box = '';
          }
          state.escAt = state.keys;
        }
        return true;
      },
    },
  };
}

/**
 * The box as Claude Code draws it: "❯ " before the first line, lines wrapped at 40 columns and indented by two spaces.
 * @param {string} text
 */
function boxLines(text) {
  const lines = text.split('\n').flatMap((line) => line.match(/.{1,38}(?:\s|$)/g) ?? ['']);
  return lines.map((line, index) => `${index === 0 ? '❯' : ' '} ${line.trimEnd()}`);
}

const noWait = async () => {};
const prompt = 'Write a detailed essay about the history of rivers in South America.\nKeep it short.';

test('driveStop_Should_GiveBackPromptClaudeHadNotStartedOnExactlyAsSentAndEmptyTerminalBox', async () => {
  const claude = fakeClaude({ prompt, started: false });

  const outcome = await driveStop(claude.terminal, { sent: ['An earlier question', prompt], wait: noWait });

  assert.deepEqual(outcome, { ok: true, prompt });
  assert.deepEqual({ mode: claude.state.mode, box: claude.state.box }, { mode: 'input', box: '' });
});

test('driveStop_Should_GiveBackPromptTypedInTerminalAsItsBoxShowsIt', async () => {
  const claude = fakeClaude({ prompt: 'Rename the helper\nand update its callers', started: false });

  const outcome = await driveStop(claude.terminal, { sent: ['An earlier question'], wait: noWait });

  assert.deepEqual(outcome, { ok: true, prompt: 'Rename the helper and update its callers' });
});

test('driveStop_Should_OnlyStopTurnClaudeHadStartedAndAnswerWithoutWaitingOutTimeout', async () => {
  const claude = fakeClaude({ prompt, started: true });
  let waited = 0;

  const outcome = await driveStop(claude.terminal, { sent: [prompt], wait: async (ms) => void (waited += ms) });

  assert.deepEqual(outcome, { ok: true, prompt: undefined });
  assert.equal(claude.state.mode, 'input');
  assert.ok(waited < 1000, `waited ${waited} ms for a turn that had already started`);
});

test('driveStop_Should_LeavePromptInTerminalWhenItsBoxDoesNotEmpty', async () => {
  const claude = fakeClaude({ prompt, started: false, stuck: true });

  const outcome = await driveStop(claude.terminal, { sent: [prompt], wait: noWait });

  assert.deepEqual(outcome, { ok: false, error: 'box-not-cleared' });
});
