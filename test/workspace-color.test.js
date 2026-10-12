import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceHue } from '../public/model/workspace-color.js';

// A workspace keeps its colour wherever it shows and whenever the page opens: the hue follows from its name alone, and
// workspaces named apart get colours apart
test('workspaceHue_Should_FollowFromWorkspaceNameAlone', () => {
  const names = ['claude-webview', 'kiwi', 'md-keeper', 'trip-plans', 'plotbot', 'plants', 'web', 'webs'];
  const hues = names.map(workspaceHue);

  assert.deepEqual(
    { again: names.map(workspaceHue), hues: hues.every((hue) => Number.isInteger(hue) && hue >= 0 && hue < 360), apart: new Set(hues).size },
    { again: hues, hues: true, apart: names.length },
  );
});
