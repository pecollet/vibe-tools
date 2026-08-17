'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('../helpers/page');

let pageP;
const getWindow = () => (pageP ??= loadPage()).then(p => p.window);

test('normalizeType maps unknown/missing types to string', async () => {
  const w = await getWindow();
  assert.equal(w.normalizeType(undefined), 'string');
  assert.equal(w.normalizeType(''), 'string');
  assert.equal(w.normalizeType('?'), 'string');
  assert.equal(w.normalizeType('UNKNOWN'), 'string');
});

test('normalizeType maps textual and numeric types', async () => {
  const w = await getWindow();
  assert.equal(w.normalizeType('String'), 'string');
  assert.equal(w.normalizeType('Text'), 'string');
  assert.equal(w.normalizeType('Boolean'), 'boolean');
  assert.equal(w.normalizeType('Float'), 'float');
  assert.equal(w.normalizeType('Double'), 'float');
  assert.equal(w.normalizeType('Integer'), 'integer');
  assert.equal(w.normalizeType('Long'), 'integer');
  assert.equal(w.normalizeType('Number'), 'integer');
});

test('normalizeType maps temporal, duration and point types', async () => {
  const w = await getWindow();
  assert.equal(w.normalizeType('Date'), 'date');
  assert.equal(w.normalizeType('DateTime'), 'datetime');
  assert.equal(w.normalizeType('ZonedDateTime'), 'datetime');
  assert.equal(w.normalizeType('LocalDateTime'), 'localdatetime');
  assert.equal(w.normalizeType('Time'), 'time');
  assert.equal(w.normalizeType('ZonedTime'), 'time');
  assert.equal(w.normalizeType('LocalTime'), 'localtime');
  assert.equal(w.normalizeType('Duration'), 'duration');
  assert.equal(w.normalizeType('Point'), 'point');
});

test('isUniqueProp detects uniqueness and key constraints (case-insensitive)', async () => {
  const w = await getWindow();
  assert.equal(w.isUniqueProp({ constraintTypes: ['Uniqueness'] }), true);
  assert.equal(w.isUniqueProp({ constraintTypes: ['Key'] }), true);
  assert.equal(w.isUniqueProp({ constraintTypes: ['NODE_KEY'] }), true);
  assert.equal(w.isUniqueProp({ constraintTypes: ['unique'] }), true);
});

test('isUniqueProp is false for other or missing constraints', async () => {
  const w = await getWindow();
  assert.equal(w.isUniqueProp({ constraintTypes: ['Existence', 'PropertyType'] }), false);
  assert.equal(w.isUniqueProp({ constraintTypes: [] }), false);
  assert.equal(w.isUniqueProp({}), false);
});
