'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, norm } = require('../helpers/page');

let pageP;
const getWindow = () => (pageP ??= loadPage()).then(p => p.window);

test('nodeQuery follows the batched MERGE pattern', async () => {
  const w = await getWindow();
  const q = w.nodeQuery('Person', 500, ['n.name = left(randomUUID(), 8)']);
  assert.ok(q.includes('UNWIND range(1, 500) AS i'));
  assert.ok(q.includes('MERGE (n:Person {synthetic_id: i})'));
  assert.ok(q.includes('SET n.name = left(randomUUID(), 8)'));
  assert.ok(q.includes('IN CONCURRENT TRANSACTIONS OF 1000 ROWS'));
});

test('nodeQuery omits the SET clause when there are no properties', async () => {
  const w = await getWindow();
  const q = w.nodeQuery('Animal', 10, []);
  assert.ok(!q.includes('SET'));
});

test('nodeQuery quotes labels with special characters', async () => {
  const w = await getWindow();
  const q = w.nodeQuery('My Label', 10, []);
  assert.ok(q.includes('MERGE (n:`My Label` {synthetic_id: i})'));
});

test('nodeQuery adds implied labels (label existence constraints) in the SET clause', async () => {
  const w = await getWindow();
  const q = w.nodeQuery('Pet', 10, ['n.name = left(randomUUID(), 8)'], ['Resident', 'Animal']);
  assert.ok(q.includes('SET n:Resident:Animal, n.name = left(randomUUID(), 8)'));
  // with no properties, the SET clause still carries the labels
  const q2 = w.nodeQuery('Pet', 10, [], ['Resident']);
  assert.ok(q2.includes('SET n:Resident'));
  // implied labels are quoted when needed
  const q3 = w.nodeQuery('Pet', 10, [], ['My Label']);
  assert.ok(q3.includes('SET n:`My Label`'));
});

test('relQuerySimple follows the normal-distribution pattern with 1-based ids', async () => {
  const w = await getWindow();
  const q = w.relQuerySimple('LOVES', 'Person', 'City', 42, ['r.since = date()']);
  assert.ok(q.includes('LET mu = 0.5'));
  assert.ok(q.includes('LET sigma = 0.166'));
  assert.ok(q.includes('MATCH (s:Person)'));
  assert.ok(q.includes('RETURN count(s) AS sourceCount'));
  assert.ok(q.includes('UNWIND range(1, 42) AS i'));
  // ids must land in [1..count]: capped strictly below 1.0, then +1 offset
  assert.ok(q.includes('THEN 0.9999999 ELSE'));
  assert.ok(q.includes('toInteger(normal_rand1_capped * sourceCount) + 1 AS s_id'));
  assert.ok(q.includes('toInteger(normal_rand2_capped * targetCount) + 1 AS t_id'));
  assert.ok(q.includes('MATCH (s:Person {synthetic_id: s_id})'));
  assert.ok(q.includes('MERGE (s)-[r:LOVES]->(t)'));
  assert.ok(q.includes('SET r.since = date()'));
  assert.ok(q.includes('IN TRANSACTIONS OF 1000 ROWS'));
  assert.ok(!q.includes('CONCURRENT'));
});

test('relQuerySimple omits SET when the relationship has no properties', async () => {
  const w = await getWindow();
  const q = w.relQuerySimple('KNOWS', 'A', 'B', 5, []);
  assert.ok(!q.includes('SET '));
});

test('cypherMap builds a Cypher map literal with quoted keys when needed', async () => {
  const w = await getWindow();
  assert.equal(w.cypherMap([{ label: 'A', count: 10 }, { label: 'My B', count: 20 }]), '{A: 10, `My B`: 20}');
});

test('relQueryAmbiguous embeds sources/targets maps and uses dynamic labels', async () => {
  const w = await getWindow();
  const q = w.relQueryAmbiguous('AMBIG',
    [{ label: 'A', count: 800 }, { label: 'B', count: 200 }],
    [{ label: 'C', count: 300 }, { label: 'D', count: 700 }],
    []);
  assert.ok(q.includes('LET sources = {A: 800, B: 200}'));
  assert.ok(q.includes('LET targets = {C: 300, D: 700}'));
  assert.ok(q.includes('LET totalRelCount = reduce(sum = 0, k IN keys(targets) | sum + targets[k])'));
  assert.ok(q.includes('MATCH (s:$(srcLabel)'));
  assert.ok(q.includes('MATCH (t:$(tgtLabel)'));
  assert.ok(q.includes('LET randNum = rand() * totalRelCount'));
  assert.ok(q.includes('MERGE (s)-[r:AMBIG]->(t)'));
  assert.ok(q.includes('IN TRANSACTIONS OF 1000 ROWS'));
});

test('normalRandBlock produces the Box-Muller sample with capping', async () => {
  const w = await getWindow();
  const block = w.normalRandBlock(1);
  assert.ok(block.includes('LET normal_rand1 = sqrt(-2.0*ln(rand())) * cos(2.0*pi()*rand()) * sigma + mu'));
  assert.ok(block.includes('LET normal_rand1_capped = CASE WHEN normal_rand1 < 0.0 THEN 0.0'));
});

test('splitCount splits proportionally to per-label counts', async () => {
  const w = await getWindow();
  const parts = w.splitCount(100, ['A', 'B'], [{ label: 'A', count: 3 }, { label: 'B', count: 1 }]);
  assert.deepEqual(norm(parts), [{ label: 'A', count: 75 }, { label: 'B', count: 25 }]);
});

test('splitCount falls back to an even split without per-label counts', async () => {
  const w = await getWindow();
  assert.deepEqual(norm(w.splitCount(10, ['A', 'B'], [])), [{ label: 'A', count: 5 }, { label: 'B', count: 5 }]);
  assert.deepEqual(norm(w.splitCount(10, ['A', 'B'], null)), [{ label: 'A', count: 5 }, { label: 'B', count: 5 }]);
});

test('splitCount falls back to an even split when some labels have no count', async () => {
  const w = await getWindow();
  const parts = w.splitCount(10, ['A', 'B'], [{ label: 'A', count: 9 }]);
  assert.deepEqual(norm(parts), [{ label: 'A', count: 5 }, { label: 'B', count: 5 }]);
});
