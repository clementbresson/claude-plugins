import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffAnchorId } from './anchor.ts';

// Expected values from `printf '%s' PATH | shasum -a 256`, as the plugin does.
test('hashes the path like the plugin deep links', async () => {
  assert.equal(
    await diffAnchorId('src/index.ts'),
    'diff-a2a171449d862fe29692ce031981047d7ab755ae7f84c707aef80701b3ea0c80',
  );
});

test('hashes non-ASCII paths as UTF-8', async () => {
  assert.equal(
    await diffAnchorId('app/$slug/(app)/café «x».tsx'),
    'diff-309f423d410954cb1449490c440d0c260ad1edfcc50e4e0b96fe900ecd2fb3af',
  );
});
