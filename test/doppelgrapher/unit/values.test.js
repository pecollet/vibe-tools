'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, norm } = require('../helpers/page');

let pageP;
const getWindow = () => (pageP ??= loadPage()).then(p => p.window);

test('valueExpr: unique string property gets a uuid', async () => {
  const w = await getWindow();
  const expr = w.valueExpr({ key: 'id', type: 'String', constraintTypes: ['Uniqueness'] }, 100, 'i');
  assert.equal(expr, 'randomUUID()');
});

test('valueExpr: unique numeric property gets the sequential loop variable', async () => {
  const w = await getWindow();
  const expr = w.valueExpr({ key: 'nb', type: 'Integer', constraintTypes: ['Key'] }, 100, 'i');
  assert.equal(expr, 'i');
});

test('valueExpr: unique numeric property without a sequence variable falls back to a random integer', async () => {
  const w = await getWindow();
  const expr = w.valueExpr({ key: 'nb', type: 'Integer', constraintTypes: ['Key'] }, 100, null);
  assert.equal(expr, 'toInteger(rand()*9007199254740991)');
});

test('valueExpr: indexed with estimatedUniqueSize == entity count generates unique values', async () => {
  const w = await getWindow();
  const expr = w.valueExpr({ key: 'code', type: 'String', constraintTypes: [], indexed: true, estimatedUniqueSize: 100 }, 100, 'i');
  assert.equal(expr, 'randomUUID()');
});

test('valueExpr: indexed with estimatedUniqueSize < entity count picks from a bounded value set', async () => {
  const w = await getWindow();
  const strExpr = w.valueExpr({ key: 'code', type: 'String', constraintTypes: [], indexed: true, estimatedUniqueSize: 20 }, 100, 'i');
  assert.equal(strExpr, "'code_' + toString(toInteger(rand()*20))");
  const intExpr = w.valueExpr({ key: 'nb', type: 'Integer', constraintTypes: [], indexed: true, estimatedUniqueSize: 20 }, 100, 'i');
  assert.equal(intExpr, 'toInteger(rand()*20)');
});

test('valueExpr: estimatedUniqueSize is ignored when the property is not indexed', async () => {
  const w = await getWindow();
  const expr = w.valueExpr({ key: 'code', type: 'String', constraintTypes: [], indexed: false, estimatedUniqueSize: 20 }, 100, 'i');
  assert.equal(expr, 'left(randomUUID(), 8)');
});

test('valueExpr: plain random values per type', async () => {
  const w = await getWindow();
  const cases = {
    String: 'left(randomUUID(), 8)',
    UNKNOWN: 'left(randomUUID(), 8)',
    Integer: 'toInteger(rand()*1000000)',
    Float: 'rand()*1000000',
    Boolean: 'rand() < 0.5',
    Date: "date('2000-01-01') + duration({days: toInteger(rand()*9000)})",
    DateTime: "datetime('2000-01-01T00:00:00Z') + duration({seconds: toInteger(rand()*800000000)})",
    Duration: 'duration({seconds: toInteger(rand()*86400)})',
    Point: 'point({longitude: rand()*360-180, latitude: rand()*180-90})'
  };
  for (const [type, expected] of Object.entries(cases)) {
    assert.equal(w.valueExpr({ key: 'p', type, constraintTypes: [] }, 100, 'i'), expected, `type ${type}`);
  }
});

test('buildSetAssignments prefixes with the entity variable and skips synthetic_id', async () => {
  const w = await getWindow();
  const entity = {
    properties: [
      { key: 'synthetic_id', type: 'String', constraintTypes: [], indexTypes: [], indexed: true },
      { key: 'name', type: 'String', constraintTypes: [], indexTypes: [] },
      { key: 'age', type: 'Integer', constraintTypes: [], indexTypes: [] }
    ]
  };
  const nodeAssignments = w.buildSetAssignments(entity, 'n', 100, 'i');
  assert.deepEqual(norm(nodeAssignments), ['n.name = left(randomUUID(), 8)', 'n.age = toInteger(rand()*1000000)']);
  const relAssignments = w.buildSetAssignments(entity, 'r', 100, 'i');
  assert.ok(relAssignments.every(a => a.startsWith('r.')));
});

test('buildSetAssignments backtick-quotes property keys that need it', async () => {
  const w = await getWindow();
  const entity = { properties: [{ key: 'first name', type: 'String', constraintTypes: [], indexTypes: [] }] };
  const [assignment] = w.buildSetAssignments(entity, 'n', 10, 'i');
  assert.ok(assignment.startsWith('n.`first name` = '));
});

test('buildSetAssignments returns an empty array when there are no properties', async () => {
  const w = await getWindow();
  assert.deepEqual(norm(w.buildSetAssignments({ properties: [] }, 'n', 10, 'i')), []);
  assert.deepEqual(norm(w.buildSetAssignments({}, 'n', 10, 'i')), []);
});
