# Claude Code Webview

Watch your [Claude Code](https://code.claude.com) sessions live in the browser, laid out the way Claude Desktop shows
them: your prompts in bubbles, answers in rendered markdown, tool calls folded into compact rows with diffs and output.
Every line Claude Code writes to the session transcript shows up on the page within half a second.

![Claude Code Webview](docs/screenshot.png)

## Quick start

```bash
npx claude-code-webview
```

That's it: the viewer starts on http://127.0.0.1:7788 and opens in your browser. If it is already running, the command
just opens the browser. Requires Node.js 22 or newer. Press Ctrl+C to stop.

Prefer a permanent install?

```bash
npm install -g claude-code-webview
claude-code-webview --background     # run without a terminal window
```

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
  The panel shows the file as it is on disk now, not at the time of the answer.
- **Outline and bookmarks.** A right-hand outline lists your prompts (the one on screen is highlighted; Alt+↑ / Alt+↓
  jump between them) and your bookmarks: hover a prompt, an answer or a subagent report and click the flag to keep it
  one click away. Bookmarks are stored in your browser, per session.
- Light and dark themes, serif or sans answers, optional display of Claude Code's service messages.

## Sending prompts from the page (optional, needs herdr)

If you run Claude Code inside [herdr](https://herdr.dev), an input box appears under the feed: the text is typed into
the session's terminal and submitted with Enter, exactly as if you typed it there. While Claude is busy, Claude Code
queues it. "Stop" sends Esc. Drafts are kept per session.

Without herdr everything else works and the input box is simply not shown.

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

## Commands

| Command | What it does |
| --- | --- |
| `claude-code-webview` | start and open the browser; Ctrl+C stops it |
| `claude-code-webview --background` | start without a terminal window (log: `~/.claude-code-webview/server.log`) |
| `claude-code-webview --stop` | stop the running viewer |
| `claude-code-webview --restart` | stop and start again in the background |
| `claude-code-webview --port 7800` | use another port |
| `claude-code-webview --no-open` | do not open the browser |
| `claude-code-webview --install-shortcut` | Windows: desktop shortcut that starts the viewer in the background (`--start-menu` for the Start menu) |

`--stop` only stops a process that answers on the port as this viewer; another program on the port is left alone.
Sessions are read from `~/.claude/projects`; if you moved the Claude Code folder, `CLAUDE_CONFIG_DIR` is respected.

The desktop shortcut needs a global install (`npm install -g claude-code-webview`): a copy in the npx cache can be
cleaned up by npm at any time, so the command refuses to point a shortcut at it.

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

- listens on `127.0.0.1` only and answers only requests whose `Host` is that address, so a web page cannot read it
  through DNS rebinding;
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
git clone https://github.com/ryletko/claude-code-webview.git && cd claude-code-webview
npm install
npm start            # run from the working copy
npm test             # node:test — transcript parsing, file links, server, markdown (jsdom), CLI
npm run check        # TypeScript checks the JavaScript through JSDoc in strict mode
```

| Folder | Contents |
| --- | --- |
| `bin/`, `cli/` | the `claude-code-webview` command: arguments, foreground/background start, stop, shortcut |
| `server/` | HTTP server, session list, transcript stream, file panel, sending prompts through herdr |
| `public/model/` | pure functions: transcript parsing, tool rows and diffs, file links, outline, formatting |
| `public/view/` | rendering of the feed, tool rows, markdown, file panel, outline, input box |
| `assets/`, `scripts/` | shortcut icon and the script that draws it |
| `test/` | tests |

## License

[MIT](LICENSE)
