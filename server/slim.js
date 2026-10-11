// @ts-check
// Transcript entry → what the feed in the browser needs. The rest (file snapshots, the system prompt,
// thinking signatures, the full file text before an edit) weighs megabytes and is not shown in the feed.
import { isRecord } from '../public/model/narrow.js';
import { linkImage, mapImages } from './images.js';

// queue-operation: Claude Code's notes on prompts waiting until it takes them (public/model/queue.js)
const shownTypes = new Set(['user', 'assistant', 'system', 'ai-title', 'custom-title', 'cost-state', 'queue-operation']);

/** Entry fields that public/model/entry.js and public/model/queue.js read. */
const shownFields = [
  'type',
  'subtype',
  'uuid',
  'timestamp',
  'isMeta',
  'isCompactSummary',
  'isApiErrorMessage',
  'message',
  'toolUseResult',
  'origin',
  'promptSource',
  'thinkingDurationMs',
  'content',
  'level',
  'durationMs',
  'compactMetadata',
  'hookErrors',
  'aiTitle',
  'customTitle',
  'totalCostUSD',
  'modelUsage',
  'effort',
  'operation',
];

/**
 * @param {unknown} raw
 * @param {'main' | 'subagent'} scope — subagent entries (isSidechain) are not shown in the main transcript
 * @param {(n: number) => string} imageUrl — the link to the entry's n-th image (images weigh megabytes, the page loads them on demand)
 * @returns {Record<string, unknown> | undefined}
 */
export function slimEntry(raw, scope, imageUrl) {
  if (!isRecord(raw) || typeof raw.type !== 'string') return undefined;
  if (scope === 'main' && raw.isSidechain === true) return undefined;
  if (raw.type === 'attachment') return slimAttachment(raw);
  if (!shownTypes.has(raw.type)) return undefined;
  /** @type {Record<string, unknown>} */
  const slim = {};
  for (const field of shownFields) if (raw[field] !== undefined) slim[field] = raw[field];
  if (isRecord(slim.toolUseResult)) slim.toolUseResult = slimToolResult(slim.toolUseResult);
  if (isRecord(slim.message)) slim.message = slimMessage(slim.message, imageUrl);
  return slim;
}

/**
 * Of the attachments, the feed needs only a message sent while the agent was working (queued_command in prompt mode);
 * the others — the system prompt, hook output, reminders — are internal and heavy.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown> | undefined}
 */
function slimAttachment(raw) {
  const attachment = raw.attachment;
  if (!isRecord(attachment) || attachment.type !== 'queued_command' || attachment.commandMode !== 'prompt') return undefined;
  const { type, commandMode, origin, prompt } = attachment;
  return { type: raw.type, uuid: raw.uuid, timestamp: raw.timestamp, attachment: { type, commandMode, origin, prompt } };
}

/**
 * @param {Record<string, unknown>} details
 * @returns {Record<string, unknown>}
 */
function slimToolResult(details) {
  const { originalFile, ...rest } = details;
  // Read puts the whole text or image it read here — the same text or image is in tool_result.
  if (isRecord(rest.file)) {
    const { content, base64, ...file } = rest.file;
    return { ...rest, file };
  }
  return rest;
}

/** Of an answer's usage the feed reads what makes up the context size. */
const usageFields = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];

/**
 * The message fields the feed reads: role, model, content and the context size. An answer carries much more — the
 * request's transformations, usage per iteration — which in a long session weighs more than all the answers.
 * @param {Record<string, unknown>} message
 * @param {(n: number) => string} imageUrl
 * @returns {Record<string, unknown>}
 */
function slimMessage(message, imageUrl) {
  /** @type {Record<string, unknown>} */
  const slim = {};
  if (message.role !== undefined) slim.role = message.role;
  if (message.model !== undefined) slim.model = message.model;
  if (Array.isArray(message.content)) {
    const content = message.content.map((block) => {
      if (!isRecord(block) || block.type !== 'thinking') return block;
      const { signature, ...rest } = block;
      return rest;
    });
    slim.content = mapImages(content, (image, n) => linkImage(image, imageUrl(n)));
  } else if (message.content !== undefined) slim.content = message.content;
  const usage = message.usage;
  if (isRecord(usage)) slim.usage = Object.fromEntries(usageFields.flatMap((field) => (usage[field] === undefined ? [] : [[field, usage[field]]])));
  return slim;
}
