# Claude Code Webview

Watch your [Claude Code](https://code.claude.com) sessions live in the browser, laid out the way Claude Desktop shows
them: your prompts in bubbles, answers in rendered markdown, tool calls folded into compact rows with diffs and output.
Every line Claude Code writes to the session transcript shows up on the page within half a second.

![Claude Code Webview](docs/screenshot.png)

## Quick start

The viewer runs from its source. Requires Node.js 22 or newer.

```bash
git clone https://github.com/andrew-mart/claude-code-webview.git
cd claude-code-webview
npm install --omit=dev
node bin/claude-code-webview.js
```

The viewer starts on http://127.0.0.1:7788 and opens in your browser. If it is already running, the command just
opens the browser. Press Ctrl+C to stop; `node bin/claude-code-webview.js --background` runs it without a terminal
window. To update: `git pull`, `npm install --omit=dev`, then `node bin/claude-code-webview.js --restart`.

## What you get

- **All sessions** of every project, newest first, with titles, project folder and age; an orange dot marks a session
  written to in the last two minutes. "Follow the active session" switches to whichever session was written to last.
  Sessions that a program drives (`claude -p`, the Agent SDK) are hidden until you tick "Show SDK sessions".
- **The feed**:
  - prompts with images, slash commands and `!` shell commands with their output;
  - answers in markdown with syntax highlighting;
  - thinking with its duration (Claude Code usually does not store the thinking text — then only the duration is shown);
  - tool calls as one-line rows that expand: Bash shows the command and output, Read the file with line numbers,
    Edit and Write a diff with line numbers, Agent its task, report and a live view of the subagent's own transcript;
  - markers for interrupts, background task results, context compaction, API errors and turn duration.
- **Show briefly / Show in detail.** Briefly (default) folds each run of tool calls into one line —
  `4 commands, 1 read, 6 edits, 5 thoughts · 1 error` — like Claude Code itself; the call that is running right now
  stays visible. In detail shows every call.
- **File links.** Absolute paths in answers (`/Users/ann/app/src/x.ts:42`, `~/notes.md`, `C:\repo\a.cs:10-20`),
  `file:///` links and paths in Read/Edit/Write rows open the file in a side panel, scrolled to and highlighting the line.
  The panel shows the file as it is on disk now, not at the time of the answer. Started with `--editor-command`, the
  viewer adds a button that opens the file at the marked line in your editor — in a browser on the viewer's own
  computer, where the editor shows up. A page opened through a tunnel finds that out by asking the viewer at the
  browser's 127.0.0.1 whether it is the same one: Chrome asks once to let the page reach apps on the device.
- **Outline and bookmarks.** A right-hand outline lists your prompts (the one on screen is highlighted; Alt+↑ / Alt+↓
  jump between them) and your bookmarks: hover a prompt, an answer or a subagent report and click the flag to keep it
  one click away. Bookmarks are kept by the viewer in `~/.claude-code-webview/bookmarks.json`, so every browser and
  device that opens it sees the same ones.
- **Session header.** Under the title, one line of facts: the folder, the branch checked out there now, the model and
  its effort, a ring that fills as the context window does (`412k/1M`; amber past 70%, red past 90%) and the cost.
  A click opens the details: the full path and how much context is used and left. The window comes from the model
  as Claude Code gives it (1M for Opus 4.7+, Sonnet 5+, Haiku 5.5, Fable; 200K for earlier ones unless the session ran
  their `[1m]` variant); for a model Claude Code does not know only the size is shown.
- **Usage.** Beside the viewer's name, how much of your plan's 5-hour window and week is used — `5h 22% · 7d 91%`,
  amber past 70%, red past 90%; hover for when each resets and how old the reading is. Claude Code reads the usage only
  now and then and keeps the reading in `~/.claude.json`, so it may be hours old. A statusline command is given a fresh
  one with every reply (`rate_limits` in its input); have yours drop it into `~/.claude-code-webview/rate-limits.json`
  and the viewer shows whichever reading is fresher. In a bash statusline:
  `input=$(cat); echo "$input" | jq -c '.rate_limits // empty' > ~/.claude-code-webview/rate-limits.json`.
- **Phones.** On a narrow screen the session list and the outline slide in from the sides, bookmark flags stay
  visible without hover, the view buttons fold into a "⋯" menu, and on a touch keyboard Enter starts a new line while
  the ↑ button sends.
- **Long sessions** open with their latest part (2000 entries, 800 on a phone); "Show N earlier entries" above it loads
  the rest, keeping your place. A tool's big output — a command's stdout, a file read or written — is not sent up
  front: the row shows its summary, and the output loads when the row is opened. A 120 MB transcript opens in about
  a second. Images load only
  when they scroll into view, and replies are gzipped, so a long session costs a phone about a megabyte, not dozens.
- **Offline.** With the viewer out of reach — the computer off, a proxy in front of it answering with an error, no
  network — the page still opens (a service worker keeps it) and shows what this browser saved: the session list and
  the sessions you opened, plus the latest few sessions worked on, saved in the background while the viewer answered.
  "Offline · reading saved copies" shows meanwhile; once the viewer answers, the page reconnects and catches up, keeping
  your place. On an iPhone, add the page to the Home Screen: Safari may clear a website's saved data after a week
  without visits.
- **Tables.** A table fits the answer's width, narrowing its columns down to whole words. When that is too cramped —
  on a phone especially — "Wide" under the table gives each column a comfortable width and lets the table scroll
  sideways. The same choice can be made for all tables of a session (in the header's details) or of the whole viewer
  (a view button); the table's own button overrides the session, the session overrides the viewer.
- Light and dark themes, serif or sans answers, optional display of Claude Code's service messages.
- **Palettes.** `--palette sea` (or `moss`, `plum`; `clay`, Claude's own, is the default) changes the accent colour, tints the
  session list a little and colours the tab icon and the iPhone home screen icon — two viewers, say on two computers, are
  told apart at a glance.

## With herdr: workspaces, tabs, terminals and sending prompts (optional)

herdr is not needed to read sessions. If you run Claude Code inside [herdr](https://herdr.dev), the viewer can do more:
lay herdr out as herdr does — its workspaces, their tabs with the agents' status, terminals — and type prompts into
the sessions. Without herdr — not installed, not running, or turned off with `--no-herdr` — everything else works, and
the herdr view, the terminals, the input box, Stop and rewind are simply not shown.

### herdr's layout

The sidebar switches between "herdr" and "Sessions". In "herdr" it shows herdr's workspaces in herdr's order, each
with its agents' status — working, waiting for you, done, idle — and under them, as herdr lists its agents, every
session of every workspace: Claude Code, Codex and other agents, the one whose agent changed state last first. Above an
open session — or terminal — the tabs of its workspace sit in a row, as in herdr, to switch between them. A session or
tab with Claude Code opens its feed; any other tab — a shell, nvim, another agent — opens its terminal. The search finds
workspaces and sessions by name and by what runs in them.

A second click on the open tab shows its buttons: ✎ names it, × closes it (after asking — what runs in it stops), and the
page moves to the tab next to it. **+** at the end of the row opens a tab beside the open one, in its folder: a terminal,
or Claude Code started in it with `claude` — or with the command given by `--claude-command`, a wrapper of your own.

A terminal mirrors the one in herdr, at its size: the keys you type go to it as they are — Enter, arrows, Ctrl+C — and
what herdr shows comes back within a few hundredths of a second (the viewer talks to herdr through its socket; where
the socket is not known, through the herdr program, a fifth of a second). herdr does not tell where the cursor is, so no
cursor is drawn. On a phone the terminal's font shrinks to fit the width, down to a readable size, and it scrolls
sideways past that. A tab split into several panes shows the one running Claude Code, or else its first pane.

![A herdr tab's terminal next to the herdr sidebar](docs/terminal.png)

### Sending prompts

An input box appears under the feed: the text is typed into
the session's terminal and submitted with Enter, exactly as if you typed it there. While Claude is busy, Claude Code
queues it. "Stop" sends Esc. As in the terminal, a prompt Claude had not started on comes back for editing: the viewer
takes it out of the terminal's input box and puts it into the page's box, exactly as it was sent, before anything
already typed there. Drafts are kept per session.

Images can go with a prompt: pick them with the paperclip (on a phone — from the gallery or the camera), paste a
screenshot anywhere on the page (Ctrl+V), or drop files on the box. The page scales photos down to 2048 px before sending; the viewer saves them in
`~/.claude-code-webview/uploads/` and lists their paths at the end of the prompt, and Claude Code opens them with its
Read tool. In the feed the list shows as pictures again.

`/btw <question>` in the box asks a side question, as in the terminal: Claude answers from what the conversation
already holds, with no tools, even while it is busy, and nothing is added to the conversation. Claude Code shows the
answer only in a panel over its prompt box, so the viewer reads it off the terminal — scrolling to its end — closes
the panel and shows the answer above the page's box. Prompts sent meanwhile wait until the panel is closed.

Rewind works as Esc Esc does in the terminal: the ↶ next to one of your messages offers the same choices — restore
code and conversation, the conversation, or the code, summarize from or up to that message. The viewer drives
Claude Code's `/rewind` menu with keys, checks every step on the screen (the message by its full text on the
confirmation) and closes the menu if anything looks different. It works only while Claude waits for input. After the
conversation is restored, the message comes back into the box on the page to be edited and sent again.

The feed shows only the active branch of a conversation: a rewind deletes nothing from the transcript, so the
messages it undid are left out.

### Workspaces in the session list

In "Sessions" the session list shows each session's herdr workspace next to its folder (unless they are named alike), the search
finds sessions by workspace, and "Group by herdr workspace" gathers the list under the workspaces' names — the latest
worked on first, the sessions with no workspace last. A session's workspace is:

- the one whose pane runs it, while it runs — and it stays its workspace after the session ends
  (`~/.claude-code-webview/workspaces.json`);
- for a session never seen running, the workspace whose panes are open in its folder, if just one workspace has panes
  there.

### Finding herdr

To let the viewer find your herdr, start it once from a herdr pane — herdr sets `HERDR_BIN_PATH` and
`HERDR_SOCKET_PATH` there, and the viewer remembers them in `~/.claude-code-webview/herdr.json` for launches outside
herdr (for example from a desktop shortcut).

How a prompt reaches the terminal:

```
~/.claude/sessions/<pid>.json        → which process has the session open (Claude Code keeps this registry)
herdr pane list + pane process-info  → the herdr pane running that process
herdr pane send-text + send-keys     → the text and Enter, into that pane
```

Questions with options (AskUserQuestion) still need to be answered in the terminal.

## On your phone

The viewer answers on your computer only (`127.0.0.1`). To open it from a phone — at home or anywhere — put it behind
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
and [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
right on the computer that runs the viewer. `cloudflared` connects out to Cloudflare, so there is no server to rent, no
port to open on the router and no address to keep track of. The free plans are enough; you need a domain on Cloudflare.

1. **Tunnel.** In the Cloudflare dashboard, **Networking → Tunnels → Create a tunnel**, and install `cloudflared` on
   the computer with the command the dashboard shows: it runs as a service and starts with the computer.
2. **Route.** In the tunnel, **Routes → Add route → Published application**: a hostname such as `viewer.example.com`
   and the service URL `http://localhost:7788`.
3. **Login.** **Zero Trust → Access controls → Applications → Create new application → Self-hosted and private**, for
   the same hostname, with the policy **Allow · Include · Emails · you@example.com** and the One-time PIN login (a code
   by email) or a Google or GitHub account. A long **Session Duration**, a month say, saves logging in again on the
   phone. Do not skip this step: without it the tunnel shows your sessions — secrets included — to anyone who finds
   the address, and with herdr lets them type into your terminals.
4. **Belt and braces.** On the route, turn on
   [Protect with Access](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)
   (it asks for your team name and the application's AUD tag): `cloudflared` then passes on only requests that carry a
   valid Access token, even if the Access application is changed or deleted later.
5. **The viewer.** Start it with its public address:
   `node bin/claude-code-webview.js --background --public-url https://viewer.example.com`. The viewer answers only its
   own addresses, so without `--public-url` it turns away whatever comes through the tunnel.

Open `https://viewer.example.com` on the phone, log in, and add the page to the Home Screen (Safari: Share → Add to
Home Screen). It gets an icon in the viewer's palette, and Safari keeps its saved copies: with the computer off the
page still opens and shows what it saved, and catches up once the computer is back (see **Offline** above).

On a phone the session list and the outline slide in from the sides, and the swipe from the left edge — the browser's
Back — brings back the list the session was chosen in. On the touch keyboard Enter starts a new line and ↑ sends; the
paperclip takes photos from the gallery or the camera.

![On a phone: a session with its herdr tabs, the herdr sidebar, a terminal](docs/mobile.png)

Several computers? Give each its own tunnel, hostname and `--palette`, and the pages are told apart at a glance.

## Commands

| Command | What it does |
| --- | --- |
| `node bin/claude-code-webview.js` | start and open the browser; Ctrl+C stops it |
| `node bin/claude-code-webview.js --background` | start without a terminal window (log: `~/.claude-code-webview/server.log`) |
| `node bin/claude-code-webview.js --stop` | stop the running viewer |
| `node bin/claude-code-webview.js --restart` | stop and start again in the background |
| `node bin/claude-code-webview.js --port 7800` | use another port |
| `node bin/claude-code-webview.js --palette sea` | another accent colour: clay (default), sea, moss, plum |
| `node bin/claude-code-webview.js --public-url https://viewer.example.com` | also answer at this address, behind a tunnel (see **On your phone**); repeat for more |
| `node bin/claude-code-webview.js --no-open` | do not open the browser |
| `node bin/claude-code-webview.js --no-herdr` | do not use herdr even if it is found: the page only reads sessions |
| `node bin/claude-code-webview.js --claude-command my-claude` | start Claude Code with this command in a tab opened from the page (default: `claude`) |
| `node bin/claude-code-webview.js --editor-command "code --goto {path}:{line}"` | open a file of the file panel in an editor of this computer; `{path}`, `{line}` and `{project}` — the nearest folder above the file with a `.sln`, `.slnx` or `.git` — are filled in; the program is started directly, not through a shell — on Windows name its `.exe`. Rider: `"C:/Program Files/JetBrains/Rider/bin/rider64.exe" {project} --line {line} {path}` |
| `node bin/claude-code-webview.js --install-shortcut` | Windows: desktop shortcut that starts the viewer in the background (`--start-menu` for the Start menu) |

`npm start -- <options>` does the same as `node bin/claude-code-webview.js <options>`.

`--stop` only stops a process that answers on the port as this viewer; another program on the port is left alone.
Sessions are read from `~/.claude/projects`; if you moved the Claude Code folder, `CLAUDE_CONFIG_DIR` is respected.

The desktop shortcut starts the viewer from the folder it was created in: after moving the folder, create it again.

## How it works

```
~/.claude/projects/<project>/<session>.jsonl    ← Claude Code appends one line per block
        │  the server checks the size every 400 ms and reads what was appended
        ▼  only what the feed needs is kept (no file snapshots, system prompt, …)
SSE /api/stream?session=<id>
        ▼
transcript record → feed events (pure functions) → DOM
```

Subagent transcripts live next to the session (`<session>/subagents/agent-<id>.jsonl`) and are linked to their Agent
call through `agent-<id>.meta.json`. A session moved with `/cd` is found in its new folder automatically.

## Security

Transcripts contain everything the agent has seen, secrets included. So the viewer:

- listens on `127.0.0.1` only and answers only requests whose `Host` is that address (or one given with
  `--public-url`), so a web page cannot read it through DNS rebinding;
- leaves the login on a public address to whatever stands in front of it: an address given with `--public-url` must be
  behind one, such as Cloudflare Access (see **On your phone**);
- sanitizes markdown from transcripts with DOMPurify;
- accepts the one write operation — sending a prompt to a terminal — only from its own page: the request must carry
  the viewer's `Origin`, a JSON body and an `X-Viewer` header, which another site cannot send without a CORS preflight
  that the server never allows. herdr is run without a shell, so the prompt text is never interpreted as a command;
- serves file contents for the side panel (`/api/file`, any text file up to 2 MB by absolute path) under the same rules.

## Limitations

- After rewinding a conversation (Esc Esc) both branches stay in the transcript; the feed shows records in file order.
- Cost appears in the header only when Claude Code wrote it to the transcript.

## Development

```bash
npm install          # with the development tools: TypeScript, jsdom
npm start            # run from the working copy
npm test             # node:test — transcript parsing, file links, server, markdown (jsdom), CLI
npm run check        # TypeScript checks the JavaScript through JSDoc in strict mode
```

| Folder | Contents |
| --- | --- |
| `bin/`, `cli/` | the `claude-code-webview` command: arguments, foreground/background start, stop, shortcut |
| `server/` | HTTP server, session list, transcript stream, file panel; through herdr: its layout, terminals, sending prompts |
| `public/model/` | pure functions: transcript parsing, tool rows and diffs, file links, outline, formatting |
| `public/view/` | rendering of the feed, tool rows, markdown, file panel, outline, input box, herdr view, terminal |
| `assets/`, `scripts/` | shortcut icon, and the script that draws it and the home screen icons (`public/favicons/*.png`) |
| `test/` | tests |

## License

[MIT](LICENSE)
