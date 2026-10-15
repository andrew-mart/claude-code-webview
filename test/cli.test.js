import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../cli/args.js';
import { isTemporaryInstall } from '../cli/shortcut.js';

test('isTemporaryInstall_Should_RecognizeNpxCacheOnEverySystem', () => {
  assert.equal(isTemporaryInstall('C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\1f2e\\node_modules\\claude-code-webview\\bin\\claude-code-webview.js'), true);
  assert.equal(isTemporaryInstall('/home/a/.npm/_npx/1f2e/node_modules/claude-code-webview/bin/claude-code-webview.js'), true);
  assert.equal(isTemporaryInstall('C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\claude-code-webview\\bin\\claude-code-webview.js'), false);
  assert.equal(isTemporaryInstall('D:\\dev\\claude-code-webview\\bin\\claude-code-webview.js'), false);
});

test('parseCommand_Should_ServeAndOpenBrowserByDefault', () => {
  assert.deepEqual(parseCommand([]), { ok: true, command: { action: 'serve', port: 7788, open: true, startMenu: false, palette: 'clay', publicAddresses: [], herdr: 'on', claudeCommand: 'claude', editor: undefined, vscode: undefined } });
});

test('parseCommand_Should_ReadActionPortAndBrowserFlag', () => {
  assert.deepEqual(parseCommand(['--background', '--port', '7800', '--no-open']), {
    ok: true,
    command: { action: 'background', port: 7800, open: false, startMenu: false, palette: 'clay', publicAddresses: [], herdr: 'on', claudeCommand: 'claude', editor: undefined, vscode: undefined },
  });
  assert.deepEqual(parseCommand(['--install-shortcut', '--start-menu']), {
    ok: true,
    command: { action: 'install-shortcut', port: 7788, open: true, startMenu: true, palette: 'clay', publicAddresses: [], herdr: 'on', claudeCommand: 'claude', editor: undefined, vscode: undefined },
  });
  assert.deepEqual(
    [parseCommand(['-v']), parseCommand(['--help'])].map((parsed) => parsed.ok && parsed.command.action),
    ['version', 'help'],
  );
});

test('parseCommand_Should_RejectInvalidPortConflictingActionsAndUnknownOptions', () => {
  assert.deepEqual(parseCommand(['--port', '99999']), { ok: false, error: 'Invalid --port value "99999": expected a number from 1 to 65535.' });
  assert.deepEqual(parseCommand(['--stop', '--restart']), { ok: false, error: 'Choose one action: --stop and --restart cannot be used together.' });
  assert.equal(parseCommand(['--colour']).ok, false);
});

test('parseCommand_Should_ReadPaletteThatTellsThisViewerFromAnotherOneAndRejectUnknownOnes', () => {
  const parsed = parseCommand(['--palette', 'sea']);

  assert.equal(parsed.ok && parsed.command.palette, 'sea');
  assert.deepEqual(parseCommand(['--palette', 'neon']), { ok: false, error: 'Invalid --palette value "neon": expected one of clay, sea, moss, plum.' });
});

// Behind a tunnel the page is opened at a public address, and its requests carry that Host and Origin
test('parseCommand_Should_ReadPublicAddressesThePageIsOpenedAt', () => {
  const parsed = parseCommand(['--public-url', 'https://viewer.example.com', '--public-url', 'https://old.example.com:8443/']);

  assert.deepEqual(parsed.ok && parsed.command.publicAddresses, [
    { origin: 'https://viewer.example.com', host: 'viewer.example.com' },
    { origin: 'https://old.example.com:8443', host: 'old.example.com:8443' },
  ]);
});

// The page is served from the root of the address, over http or https
test('parseCommand_Should_RejectPublicUrlThatIsNotJustAnAddress', () => {
  for (const value of ['https://viewer.example.com/viewer', 'https://viewer.example.com/?a=1', 'ftp://viewer.example.com', 'viewer.example.com']) {
    const parsed = parseCommand(['--public-url', value]);

    const told = parsed.ok ? 'accepted' : parsed.error;
    assert.ok(told.startsWith(`Invalid --public-url value "${value}"`), `${value}: ${told}`);
  }
});

// herdr is used when it is found; --no-herdr keeps the viewer read-only even then
test('parseCommand_Should_TurnHerdrOffOnRequest', () => {
  assert.deepEqual(
    [parseCommand([]), parseCommand(['--no-herdr'])].map((parsed) => parsed.ok && parsed.command.herdr),
    ['on', 'off'],
  );
});

// A file opens in the editor of the viewer's computer when the viewer is given the editor's command, with a place for
// the file; without one there is no editor
test('parseCommand_Should_ReadEditorCommand', () => {
  const given = parseCommand(['--editor-command', 'rider64.exe {project} --line {line} {path}']);
  const none = parseCommand([]);
  const blind = parseCommand(['--editor-command', 'rider64.exe --line {line}']);

  assert.deepEqual(
    [given.ok && given.command.editor, none.ok && none.command.editor, blind],
    [
      { text: 'rider64.exe {project} --line {line} {path}', command: { program: 'rider64.exe', args: ['{project}', '--line', '{line}', '{path}'] } },
      undefined,
      { ok: false, error: 'Invalid --editor-command value "rider64.exe --line {line}": expected the command of an editor with {path} for the file — and {line}, {project} if it takes them — such as "code --goto {path}:{line}".' },
    ],
  );
});

// VS Code in the browser runs when the viewer is given the VS Code CLI to start it with — a path with spaces as it is;
// a path of nothing is none
test('parseCommand_Should_ReadVsCodeCli', () => {
  const given = parseCommand(['--vscode', 'C:/Program Files/Microsoft VS Code/bin/code-tunnel.exe']);
  const blank = parseCommand(['--vscode', '  ']);

  assert.deepEqual(
    [given.ok && given.command.vscode, blank],
    ['C:/Program Files/Microsoft VS Code/bin/code-tunnel.exe', { ok: false, error: 'Invalid --vscode value "  ": expected the VS Code CLI that runs its web server — code-tunnel.exe of VS Code on Windows, code elsewhere.' }],
  );
});

// A tab opened from the page starts Claude Code with "claude", or with the command the viewer is given — a wrapper of
// one's own; a command of nothing is no command
test('parseCommand_Should_ReadCommandThatStartsClaudeCode', () => {
  const given = parseCommand(['--claude-command', 'claude-god']);
  const empty = parseCommand(['--claude-command', ' ']);

  assert.deepEqual(
    [given.ok && given.command.claudeCommand, empty],
    ['claude-god', { ok: false, error: 'Invalid --claude-command value " ": expected the command that starts Claude Code in a terminal, such as claude.' }],
  );
});
