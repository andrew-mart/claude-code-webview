// @ts-check
// The active branch of a conversation. A transcript only grows: rewinding in Claude Code does not delete anything,
// the next prompt simply points (parentUuid) to the same entry as the rewound one did. Of several prompts sent from
// one point the last one counts; the earlier ones, with everything that grew from them, are no longer the conversation.
import { isRecord } from '../public/model/narrow.js';

/**
 * turn — a message the user sent (not a tool result): only such siblings mean a rewind.
 * @typedef {{ uuid: string | undefined, parent: string | undefined, turn: boolean }} Link
 */

/**
 * @param {unknown} raw — a transcript entry
 * @returns {Link}
 */
export function linkOf(raw) {
  if (!isRecord(raw)) return { uuid: undefined, parent: undefined, turn: false };
  const uuid = typeof raw.uuid === 'string' ? raw.uuid : undefined;
  const parent = typeof raw.parentUuid === 'string' ? raw.parentUuid : undefined;
  const content = isRecord(raw.message) ? raw.message.content : undefined;
  const toolResults = Array.isArray(content) && content.some((block) => isRecord(block) && block.type === 'tool_result');
  return { uuid, parent, turn: raw.type === 'user' && raw.isSidechain !== true && raw.isMeta !== true && !toolResults };
}

/**
 * The text of a prompt entry: a string, or the text blocks beside its images.
 * @param {Record<string, unknown>} raw
 * @returns {string | undefined}
 */
export function promptText(raw) {
  const content = isRecord(raw.message) ? raw.message.content : undefined;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content.flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []));
  return texts.length === 0 ? undefined : texts.join('\n');
}

/**
 * Entries off the active branch: the rewound prompts and everything that grew from them.
 * @param {readonly Link[]} links — in file order
 * @param {string | undefined} rewoundAt — a prompt this page rewound to before: hidden at once, before the next prompt
 *   arrives and makes the fork visible in the transcript
 * @returns {Set<string>}
 */
export function rewoundEntries(links, rewoundAt) {
  /** @type {Map<string, string[]>} */
  const children = new Map();
  /** @type {Map<string, string[]>} */
  const turns = new Map();
  for (const { uuid, parent, turn } of links) {
    if (uuid === undefined || parent === undefined) continue;
    children.set(parent, [...(children.get(parent) ?? []), uuid]);
    if (turn) turns.set(parent, [...(turns.get(parent) ?? []), uuid]);
  }
  const roots = [...turns.values()].flatMap((siblings) => siblings.slice(0, -1));
  if (rewoundAt !== undefined) roots.push(rewoundAt);
  /** @type {Set<string>} */
  const hidden = new Set();
  for (const stack = roots; stack.length > 0; ) {
    const uuid = stack.pop();
    if (uuid === undefined || hidden.has(uuid)) continue;
    hidden.add(uuid);
    stack.push(...(children.get(uuid) ?? []));
  }
  return hidden;
}

/**
 * The prompt Claude Code took back into its box when the turn was stopped before Claude started on it — if it reached
 * the transcript anyway. The terminal no longer shows it in the conversation; the next prompt will point past it.
 * It is the last prompt, nothing answered it, and its words are the ones that came back.
 * @param {readonly unknown[]} records — the transcript entries in file order
 * @param {string} text — what came back into the box
 * @returns {string | undefined} — its uuid
 */
export function takenBackPrompt(records, text) {
  const at = records.findLastIndex((raw) => linkOf(raw).turn);
  const last = records[at];
  if (!isRecord(last)) return undefined;
  const answered = records.slice(at + 1).some((raw) => isRecord(raw) && raw.type === 'assistant');
  const words = promptText(last);
  return !answered && words !== undefined && sameWords(words, text) ? linkOf(last).uuid : undefined;
}

/**
 * The box and the transcript may space and break the same prompt differently.
 * @param {string} a
 * @param {string} b
 */
function sameWords(a, b) {
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
}
