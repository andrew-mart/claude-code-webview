import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { agyHome } from '../test-support/agy-home.js';
import { createAgyConversations } from '../server/agy-conversations.js';

// The conversations agy keeps a transcript of, each with what agy says of it: its title, its folder — given as a file
// URI — and whether someone works in it: one agy titled, or a prompt was typed to in its terminal; one with neither is a
// program's run, agy -p. A subagent's conversation is part of its parent's, not one of its own; one agy has not summed
// up yet is a program's until it does, its folder unknown
test('agyConversations_Should_ListTopConversationsWithTheirTitleFolderAndWhoRunsThem', async () => {
  const home = await agyHome({
    conversations: [
      { id: 'a1', request: 'Count the shop tests', summary: { title: 'Count the shop tests', folder: 'file:///D:/dev/shop' } },
      { id: 'b2', request: 'Summarize the log', summary: { title: '', folder: 'file:///D:/dev/shop' } },
      { id: 'c3', request: 'Tidy the notes', summary: { title: '', folder: 'file:///home/ann/notes' } },
      { id: 'd4', request: 'Read the config', summary: { title: 'Read the config', folder: 'file:///D:/dev/shop', depth: 1, parent: 'a1' } },
      { id: 'e5', request: 'Just begun' },
      { id: 'f6', summary: { title: 'Gone', folder: 'file:///D:/dev/shop' } },
    ],
    typedIn: ['c3'],
  });

  const listed = await createAgyConversations(home).list();
  /** @param {string} id */
  const transcriptOf = (id) => join(home, 'brain', id, '.system_generated', 'logs', 'transcript_full.jsonl');

  assert.deepEqual(
    listed.map(({ id, path, facts }) => ({ id, itsTranscript: path === transcriptOf(id), facts })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    [
      { id: 'a1', itsTranscript: true, facts: { title: 'Count the shop tests', cwd: 'D:/dev/shop', kind: 'interactive' } },
      { id: 'b2', itsTranscript: true, facts: { title: undefined, cwd: 'D:/dev/shop', kind: 'sdk' } },
      { id: 'c3', itsTranscript: true, facts: { title: undefined, cwd: '/home/ann/notes', kind: 'interactive' } },
      { id: 'e5', itsTranscript: true, facts: { title: undefined, cwd: undefined, kind: 'sdk' } },
    ],
  );
});
