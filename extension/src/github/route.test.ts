import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationPath, parsePullPath } from './route.ts';

test('parses the changes and conversation paths', () => {
  const expected = { owner: 'acme', repo: 'api', number: 42 };
  assert.deepEqual(parsePullPath('/acme/api/pull/42/changes'), expected);
  assert.deepEqual(parsePullPath('/acme/api/pull/42'), expected);
  assert.equal(conversationPath(expected), '/acme/api/pull/42');
});

test('rejects non-PR paths', () => {
  assert.equal(parsePullPath('/acme/api/pulls'), null);
  assert.equal(parsePullPath('/acme/api/pull/42abc'), null);
  assert.equal(parsePullPath('/acme/api/issues/42'), null);
});
