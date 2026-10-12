import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelWithIcon, splitTabIcon } from '../public/model/tab-icon.js';

// herdr keeps a tab's icon in its label, ahead of the name: the page reads them apart — a compound emoji whole — and
// puts them back together; a label without one has only a name
test('splitTabIcon_Should_ReadIconAheadOfName_AndLabelWithIcon_PutThemBack', () => {
  assert.deepEqual(
    ['🐞 checkout bug', '⚙️ settings', '👩‍💻 pairing', 'notes', '🚀', ''].map(splitTabIcon),
    [
      { icon: '🐞', name: 'checkout bug' },
      { icon: '⚙️', name: 'settings' },
      { icon: '👩‍💻', name: 'pairing' },
      { icon: undefined, name: 'notes' },
      { icon: '🚀', name: '' },
      { icon: undefined, name: '' },
    ],
  );
  assert.deepEqual([labelWithIcon('🧪', ' tests '), labelWithIcon(undefined, 'tests'), labelWithIcon('🚀', '')], ['🧪 tests', 'tests', '🚀']);
});
