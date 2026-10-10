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
