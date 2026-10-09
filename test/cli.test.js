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
  assert.deepEqual(parseCommand([]), { ok: true, command: { action: 'serve', port: 7788, open: true, startMenu: false } });
});

test('parseCommand_Should_ReadActionPortAndBrowserFlag', () => {
  assert.deepEqual(parseCommand(['--background', '--port', '7800', '--no-open']), {
    ok: true,
    command: { action: 'background', port: 7800, open: false, startMenu: false },
  });
  assert.deepEqual(parseCommand(['--install-shortcut', '--start-menu']), {
    ok: true,
    command: { action: 'install-shortcut', port: 7788, open: true, startMenu: true },
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
