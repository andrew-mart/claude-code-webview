import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorReach, parseMachine } from '../public/model/machine.js';

const viewer = { instance: '6f1c2a3b-0000-4000-8000-000000000001', port: 7788, editor: true };

// A file opened in the editor shows up on the viewer's computer: the button is for a browser there — one that opened the
// page at the viewer's own address, or whose 127.0.0.1 answers with the same run of the viewer. Until asked, it is not
// known; with no editor given to the viewer there is nothing to open
test('editorReach_Should_TellWhetherBrowserIsOnViewersComputer', () => {
  assert.deepEqual(
    [
      editorReach(viewer, { hostname: '127.0.0.1', local: 'unasked' }),
      editorReach(viewer, { hostname: 'localhost', local: 'unasked' }),
      editorReach(viewer, { hostname: 'viewer.example.com', local: 'unasked' }),
      editorReach(viewer, { hostname: 'viewer.example.com', local: { ...viewer } }),
      editorReach(viewer, { hostname: 'viewer.example.com', local: { ...viewer, instance: '6f1c2a3b-0000-4000-8000-000000000002' } }),
      editorReach(viewer, { hostname: 'viewer.example.com', local: undefined }),
      editorReach({ ...viewer, editor: false }, { hostname: '127.0.0.1', local: 'unasked' }),
    ],
    ['same', 'same', 'unknown', 'same', 'elsewhere', 'elsewhere', 'none'],
  );
});

// The viewer's /api/machine reply, or nothing
test('parseMachine_Should_TakeMachineReply_Or_Nothing', () => {
  assert.deepEqual([parseMachine(viewer), parseMachine({ instance: 'x', port: '7788', editor: true }), parseMachine('down')], [viewer, undefined, undefined]);
});
