// @ts-check
// Transcript entry → what the feed in the browser needs. The rest (file snapshots, the system prompt,
// thinking signatures, the full file text before an edit) weighs megabytes and is not shown in the feed.
import { isRecord } from '../public/model/narrow.js';

const shownTypes = new Set(['user', 'assistant', 'system', 'ai-title', 'custom-title', 'cost-state']);

/** Entry fields that public/model/entry.js reads. */
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
];

/**
 * @param {unknown} raw
 * @param {'main' | 'subagent'} scope — subagent entries (isSidechain) are not shown in the main transcript
 * @returns {Record<string, unknown> | undefined}
 */
export function slimEntry(raw, scope) {
  if (!isRecord(raw) || typeof raw.type !== 'string') return undefined;
  if (scope === 'main' && raw.isSidechain === true) return undefined;
  if (raw.type === 'attachment') return slimAttachment(raw);
  if (!shownTypes.has(raw.type)) return undefined;
  /** @type {Record<string, unknown>} */
  const slim = {};
  for (const field of shownFields) if (raw[field] !== undefined) slim[field] = raw[field];
  if (isRecord(slim.toolUseResult)) slim.toolUseResult = slimToolResult(slim.toolUseResult);
  if (isRecord(slim.message)) slim.message = slimMessage(slim.message);
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
  // Read puts the whole text it read here — the same text is in tool_result.
  if (isRecord(rest.file)) {
    const { content, ...file } = rest.file;
    return { ...rest, file };
  }
  return rest;
}

/**
 * @param {Record<string, unknown>} message
 * @returns {Record<string, unknown>}
 */
function slimMessage(message) {
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((block) => {
      if (!isRecord(block) || block.type !== 'thinking') return block;
      const { signature, ...rest } = block;
      return rest;
    }),
  };
}
