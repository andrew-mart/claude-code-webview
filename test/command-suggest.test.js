import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandQuery, completeCommand, parseCommands, rankCommands } from '../public/model/command-suggest.js';

/** @param {string} name @param {string} about @param {string} [source] */
const command = (name, about, source = 'built-in') => ({ name, hint: '', about, source });
const offered = [
  command('/compact', 'Free up context by summarizing the conversation so far.'),
  command('/config', 'Open the Settings interface.'),
  command('/code-style', 'Use when the task involves code in any way.', 'personal'),
  command('/superpowers:brainstorming', 'Explore an idea before building it.', 'superpowers'),
  command('/context', 'Visualize current context usage.'),
  command('/tdd', 'Test-driven development.', 'personal'),
];

// A command is offered while its name is typed: the box's first word, starting with a slash, up to the caret in it —
// not once the caret is past it, nor for a slash elsewhere
test('commandQuery_Should_TakeFirstWordStartingWithSlash_WhileCaretIsInIt', () => {
  assert.deepEqual(
    [commandQuery('/co', 3), commandQuery('/', 1), commandQuery('  /co', 5), commandQuery('/compact ', 9), commandQuery('/co more', 2), commandQuery('see /co', 7), commandQuery('/co', 0), commandQuery('', 0)],
    ['/co', '/', '/co', undefined, '/c', undefined, undefined, undefined],
  );
});

// What is typed after the slash finds commands: those whose name starts with it first, then those with a part after a
// colon that does — a plugin's skill — then those with it inside the name, then in what they do; the shorter name first
// among alike. A bare slash offers the user's own first, then the built-in ones, then the plugins'
test('rankCommands_Should_PutNamesStartingWithQueryFirst_ThenPartsThenInsideThenDescription', () => {
  const names = (/** @type {string} */ query) => rankCommands(offered, query).map((one) => one.name);
  assert.deepEqual(
    [names('/co'), names('/brain'), names('/ext'), names('/summar'), names('/'), names('/zzz')],
    [
      ['/config', '/compact', '/context', '/code-style'],
      ['/superpowers:brainstorming'],
      ['/context', '/compact'],
      ['/compact'],
      ['/code-style', '/tdd', '/compact', '/config', '/context', '/superpowers:brainstorming'],
      [],
    ],
  );
});

// The command picked takes the place of the word typed — what was after the caret of it too — and a space after it
// leaves the caret ready for its arguments; the rest of the text stays
test('completeCommand_Should_PutCommandInPlaceOfWordTyped_WithSpaceAfter', () => {
  assert.deepEqual(
    [completeCommand('/co', 3, '/compact'), completeCommand('/cofix the bug', 3, '/compact'), completeCommand('  /co rest', 5, '/config')],
    [
      { text: '/compact ', caret: 9 },
      { text: '/compact the bug', caret: 9 },
      { text: '  /config rest', caret: 10 },
    ],
  );
});

// The viewer's reply: its commands as they are, one that is not a command left out, any other shape none
test('parseCommands_Should_TakeCommandsOfReply_LeavingOutWhatIsNoCommand', () => {
  assert.deepEqual(
    [parseCommands([command('/tdd', 'TDD', 'personal'), { name: 7 }, 'x']), parseCommands({ commands: [] })],
    [[command('/tdd', 'TDD', 'personal')], []],
  );
});
