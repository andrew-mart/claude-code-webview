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
  assert.deepEqual(parseCommand([]), { ok: true, command: { action: 'serve', port: 7788, open: true, startMenu: false, palette: 'clay', publicAddresses: [], herdr: 'on' } });
});

test('parseCommand_Should_ReadActionPortAndBrowserFlag', () => {
  assert.deepEqual(parseCommand(['--background', '--port', '7800', '--no-open']), {
    ok: true,
    command: { action: 'background', port: 7800, open: false, startMenu: false, palette: 'clay', publicAddresses: [], herdr: 'on' },
  });
  assert.deepEqual(parseCommand(['--install-shortcut', '--start-menu']), {
    ok: true,
    command: { action: 'install-shortcut', port: 7788, open: true, startMenu: true, palette: 'clay', publicAddresses: [], herdr: 'on' },
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
