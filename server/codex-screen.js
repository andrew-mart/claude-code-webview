// @ts-check
// What Codex's terminal shows, read from its screen: its prompt box — the last line marked › (the earlier ones are the
// prompts of the conversation) and the lines it wraps onto, indented under it, up to the blank line over the footer. A
// picker — an update offer, a choice of model — marks its chosen option with › as well, numbered: no box then, unless
// Codex's footer is under it — a numbered list typed into the box.

/** The mark of a prompt, in the box and in the conversation. */
const promptMark = '› ';

/** How far over its box Codex draws what it says of itself: its working line, a banner, its queued inputs. */
const overBox = 8;

/**
 * The lines of Codex's screen, and where its box starts: its last line marked ›; none without one. What Codex says of
 * itself is read about the box — the conversation over it may quote the same words.
 * @param {string} screen
 */
function aroundBox(screen) {
  const lines = screen.split('\n');
  return { lines, top: lines.findLastIndex((line) => line.startsWith(promptMark)) };
}

/**
 * Whether Codex shows a sub-agent's thread, whose input its parent controls: its box says so, and a banner over the box
 * does once something is typed there.
 * @param {string} screen
 */
export function showsSubagent(screen) {
  const { lines, top } = aroundBox(screen);
  if (top === -1) return false;
  const end = lines.findIndex((line, index) => index > top && line.trim() === '');
  const box = lines.slice(top, end === -1 ? undefined : end).join(' ');
  const over = lines.slice(Math.max(0, top - overBox), top).join(' ');
  return /Viewing sub-agent/i.test(box) || /controlled by its parent\.\s+Direct input is\s+disabled/i.test(over);
}

/**
 * Whether Codex's terminal shows a side conversation — its /btw — not the main thread: its footer, under the box, says
 * so.
 * @param {string} screen
 */
export function showsSideConversation(screen) {
  const { lines, top } = aroundBox(screen);
  return top !== -1 && lines.slice(top).some((line) => /Side from main thread/.test(line));
}

/**
 * Whether Codex works: its working line over the box — "Working (2s • esc to interrupt)", "Starting MCP servers (0s •
 * esc to interrupt)".
 * @param {string} screen
 */
export function showsWorking(screen) {
  const { lines, top } = aroundBox(screen);
  return top !== -1 && lines.slice(Math.max(0, top - overBox), top).some((line) => /\([^()]*•\s*esc to [^()]*\)\s*$/.test(line));
}

/** A line of the footer under Codex's prompt box: its status — how much of the context is used — or its shortcuts. */
const boxFooter = /Context \d+% (?:used|left)|\? for shortcuts/;

/** An option of a picker: the chosen one marked ›, the others indented as far. */
const optionLine = /^(›| ) (\d)\. (.+)$/;

/**
 * What Codex asks in its terminal, as the page answers it: the block of lines over its numbered options, and
 * the options, the chosen one under its cursor. Picked as Codex picks — the arrows to it, then Enter — as a dialog's
 * answers beside previews are (dialog.js). None while its prompt box shows.
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
export function codexDialog(screen) {
  if (codexInputBox(screen) !== undefined) return undefined;
  const lines = screen.split('\n');
  const chosen = lines.findLastIndex((line) => line.startsWith(`${promptMark}`) && optionLine.test(line));
  if (chosen === -1) return undefined;
  // the options around the chosen one, one line each
  let first = chosen;
  while (first > 0 && optionLine.test(lines[first - 1] ?? '')) first--;
  let last = chosen;
  while (last < lines.length - 1 && optionLine.test(lines[last + 1] ?? '')) last++;
  const options = lines.slice(first, last + 1).flatMap((line) => {
    const [, mark, key, label] = optionLine.exec(line) ?? [];
    return key === undefined || label === undefined ? [] : [{ key, label: label.trim(), detail: undefined, checked: undefined, current: mark === '›' }];
  });
  // the question: the block of lines over the options, a blank line or two between them
  let end = first;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end--;
  let top = end;
  while (top > 0 && (lines[top - 1] ?? '').trim() !== '') top--;
  return { lines: lines.slice(top, end).map((line) => line.trim()), options, tabs: false, previews: true };
}

/**
 * The text in Codex's prompt box — or its placeholder, while it is empty; none while a picker or a dialog takes its
 * place.
 * @param {string} screen
 * @returns {string | undefined}
 */
export function codexInputBox(screen) {
  const lines = screen.split('\n');
  const top = lines.findLastIndex((line) => line.startsWith(promptMark));
  if (top === -1) return undefined;
  const end = lines.findIndex((line, index) => index > top && line.trim() === '');
  // a picker's chosen option is marked as the box is — "› 1. Update now" — a numbered list typed into the box too: the
  // box has Codex's footer under it
  if (/^\d+\. /.test(lines[top]?.slice(promptMark.length) ?? '') && !(end !== -1 && lines.slice(end).some((line) => boxFooter.test(line)))) return undefined;
  const box = lines.slice(top, end === -1 ? undefined : end);
  return box.map((line, index) => (index === 0 ? line.slice(promptMark.length) : line.replace(/^ {2}/, '')).trimEnd()).join('\n');
}

/** Text in reverse video, up to where the style is reset. */
const reverseVideo = /\u001b\[7m(.*?)\u001b\[(?:0|27)m/gs;

/**
 * The prompt Codex shows browsed while it browses its prompts to rewind to one: the one drawn in reverse video — a
 * long one on its lines in turn. None without one.
 * @param {string} styled — the screen with its styles: herdr's read in ansi
 * @returns {string | undefined}
 */
export function codexBrowsedPrompt(styled) {
  const parts = [...styled.matchAll(reverseVideo)].map((match) => (match[1] ?? '').replace(/\u001b\[[0-9;]*m/g, '').trim());
  return parts.length === 0 ? undefined : parts.join(' ');
}

/**
 * The follow-up inputs Codex queued — Tab while it works — as it lists them over its box: each after ↳, wrapped onto
 * lines indented under it, up to its hint about editing them. None without the list.
 * @param {string} screen
 * @returns {string[]}
 */
export function codexQueued(screen) {
  const lines = screen.split('\n');
  const top = lines.findLastIndex((line) => line.startsWith('• Queued follow-up inputs'));
  if (top === -1) return [];
  /** @type {string[]} */
  const queued = [];
  for (const line of lines.slice(top + 1)) {
    const input = /^\s*↳ (.*)$/.exec(line);
    if (input !== null) queued.push((input[1] ?? '').trim());
    else if (/^ {4}\S/.test(line) && !/edit last queued message/.test(line) && queued.length > 0) queued[queued.length - 1] = `${queued.at(-1)} ${line.trim()}`;
    else break;
  }
  return queued;
}
