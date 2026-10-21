import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseData } from './data.ts';

const valid = {
  version: 1,
  groups: [
    { name: 'The schema', files: ['api/schema.graphql'], explanation: 'Adds the Invoice type.' },
    { name: 'Resolvers', files: ['api/invoice.ts', 'api/invoice.test.ts'], explanation: 'Resolves it.' },
  ],
  noise: ['pnpm-lock.yaml'],
};

const title = (data: unknown) => `pr-flow:data ${JSON.stringify(data)}`;

test('parses a valid block', () => {
  assert.deepEqual(parseData(title(valid)), valid);
});

test('decodes the escapes the producer must apply', () => {
  // As the skill writes it: ' < > & escaped inside the JSON (DATA-CONTRACT.md).
  const escaped = title({ ...valid, groups: [{ ...valid.groups[0], explanation: "It's <b> & -->" }] })
    .replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll("'", '\\u0027');
  assert.equal(parseData(escaped)?.groups[0].explanation, "It's <b> & -->");
});

test('ignores unknown keys', () => {
  const data = parseData(title({ ...valid, risk: 'high', groups: [{ ...valid.groups[0], extra: 1 }] }));
  assert.deepEqual(data?.groups[0], valid.groups[0]);
  assert.equal(data && 'risk' in data, false);
});

test('rejects anything off-contract', () => {
  assert.equal(parseData('pr-flow:data {not json'), null);
  assert.equal(parseData(`something else ${JSON.stringify(valid)}`), null);
  assert.equal(parseData(title({ ...valid, version: 2 })), null);
  assert.equal(parseData(title({ ...valid, noise: undefined })), null);
  assert.equal(parseData(title({ ...valid, groups: [{ name: 'x', files: [1], explanation: '' }] })), null);
  assert.equal(parseData(title({ ...valid, groups: [{ files: [], explanation: '' }] })), null);
  assert.equal(parseData(title([valid])), null);
});
