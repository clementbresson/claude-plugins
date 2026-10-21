import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOISE, planOrder, STEP, UNLISTED } from './order.ts';

const group = (name: string, files: string[]) => ({ name, files, explanation: '' });

test('follows groups, then files within a group', () => {
  const plan = planOrder({
    version: 1,
    groups: [group('b', ['z.ts', 'a.ts']), group('a', ['m.ts'])],
    noise: [],
  });
  assert.deepEqual([...plan], [['z.ts', STEP], ['a.ts', 2 * STEP], ['m.ts', 3 * STEP]]);
});

test('sinks noise below files the walkthrough does not mention', () => {
  const plan = planOrder({ version: 1, groups: [group('a', ['a.ts'])], noise: ['pnpm-lock.yaml'] });
  assert.equal(plan.get('pnpm-lock.yaml'), NOISE);
  assert.ok(NOISE > UNLISTED);
  assert.ok(STEP * 10_000 < UNLISTED);
});

test('keeps the first occurrence of a duplicated path', () => {
  const plan = planOrder({
    version: 1,
    groups: [group('a', ['a.ts', 'b.ts']), group('b', ['a.ts'])],
    noise: ['b.ts'],
  });
  assert.deepEqual([...plan], [['a.ts', STEP], ['b.ts', 2 * STEP]]);
});
