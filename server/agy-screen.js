// @ts-check
// Antigravity CLI's (agy) terminal, as its screen shows it: its prompt box — a line opened by ">" between two rules of ─
// — and what it asks, a dialog in the box's place: a list, its chosen row marked ">", over a row of the keys that
// answer it (as herdr's agy manifest tells them, from live panes of agy):
//   a permission:   "↑/↓ Navigate · tab Amend · ctrl+g edit/expand command" — or "· f full diff"
//   a question:     "↑/↓ Navigate · enter Select · esc Skip" — one of several: "· ← Back · → Next ·" in the middle
//                   (agy 1.5.8)
//   trust:          "↑/↓ Navigate · enter Confirm"
//   the slash menu: "↑/↓ Navigate · enter Select · tab Complete" — under the box, still there: no dialog
// and its panels drawn under the box, the box still on the screen though keys go to the panel — /mcp's servers over
// "Keyboard: ↑/↓ Navigate  enter Actions  esc Exit", a server's actions over "Keyboard: ↑/↓ Navigate  ←/→ Action  enter
// Select  esc Cancel" (from a live pane of agy 1.5.4)

const rule = /^\s*─{3,}\s*$/;
/**
 * The key rows of what agy asks; the slash menu's is not one. A question's may have more keys before its Enter: ← back
 * to the question before and → on to the next, Space to tick an answer of several; its Enter selects, or sends the
 * answers ticked — "Submit All" (agy 1.5.8).
 */
const askingKeys = /Navigate · (?:tab Amend|(?:[^·]+ · )*enter [^·]+ · esc Skip|enter Confirm)/;
/** A question of several answers: Space ticks one, Enter does what the row names. */
const tickingKeys = /space Toggle · enter ([^·]+?)\s*·/;
/** An answer's box, ticked or not, ahead of its words. */
const tickBox = /^\[([ xX✓✔])\]\s+/;
/** The keys between several questions, in their row. */
const betweenQuestions = /← Back|→ Next/;
/** A row of a list: the cursor ">" on the chosen one, then the text — numbered or not. */
const cursorRow = /^(\s*>\s+)(?:\d+\.\s+)?(\S.*)$/;
/** The row of keys under agy's panels, which take the keys while the box is still on the screen. */
const panelKeys = /^Keyboard:\s.*\besc\s+(?:Exit|Cancel|Go Back)\b/;
/** A server's row in /mcp: the cursor ">" on the chosen one, its state's mark, its name — after a gap, what it has. */
const serverRow = /^(?:(>)\s+|\s{2,})(\S)\s(\S+)(?:\s{2,}(\S.*?))?\s*$/;
/** An action under the chosen server: a word or a few, the chosen one in brackets. */
const action = /^(\[)?(\p{L}[\p{L} -]*?)\]?$/u;

/**
 * The text in agy's prompt box — empty while nothing is typed; none while a dialog takes its place.
 * @param {string} screen
 * @returns {string | undefined}
 */
export function agyInputBox(screen) {
  const lines = screen.split('\n');
  // a panel under the box takes the keys: the box is on the screen, out of reach
  if (lines.some((line) => askingKeys.test(line) || panelKeys.test(line))) return undefined;
  // the box is under a rule and over the next one, only the typed text between them — its first line opened by ">", the
  // rest indented: a message sent stays on the screen drawn as the box was, agy's own lines after it; the slash menu's
  // rows under the box are opened by ">" as well
  for (let top = lines.length - 2; top >= 0; top--) {
    if (!rule.test(lines[top] ?? '') || !(lines[top + 1] ?? '').startsWith('>')) continue;
    const bottom = lines.findIndex((line, at) => at > top && rule.test(line));
    const box = bottom === -1 ? [] : lines.slice(top + 1, bottom);
    if (box.length > 0 && box.slice(1).every((line) => line.trim() === '' || line.startsWith(' '))) return box.map((line, at) => (at === 0 ? line.replace(/^>\s?/, '') : line.replace(/^ {2}/, '')).trimEnd()).join('\n');
  }
  return undefined;
}

/**
 * What agy asks: what it says above its choices — the command it would run, the question — and the choices, each row
 * its label and, after a gap, its note; the arrows go to one, Enter picks it.
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
export function agyDialog(screen) {
  const lines = screen.split('\n');
  const keys = lines.findLastIndex((line) => askingKeys.test(line));
  const chosen = lines.findLastIndex((line, at) => at < keys && cursorRow.test(line));
  if (keys === -1 || chosen === -1) return mcpPanel(lines) ?? rewindPanel(screen) ?? modelPanel(lines);
  const column = (cursorRow.exec(lines[chosen] ?? '')?.[1] ?? '').length;
  /** @param {string | undefined} line */
  const indentOf = (line) => (line === undefined ? 0 : line.length - line.trimStart().length);
  /** @param {string | undefined} line */
  const isRow = (line) => line !== undefined && (cursorRow.test(line) || (line.trim() !== '' && indentOf(line) === column));
  // a choice too long for the screen goes on in the line under it, from nearer the line's start
  /** @param {string | undefined} line */
  const goesOn = (line) => line !== undefined && line.trim() !== '' && !isRow(line) && indentOf(line) < column;
  // the rows around the chosen one, one after another, with the lines they go on in
  let first = chosen;
  for (;;) {
    if (isRow(lines[first - 1])) first -= 1;
    else if (goesOn(lines[first - 1]) && isRow(lines[first - 2])) first -= 2;
    else break;
  }
  let last = chosen;
  while (isRow(lines[last + 1]) || goesOn(lines[last + 1])) last++;
  /** @type {{ text: string, current: boolean }[]} */
  const rows = [];
  for (const line of lines.slice(first, last + 1)) {
    const row = rows.at(-1);
    if (isRow(line) || row === undefined) rows.push({ text: (cursorRow.exec(line)?.[2] ?? line.slice(column).replace(/^\d+\.\s+/, '')).trim(), current: cursorRow.test(line) });
    else row.text = `${row.text} ${line.trim()}`;
  }
  const options = rows.map(({ text, current }) => {
    const box = tickBox.exec(text);
    const [label = '', ...notes] = text.slice(box === null ? 0 : box[0].length).split(/\s{2,}/);
    return { key: '', label, detail: notes.length === 0 ? undefined : notes.join(' '), checked: box === null ? undefined : box[1] !== ' ', current };
  });
  const ticking = tickingKeys.exec(lines[keys] ?? '')?.[1];
  // what it says: the lines above the rows, up to the rule over the dialog — or, with none, the gap under the banner
  const ruleAbove = lines.findLastIndex((line, at) => at < first && rule.test(line));
  const top = ruleAbove !== -1 ? ruleAbove : lines.findLastIndex((line, at) => at < first - 1 && line.trim() === '');
  const said = lines.slice(top + 1, first).map((line) => line.trim()).filter((line) => line !== '');
  return { lines: said, options, tabs: betweenQuestions.test(lines[keys] ?? ''), previews: true, ...(ticking === undefined ? {} : { toggles: { enter: ticking } }) };
}

/**
 * agy's /mcp under its box: its servers — each row its state's mark and name, what it has after a gap — gone along
 * with the arrows, Enter opening the chosen one's actions; or those actions in a row under it, the chosen one in
 * brackets — gone along with ← and →, Enter doing it, Esc back to the servers.
 * @param {readonly string[]} lines — the screen's
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function mcpPanel(lines) {
  const keys = lines.findLastIndex((line) => panelKeys.test(line));
  const title = lines.findLastIndex((line, at) => at < keys && line.trim() === 'MCP Servers');
  if (keys === -1 || title === -1) return undefined;
  const body = lines.slice(title + 1, keys);
  const servers = body.flatMap((line, at) => {
    const row = serverRow.exec(line);
    return row === null ? [] : [{ at, label: `${row[2]} ${row[3]}`, detail: row[4], current: row[1] !== undefined }];
  });
  const chosen = servers.find((server) => server.current);
  const actions = chosen === undefined ? [] : actionsOf(body[chosen.at + 1] ?? '');
  if (/←\/→ Action/.test(lines[keys] ?? '') && chosen !== undefined && actions.length > 0) {
    return { lines: ['MCP Servers', chosen.label, ...(chosen.detail === undefined ? [] : [chosen.detail])], options: actions, tabs: false, previews: true, sideways: true, goesBack: true };
  }
  if (servers.length === 0) return undefined;
  // what it says above its first server: the group they are in — the plugins' folder
  const head = body.slice(0, servers[0]?.at).map((line) => line.trim()).filter((line) => line !== '');
  const options = servers.map(({ label, detail, current }) => ({ key: '', label, detail, checked: undefined, current }));
  return { lines: ['MCP Servers', ...head], options, tabs: false, previews: true };
}

/**
 * The actions in the row under /mcp's chosen server — "[Restart]   Disable" — the bracketed one chosen; none for a
 * row of anything else.
 * @param {string} line
 * @returns {import('../public/model/dialog.js').DialogOption[]}
 */
function actionsOf(line) {
  const words = line.trim().split(/\s{2,}/);
  const found = words.flatMap((word) => {
    const named = action.exec(word);
    return named === null ? [] : [{ key: '', label: named[2] ?? '', detail: undefined, checked: undefined, current: named[1] !== undefined }];
  });
  return line.startsWith('  ') && found.length === words.length && found.filter((one) => one.current).length === 1 ? found : [];
}

/** agy's /rewind under its box: its title, and the row of keys under it. */
const rewindTitle = 'Rewind Conversation';
const rewindKeys = /^Keyboard:\s.*enter Select\s+esc Cancel/;
/** A row of /rewind: the cursor ">" on the chosen one, then the message as agy cuts it — "(current)" the last. */
const rewindRow = /^(>| ) (\S.*?)\s*$/;
/** How long ago a message was sent, in a line of its own under its row. */
const rewindWhen = /^\s{3,}(\(.+\))\s*$/;

/**
 * The rows of agy's /rewind: each message as agy cuts it, how long ago it was sent, whether the cursor is on it —
 * "(current)" the last; none while it is not shown (read off a live pane of agy 1.5.4).
 * @param {string} screen
 * @returns {{ text: string, when: string | undefined, current: boolean }[] | undefined}
 */
export function rewindRows(screen) {
  const lines = screen.split('\n');
  const top = lines.findLastIndex((line) => line.trim() === rewindTitle);
  const keys = lines.findLastIndex((line) => rewindKeys.test(line));
  if (top === -1 || keys < top) return undefined;
  const panel = lines.slice(top + 1, keys);
  return panel.flatMap((line, at) => {
    const row = rewindRow.exec(line);
    const when = rewindWhen.exec(panel[at + 1] ?? '');
    return row === null ? [] : [{ text: row[2] ?? '', when: when?.[1], current: row[1] === '>' }];
  });
}

/**
 * agy's /rewind as what it asks: the messages to rewind to, gone along with the arrows — and a message picked rewinds at
 * once, with no confirmation: the card says so above them.
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function rewindPanel(screen) {
  const rows = rewindRows(screen);
  if (rows === undefined || rows.length === 0) return undefined;
  const options = rows.map(({ text, when, current }) => ({ key: '', label: text, detail: when, checked: undefined, current }));
  return { lines: [rewindTitle, 'A message picked rewinds at once: the conversation, and the file edits made since.'], options, tabs: false, previews: true };
}

/** agy's /model under its box: its title, the row of keys under it — with ←/→ Effort while the chosen model has a gauge. */
const modelTitle = 'Switch Model';
const modelKeys = /^Keyboard:\s.*enter Select\s+esc Go Back/;
/** The search's underline, over the models. */
const searchLine = /^\s*─{4,}\s*$/;
/** The chosen model's effort gauge: its levels, the one set ◉, those before it ●, those after ○. */
const effortGauge = /^\s*Effort\s+◂(.*)▸\s*$/;

/**
 * agy's /model as what it asks: its models, gone along with the arrows — the chosen one marked ">", the one in use
 * "(current)" — and the chosen one's effort, its levels named under the gauge, gone along with ← and →, what the level
 * set does under them; Enter picks the model at that effort, Esc goes back (read off a live pane of agy 1.5.4).
 * @param {readonly string[]} lines — the screen's
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function modelPanel(lines) {
  const keys = lines.findLastIndex((line) => modelKeys.test(line));
  const top = lines.findLastIndex((line, at) => at < keys && line.trim() === modelTitle);
  if (keys === -1 || top === -1) return undefined;
  const body = lines.slice(top + 1, keys);
  const gauge = body.findIndex((line) => effortGauge.test(line));
  const models = body.slice(body.findIndex((line) => searchLine.test(line)) + 1, gauge === -1 ? body.length : gauge).flatMap((line) => {
    const row = rewindRow.exec(line);
    const [label = '', ...rest] = (row?.[2] ?? '').split(/\s{2,}/);
    return row === null ? [] : [{ key: '', label, detail: rest.length === 0 ? undefined : rest.join(' '), checked: undefined, current: row[1] === '>' }];
  });
  if (models.length === 0) return undefined;
  const marks = [...(effortGauge.exec(body[gauge] ?? '')?.[1] ?? '')].filter((mark) => mark === '●' || mark === '◉' || mark === '○');
  const levels = gauge === -1 ? [] : (body[gauge + 1] ?? '').trim().split(/\s+/).filter((level) => level !== '');
  const set = marks.indexOf('◉');
  const said = gauge === -1 ? '' : (body[gauge + 2] ?? '').trim();
  return {
    lines: [modelTitle],
    options: models,
    tabs: false,
    previews: true,
    goesBack: true,
    picker: { levels, chosen: set === -1 || levels.length === 0 ? undefined : set, about: said === '' ? undefined : said },
  };
}
