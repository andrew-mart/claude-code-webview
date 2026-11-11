// An Antigravity CLI (agy) home for tests, as agy keeps it: a transcript for each conversation that has one, its
// request the first step; the summaries agy keeps of them (conversation_summaries.db); the prompts typed in agy's
// terminal (history.jsonl).
import { mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tempDir } from './temp-dir.js';

/**
 * @typedef {{ id: string, request?: string, summary?: { title: string, folder: string, depth?: number, parent?: string } }} TestConversation
 *   — request: what its transcript begins with, none — no transcript; summary: agy's of it — folder, a file URI —
 *   none, none kept yet
 */

/**
 * @param {{ conversations: readonly TestConversation[], typedIn: readonly string[] }} home — typedIn: the conversations a
 *   prompt was typed to
 * @returns {Promise<string>} — the home's folder
 */
export async function agyHome({ conversations, typedIn }) {
  const home = tempDir('ccw-agy-');
  for (const { id, request } of conversations) {
    if (request === undefined) continue;
    const logs = join(home, 'brain', id, '.system_generated', 'logs');
    await mkdir(logs, { recursive: true });
    const step = { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-10T06:35:00Z', content: `<USER_REQUEST>${request}</USER_REQUEST>` };
    await writeFile(join(logs, 'transcript_full.jsonl'), `${JSON.stringify(step)}\n`);
  }
  const db = new DatabaseSync(join(home, 'conversation_summaries.db'));
  db.exec('CREATE TABLE conversation_summaries (conversation_id text, title text NOT NULL DEFAULT "", workspace_uris text NOT NULL, nesting_depth integer NOT NULL DEFAULT 0, parent_conversation_id text NOT NULL DEFAULT "", PRIMARY KEY (conversation_id))');
  const insert = db.prepare('INSERT INTO conversation_summaries (conversation_id, title, workspace_uris, nesting_depth, parent_conversation_id) VALUES (?, ?, ?, ?, ?)');
  for (const { id, summary } of conversations) {
    if (summary === undefined) continue;
    const { title, folder, depth = 0, parent = '' } = summary;
    insert.run(id, title, JSON.stringify([folder]), depth, parent);
  }
  db.close();
  await writeFile(join(home, 'history.jsonl'), typedIn.map((id) => `${JSON.stringify({ display: 'go on', timestamp: 1, workspace: 'D:\\dev\\notes', conversationId: id })}\n`).join(''));
  return home;
}
