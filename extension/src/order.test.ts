import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK_OFFSET, NOISE, NOT_A_FILE, planOrder, STEP, UNLISTED } from './order.ts';

const group = (name: string, files: string[]) => ({ name, files, explanation: `${name} explained` });

test('follows groups, then files within a group', () => {
  const { files } = planOrder({
    version: 1,
    groups: [group('b', ['z.ts', 'a.ts']), group('a', ['m.ts'])],
    noise: [],
  });
  assert.deepEqual([...files], [['z.ts', STEP], ['a.ts', 2 * STEP], ['m.ts', 3 * STEP]]);
});

test('places each group block just above its first file', () => {
  const { files, groups } = planOrder({
    version: 1,
    groups: [group('b', ['z.ts', 'a.ts']), group('a', ['m.ts'])],
    noise: [],
  });
  assert.deepEqual(groups, [
    { order: STEP - BLOCK_OFFSET, number: 1, total: 2, name: 'b', explanation: 'b explained', fileCount: 2 },
    { order: 3 * STEP - BLOCK_OFFSET, number: 2, total: 2, name: 'a', explanation: 'a explained', fileCount: 1 },
  ]);
  assert.ok(groups[1].order > files.get('a.ts')!);
  assert.ok(groups[1].order < files.get('m.ts')!);
});

test('sinks noise below files the walkthrough does not mention', () => {
  const { files } = planOrder({ version: 1, groups: [group('a', ['a.ts'])], noise: ['pnpm-lock.yaml'] });
  assert.equal(files.get('pnpm-lock.yaml'), NOISE);
  assert.ok(STEP * 10_000 < UNLISTED - BLOCK_OFFSET);
  assert.ok(UNLISTED < NOISE - BLOCK_OFFSET);
  assert.ok(NOISE < NOT_A_FILE);
});

test('keeps the first occurrence of a duplicated path', () => {
  const { files, groups } = planOrder({
    version: 1,
    groups: [group('a', ['a.ts', 'b.ts']), group('b', ['a.ts']), group('c', ['c.ts'])],
    noise: ['b.ts'],
  });
  assert.deepEqual([...files], [['a.ts', STEP], ['b.ts', 2 * STEP], ['c.ts', 3 * STEP]]);
  // Group b owns no file of its own: no block, but numbering still matches the description.
  assert.deepEqual(groups.map((g) => [g.number, g.fileCount]), [[1, 2], [3, 1]]);
});
