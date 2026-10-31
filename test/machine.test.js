import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPlace, parseMachine } from '../public/model/machine.js';

const viewer = { instance: '6f1c2a3b-0000-4000-8000-000000000001', port: 7788, editor: true, vscode: true, separator: /** @type {const} */ ('\\') };

// The browser is on the viewer's computer when it opened the page at the viewer's own address, or its 127.0.0.1 answers
// with the same run of the viewer. Until asked, it is not known; nothing answering there is another computer — unless
// the browser refused the page this computer's apps, which tells nothing of where it is. Whether the viewer has an
// editor changes nothing of where the browser is
test('browserPlace_Should_TellWhetherBrowserIsOnViewersComputer', () => {
  assert.deepEqual(
    [
      browserPlace(viewer, { hostname: '127.0.0.1', local: 'unasked' }),
      browserPlace(viewer, { hostname: 'localhost', local: 'unasked' }),
      browserPlace(viewer, { hostname: 'viewer.example.com', local: 'unasked' }),
      browserPlace(viewer, { hostname: 'viewer.example.com', local: { ...viewer } }),
      browserPlace(viewer, { hostname: 'viewer.example.com', local: { ...viewer, instance: '6f1c2a3b-0000-4000-8000-000000000002' } }),
      browserPlace(viewer, { hostname: 'viewer.example.com', local: 'no-answer' }),
      browserPlace(viewer, { hostname: 'viewer.example.com', local: 'refused' }),
      browserPlace({ ...viewer, editor: false }, { hostname: '127.0.0.1', local: 'unasked' }),
    ],
    ['same', 'same', 'unknown', 'same', 'elsewhere', 'elsewhere', 'blocked', 'same'],
  );
});

// The viewer's /api/machine reply, or nothing
test('parseMachine_Should_TakeMachineReply_Or_Nothing', () => {
  assert.deepEqual([parseMachine(viewer), parseMachine({ instance: 'x', port: '7788', editor: true }), parseMachine('down')], [viewer, undefined, undefined]);
});

// A viewer from before VS Code in the browser says nothing of it: it runs none; one from before it told how its computer
// parts a path is taken for one with forward slashes
test('parseMachine_Should_TakeViewerSayingNothingOfVsCodeForOneWithout', () => {
  assert.deepEqual(parseMachine({ instance: 'x', port: 7788, editor: false }), { instance: 'x', port: 7788, editor: false, vscode: false, separator: '/' });
});
