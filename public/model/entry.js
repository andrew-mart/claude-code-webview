// @ts-check
import { splitAttachedImages, uploadUrl } from './attachments.js';
import { isRecord, text } from './narrow.js';

// A Claude Code transcript line (~/.claude/projects/<project>/<session>.jsonl) → display events.

/**
 * @typedef {{ url: string }} Image — a data: URL or the viewer's /api/image link
 * @typedef {{ kind: 'prompt', id: string, at: string, text: string, images: readonly Image[], queued: boolean }} PromptEvent
 * @typedef {{ kind: 'text', id: string, at: string, text: string }} TextEvent
 * @typedef {{ kind: 'tool-call', id: string, at: string, name: string, input: unknown }} ToolCallEvent
 * @typedef {{ type: 'text', text: string } | { type: 'image', image: Image }} ResultPart
 * @typedef {{ kind: 'tool-result', id: string, at: string, toolUseId: string, isError: boolean, parts: readonly ResultPart[], details: unknown }} ToolResultEvent
 * @typedef {{ kind: 'command', id: string, at: string, text: string }} CommandEvent
 * @typedef {{ kind: 'command-output', id: string, at: string, text: string, isError: boolean }} CommandOutputEvent
 * @typedef {{ kind: 'interrupted', id: string, at: string }} InterruptedEvent
 * @typedef {{ kind: 'task-notification', id: string, at: string, toolUseId: string | undefined, status: string, summary: string }} TaskNotificationEvent
 * @typedef {{ kind: 'subagent-report', id: string, at: string, name: string | undefined, text: string }} SubagentReportEvent
 * @typedef {{ kind: 'context-summary', id: string, at: string, text: string }} ContextSummaryEvent
 * @typedef {{ kind: 'meta', id: string, at: string, text: string }} MetaEvent
 * @typedef {{ kind: 'thinking', id: string, at: string, text: string, durationMs: number | undefined }} ThinkingEvent
 * @typedef {{ kind: 'usage', id: string, at: string, model: string, contextTokens: number }} UsageEvent
 * @typedef {'info' | 'warning' | 'error'} Tone
 * @typedef {{ kind: 'notice', id: string, at: string, tone: Tone, text: string }} NoticeEvent
 * @typedef {PromptEvent | TextEvent | ToolCallEvent | ToolResultEvent | CommandEvent | CommandOutputEvent
 *   | InterruptedEvent | TaskNotificationEvent | SubagentReportEvent | ContextSummaryEvent | MetaEvent
 *   | ThinkingEvent | UsageEvent | NoticeEvent | TurnEndEvent | CompactedEvent | TitleEvent | CostEvent} DisplayEvent
 * @typedef {{ kind: 'turn-end', id: string, at: string, durationMs: number }} TurnEndEvent
 * @typedef {{ kind: 'compacted', id: string, at: string, trigger: string, preTokens: number | undefined }} CompactedEvent
 * @typedef {{ kind: 'title', title: string, custom: boolean }} TitleEvent
 * @typedef {{ kind: 'cost', usd: number }} CostEvent
 * @typedef {{ id: string, at: string }} Stamp
 */

/**
 * @param {unknown} raw
 * @returns {readonly DisplayEvent[]}
 */
export function interpretEntry(raw) {
  if (!isRecord(raw)) return [];
  switch (raw.type) {
    case 'ai-title':
    case 'custom-title': {
      const title = text(raw.aiTitle) ?? text(raw.customTitle);
      return title === undefined ? [] : [{ kind: 'title', title, custom: raw.type === 'custom-title' }];
    }
    case 'cost-state':
      return typeof raw.totalCostUSD === 'number' ? [{ kind: 'cost', usd: raw.totalCostUSD }] : [];
  }
  const id = text(raw.uuid);
  const at = text(raw.timestamp);
  if (id === undefined || at === undefined) return [];
  const stamp = { id, at };
  switch (raw.type) {
    case 'user':
      return isRecord(raw.message) ? interpretUser(stamp, raw, raw.message) : [];
    case 'assistant':
      return isRecord(raw.message) ? interpretAssistant(stamp, raw, raw.message) : [];
    case 'system':
      return interpretSystem(stamp, raw);
    case 'attachment':
      return isRecord(raw.attachment) ? interpretQueued(stamp, raw.attachment) : [];
    default:
      return [];
  }
}

/**
 * A message sent while the agent was working: Claude Code attaches it to the current turn as queued_command.
 * From a human it is a prompt; from a subagent (peer) it is its report. Background task notifications also
 * arrive as a regular user entry, so they are skipped here.
 * @param {Stamp} stamp
 * @param {Record<string, unknown>} attachment
 * @returns {readonly DisplayEvent[]}
 */
function interpretQueued(stamp, attachment) {
  if (attachment.type !== 'queued_command' || attachment.commandMode !== 'prompt') return [];
  const origin = isRecord(attachment.origin) ? attachment.origin : {};
  const body = joinedText(attachment.prompt);
  switch (origin.kind) {
    case 'human':
      return [{ kind: 'prompt', ...stamp, ...promptParts(withoutReminders(body), []), queued: true }];
    case 'peer':
      return [{ kind: 'subagent-report', ...stamp, name: text(origin.name), text: handBackReport(body) }];
    default:
      return [];
  }
}

/**
 * Entries with type=system: Claude Code's marks about the session's progress.
 * @param {Stamp} stamp
 * @param {Record<string, unknown>} entry
 * @returns {readonly DisplayEvent[]}
 */
function interpretSystem(stamp, entry) {
  const body = text(entry.content);
  switch (entry.subtype) {
    case 'turn_duration':
      return typeof entry.durationMs === 'number' ? [{ kind: 'turn-end', ...stamp, durationMs: entry.durationMs }] : [];
    case 'compact_boundary': {
      const meta = isRecord(entry.compactMetadata) ? entry.compactMetadata : {};
      const preTokens = typeof meta.preTokens === 'number' ? meta.preTokens : undefined;
      return [{ kind: 'compacted', ...stamp, trigger: text(meta.trigger) ?? 'manual', preTokens }];
    }
    case 'local_command': {
      const command = body === undefined ? undefined : terminalEvent(stamp, body);
      return command === undefined ? [] : [command];
    }
    case 'stop_hook_summary': {
      const errors = Array.isArray(entry.hookErrors) ? entry.hookErrors.map(String) : [];
      return errors.length === 0 ? [] : [{ kind: 'notice', ...stamp, tone: 'warning', text: errors.join('\n') }];
    }
    default:
      return body === undefined || body.trim() === '' ? [] : [{ kind: 'notice', ...stamp, tone: toneOf(entry.level), text: body }];
  }
}

/**
 * @param {unknown} level
 * @returns {Tone}
 */
function toneOf(level) {
  switch (level) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

/**
 * @param {Stamp} stamp
 * @param {Record<string, unknown>} entry
 * @param {Record<string, unknown>} message
 * @returns {readonly DisplayEvent[]}
 */
function interpretUser(stamp, entry, message) {
  const results = toolResults(stamp, message.content, entry.toolUseResult);
  if (results.length > 0) return results;
  const raw = joinedText(message.content);
  if (entry.isCompactSummary === true) return [{ kind: 'context-summary', ...stamp, text: raw }];
  if (entry.isMeta === true) return [{ kind: 'meta', ...stamp, text: raw }];
  const origin = isRecord(entry.origin) ? entry.origin : {};
  if (origin.kind === 'peer') return [{ kind: 'subagent-report', ...stamp, name: text(origin.name), text: handBackReport(raw) }];
  const body = withoutReminders(raw);
  if (body.startsWith('<task-notification>')) return [taskNotification(stamp, body)];
  if (body.startsWith('[Request interrupted by user')) return [{ kind: 'interrupted', ...stamp }];
  const terminal = terminalEvent(stamp, body);
  if (terminal !== undefined) return [terminal];
  const images = blocks(message.content).map(image).filter((picture) => picture !== undefined);
  return [{ kind: 'prompt', ...stamp, ...promptParts(body, images), queued: entry.promptSource === 'queued' }];
}

/**
 * A prompt sent from the page lists its attached images at the end; the feed shows them as pictures, not as paths.
 * A list with a path the viewer did not save is left as text.
 * @param {string} body
 * @param {readonly Image[]} images — images the prompt carries itself
 * @returns {{ text: string, images: readonly Image[] }}
 */
function promptParts(body, images) {
  const { text: rest, paths } = splitAttachedImages(body);
  const uploaded = paths.flatMap((path) => {
    const url = uploadUrl(path);
    return url === undefined ? [] : [{ url }];
  });
  if (paths.length === 0 || uploaded.length !== paths.length) return { text: body, images };
  return { text: rest, images: [...images, ...uploaded] };
}

/**
 * A subagent report comes with a Claude Code preamble and its text indented by two spaces.
 * @param {string} raw
 * @returns {string}
 */
function handBackReport(raw) {
  const marker = 'The report follows:\n';
  const start = raw.indexOf(marker);
  if (start < 0) return raw.trim();
  return raw
    .slice(start + marker.length)
    .split('\n')
    .map((line) => line.replace(/^ {2}/, ''))
    .join('\n')
    .trim();
}

/**
 * @param {Stamp} stamp
 * @param {string} body
 * @returns {TaskNotificationEvent}
 */
function taskNotification(stamp, body) {
  return {
    kind: 'task-notification',
    ...stamp,
    toolUseId: tag(body, 'tool-use-id'),
    status: tag(body, 'status') ?? '',
    summary: tag(body, 'summary') ?? '',
  };
}

/**
 * What the user typed in the terminal besides a prompt: a slash command, a `!` shell command, and their output.
 * @param {Stamp} stamp
 * @param {string} body
 * @returns {CommandEvent | CommandOutputEvent | undefined}
 */
function terminalEvent(stamp, body) {
  const command = tag(body, 'command-name');
  if (command !== undefined) return { kind: 'command', ...stamp, text: [command, tag(body, 'command-args')].filter((part) => part).join(' ') };
  const shell = tag(body, 'bash-input');
  if (shell !== undefined) return { kind: 'command', ...stamp, text: `! ${shell}` };
  const stdout = tag(body, 'local-command-stdout') ?? tag(body, 'bash-stdout');
  const stderr = tag(body, 'local-command-stderr') ?? tag(body, 'bash-stderr');
  if (stdout === undefined && stderr === undefined) return undefined;
  const output = [stdout, stderr].filter((part) => part).join('\n');
  return { kind: 'command-output', ...stamp, text: stripAnsi(output), isError: Boolean(stderr) };
}

/**
 * @param {string} body
 * @param {string} name
 * @returns {string | undefined}
 */
function tag(body, name) {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1]?.trim();
}

/** @param {string} value */
function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * @param {Stamp} stamp
 * @param {unknown} content
 * @param {unknown} details — toolUseResult: the tool's structured result; its shape depends on the tool
 * @returns {readonly ToolResultEvent[]}
 */
function toolResults({ id, at }, content, details) {
  return blocks(content).flatMap((block, index) => {
    const toolUseId = text(block.tool_use_id);
    if (block.type !== 'tool_result' || toolUseId === undefined) return [];
    /** @type {ToolResultEvent} */
    const result = {
      kind: 'tool-result',
      id: `${id}:${index}`,
      at,
      toolUseId,
      isError: block.is_error === true,
      parts: resultParts(block.content),
      details,
    };
    return [result];
  });
}

/**
 * Message content is either a string or a list of blocks; the text is the string or all text blocks joined.
 * @param {unknown} content
 * @returns {string}
 */
function joinedText(content) {
  if (typeof content === 'string') return content;
  return blocks(content)
    .map((block) => (block.type === 'text' ? text(block.text) : undefined))
    .filter((part) => part !== undefined)
    .join('\n');
}

/**
 * <system-reminder> inserts are added by Claude Code itself; the user did not write them.
 * @param {string} value
 */
function withoutReminders(value) {
  return value.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/**
 * @param {unknown} content
 * @returns {readonly ResultPart[]}
 */
function resultParts(content) {
  const single = text(content);
  if (single !== undefined) return [{ type: 'text', text: single }];
  return blocks(content)
    .map(resultPart)
    .filter((part) => part !== undefined);
}

/**
 * @param {Record<string, unknown>} block
 * @returns {ResultPart | undefined}
 */
function resultPart(block) {
  switch (block.type) {
    case 'text': {
      const body = text(block.text);
      return body === undefined ? undefined : { type: 'text', text: body };
    }
    case 'image': {
      const picture = image(block);
      return picture === undefined ? undefined : { type: 'image', image: picture };
    }
    case 'tool_reference': {
      // ToolSearch returns references to the tools it loaded.
      const name = text(block.tool_name);
      return name === undefined ? undefined : { type: 'text', text: name };
    }
    default:
      return undefined;
  }
}

/**
 * An image kept in the transcript (base64) or served by the viewer (a link the server put instead of base64).
 * Images from other sites are not shown: loading one would tell that site who opened the session and when.
 * @param {Record<string, unknown>} block
 * @returns {Image | undefined}
 */
function image(block) {
  if (block.type !== 'image' || !isRecord(block.source)) return undefined;
  const { source } = block;
  const mediaType = text(source.media_type);
  const data = text(source.data);
  const url = text(source.url);
  if (source.type === 'base64' && mediaType !== undefined && data !== undefined) return { url: `data:${mediaType};base64,${data}` };
  if (source.type === 'webview' && url !== undefined && url.startsWith('/api/image?')) return { url };
  return undefined;
}

/**
 * @param {Stamp} stamp
 * @param {Record<string, unknown>} entry
 * @param {Record<string, unknown>} message
 * @returns {readonly DisplayEvent[]}
 */
function interpretAssistant(stamp, entry, message) {
  const body = joinedText(message.content);
  if (entry.isApiErrorMessage === true) return [{ kind: 'notice', ...stamp, tone: 'error', text: body }];
  // Claude Code placeholder replies (model "<synthetic>") are not model answers.
  if (message.model === '<synthetic>') {
    const silent = body.trim() === '' || body === 'No response requested.';
    return silent ? [] : [{ kind: 'notice', ...stamp, tone: 'info', text: body }];
  }
  const thinkingMs = typeof entry.thinkingDurationMs === 'number' ? entry.thinkingDurationMs : undefined;
  const events = blocks(message.content).flatMap((block, index) => {
    const event = assistantBlock({ id: `${stamp.id}:${index}`, at: stamp.at }, block, thinkingMs);
    return event === undefined ? [] : [event];
  });
  const usage = contextUsage(stamp, message);
  return usage === undefined ? events : [...events, usage];
}

/**
 * @param {Stamp} stamp
 * @param {Record<string, unknown>} block
 * @param {number | undefined} thinkingMs
 * @returns {DisplayEvent | undefined}
 */
function assistantBlock(stamp, block, thinkingMs) {
  switch (block.type) {
    case 'text': {
      const body = text(block.text);
      return body === undefined || body.trim() === '' ? undefined : { kind: 'text', ...stamp, text: body };
    }
    case 'thinking':
      return { kind: 'thinking', ...stamp, text: text(block.thinking) ?? '', durationMs: thinkingMs };
    case 'redacted_thinking':
      return { kind: 'thinking', ...stamp, text: '', durationMs: thinkingMs };
    case 'tool_use': {
      const toolId = text(block.id);
      const name = text(block.name);
      return toolId === undefined || name === undefined ? undefined : { kind: 'tool-call', id: toolId, at: stamp.at, name, input: block.input };
    }
    default:
      return undefined;
  }
}

/**
 * Context size at the time of the answer: everything the model received as input, cache included.
 * @param {Stamp} stamp
 * @param {Record<string, unknown>} message
 * @returns {UsageEvent | undefined}
 */
function contextUsage(stamp, message) {
  const usage = message.usage;
  const model = text(message.model);
  if (!isRecord(usage) || model === undefined) return undefined;
  const tokens = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .map((key) => usage[key])
    .map((value) => (typeof value === 'number' ? value : 0))
    .reduce((sum, value) => sum + value, 0);
  return { kind: 'usage', ...stamp, model, contextTokens: tokens };
}

/**
 * @param {unknown} content
 * @returns {readonly Record<string, unknown>[]}
 */
function blocks(content) {
  return Array.isArray(content) ? content.filter(isRecord) : [];
}
