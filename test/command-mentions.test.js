import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// DOMPurify binds to window on import (through markdown.js), so the DOM is set up before it loads.
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text, HTMLElement: window.HTMLElement, HTMLButtonElement: window.HTMLButtonElement, Element: window.Element, Node: window.Node });
const { renderMarkdown } = await import('../public/view/markdown.js');
const { commandOf, markCommands } = await import('../public/view/command-mentions.js');

/** An answer that names commands in its words, in code of its own, in a list — and paths, a link, a code block. */
const answer = [
  'Then run /clear and start the next phase with `/opsx:propose service-deploy`.',
  '',
  'The notes are in D:/dev/shop/notes and /home/ann/shop; and/or see https://example.com/clear.',
  '',
  'The service answers `/ready == 200`, and POST /score takes `POST /score` with the text.',
  '',
  '- /compact first, (/review-phase-end) after.',
  '',
  '```',
  '/clear',
  '```',
  '',
  '[open /model](https://example.com/help)',
].join('\n');

/** The answer as the feed shows it, its commands marked. */
function shown() {
  const element = window.document.createElement('div');
  element.append(renderMarkdown(answer));
  markCommands(element);
  window.document.body.append(element);
  return element;
}

// An answer copied as markdown keeps the commands it names as they were written: a command made a button is the
// answer's, not the page's
test('markdownOf_Should_KeepTheCommandsAnAnswerNames', async () => {
  const { markdownOf } = await import('../public/view/markdown-copy.js');
  const words = ['Then run /clear and start the next phase with `/opsx:propose service-deploy`.', '', '- /compact first, (/review-phase-end) after.'].join('\n');
  const element = window.document.createElement('div');
  element.append(renderMarkdown(words));
  markCommands(element);

  assert.equal(markdownOf(element), words);
});

// A slash command an answer names is a button that gives it for the prompt box: one in its words — a word of its own,
// not a part of a path or a link — just the command; one in code of its own, all the code, the command with what follows
// it — words, not a comparison. A code block, a link, and an address after its HTTP method are left as they are
test('markCommands_Should_MakeCommandsAnAnswerNamesButtons_NotPathsLinksOrCodeBlocks', () => {
  const commands = [...shown().querySelectorAll('button.command-mention')];

  assert.deepEqual(
    commands.map((command) => [command.textContent, commandOf(command)]),
    [
      ['/clear', '/clear'],
      ['/opsx:propose service-deploy', '/opsx:propose service-deploy'],
      ['/compact', '/compact'],
      ['/review-phase-end', '/review-phase-end'],
    ],
  );
});
