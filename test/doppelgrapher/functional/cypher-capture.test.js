'use strict';

// Functional test: full UI flow (drop model_json -> connect -> ingest) with a stubbed
// neo4j driver that records every executed Cypher statement, asserting the generated
// queries and their execution order without needing a database.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, dropModel, setScale, connect, ingestAndWait, stubNeo4j } = require('../helpers/page');
const { specModel, ambiguousModel } = require('../helpers/fixtures');

async function runFullFlow({ model, scale = 100, stubOpts = {}, database = 'neo4j' }) {
  const record = [];
  const { window: w } = await loadPage({ neo4j: stubNeo4j(record, stubOpts) });
  await dropModel(w, model);
  await connect(w, { database });
  if (scale !== 100) setScale(w, scale);
  const summary = await ingestAndWait(w);
  return { w, record, summary };
}

test('ingestion executes the graph type, then constraints, indexes, nodes, relationships', async () => {
  const { record, summary } = await runFullFlow({ model: specModel() });

  const kinds = record.map(r =>
    /ALTER CURRENT GRAPH TYPE/.test(r.cypher) ? 'graphtype' :
    /CREATE\s+CONSTRAINT/.test(r.cypher) ? 'constraint' :
    /CREATE\s+(\w+\s+)?INDEX/.test(r.cypher) ? 'index' :
    /MERGE \(n:/.test(r.cypher) ? 'node' : 'rel');

  // spec model: 1 graph type statement (must run before all CREATE CONSTRAINTs,
  // since setting a graph type replaces existing constraints), then
  // 7 synthetic_id keys + 1 existence constraint (City; Person is covered by
  // its element type) + 2 property type constraints, 1 index,
  // 4 node labels with count > 0, LOVES split into 2 queries
  assert.deepEqual(kinds, [
    'graphtype',
    'constraint', 'constraint', 'constraint', 'constraint', 'constraint',
    'constraint', 'constraint', 'constraint', 'constraint', 'constraint',
    'index',
    'node', 'node', 'node', 'node',
    'rel', 'rel'
  ]);
  assert.ok(summary.includes('✅'));
  assert.ok(summary.includes('18 statement(s) succeeded'));
});

test('the graph type statement covers implied labels and relationship endpoint labels', async () => {
  const { record } = await runFullFlow({ model: specModel() });
  const gt = record.filter(r => r.cypher.includes('ALTER CURRENT GRAPH TYPE'));
  assert.equal(gt.length, 1);
  assert.ok(gt[0].cypher.includes('(:Person => :Resident {name :: STRING NOT NULL})'));
  assert.ok(gt[0].cypher.includes('(:Pet => :Resident&Animal'));
  assert.ok(gt[0].cypher.includes('(:Resident)-[:LIVES_IN => {since :: DATE NOT NULL}]->(:City)'));
  // property type constraints of non-identifying labels use CREATE CONSTRAINT ... IS ::
  const pt = record.filter(r => r.cypher.includes('IS :: ')).map(r => r.cypher);
  assert.ok(pt.some(c => c.includes('(n:City) REQUIRE n.population IS :: INTEGER')));
  assert.ok(pt.some(c => c.includes('(n:City) REQUIRE n.name IS :: STRING')));
});

test('a synthetic_id NODE KEY constraint is created for every node label', async () => {
  const { record } = await runFullFlow({ model: specModel() });
  const constraintCyphers = record.filter(r => r.cypher.includes('CREATE CONSTRAINT')).map(r => r.cypher);
  for (const label of ['Resolved_Entity', 'Organisation', 'Animal', 'Resident', 'City', 'Person', 'Pet']) {
    assert.ok(
      constraintCyphers.some(c => c.includes(`FOR (n:${label}) REQUIRE n.synthetic_id IS NODE KEY`)),
      `missing synthetic_id key constraint for :${label}`
    );
  }
});

test('node queries use the counts from the source statistics', async () => {
  const { record } = await runFullFlow({ model: specModel() });
  const nodeCyphers = record.filter(r => /MERGE \(n:/.test(r.cypher)).map(r => r.cypher);
  const org = nodeCyphers.find(c => c.includes('(n:Organisation'));
  assert.ok(org.includes('UNWIND range(1, 100000) AS i'));
  assert.ok(org.includes('IN CONCURRENT TRANSACTIONS OF 1000 ROWS'));
  // property assignments generated from the model, synthetic_id excluded from SET
  assert.ok(org.includes('n.del_indc ='));
  assert.ok(org.includes('n.nme ='));
  assert.ok(!org.includes('SET n.synthetic_id'));
  // implied label constraints: Person nodes must also get the Resident label
  const person = nodeCyphers.find(c => c.includes('(n:Person'));
  assert.ok(person.includes('SET n:Resident'), person);
  // zero/null count labels are unchecked by default and must not run
  assert.ok(!nodeCyphers.some(c => c.includes('(n:Animal') || c.includes('(n:Pet') || c.includes('(n:Resolved_Entity')));
});

test('the scale factor is applied to all generated counts', async () => {
  const { record } = await runFullFlow({ model: specModel(), scale: 50 });
  const org = record.find(r => r.cypher.includes('MERGE (n:Organisation'));
  assert.ok(org.cypher.includes('UNWIND range(1, 50000) AS i'));
});

test('1-n relationship types are split into one unambiguous query per label', async () => {
  const { record } = await runFullFlow({ model: specModel() });
  const relCyphers = record.filter(r => r.cypher.includes('MERGE (s)-[r:LOVES]->(t)')).map(r => r.cypher);
  assert.equal(relCyphers.length, 2);
  assert.ok(relCyphers.some(c => c.includes('MATCH (s:Resident {synthetic_id: s_id})')));
  assert.ok(relCyphers.some(c => c.includes('MATCH (s:Person {synthetic_id: s_id})')));
  assert.ok(relCyphers.every(c => c.includes('MATCH (t:City {synthetic_id: t_id})')));
});

test('ambiguous n-n relationship types use one weighted-pick query with dynamic labels', async () => {
  const { record } = await runFullFlow({ model: ambiguousModel() });
  const ambig = record.filter(r => r.cypher.includes('MERGE (s)-[r:AMBIG]->(t)'));
  assert.equal(ambig.length, 1);
  const q = ambig[0].cypher;
  assert.ok(q.includes('LET sources = {Organisation: 800, Person: 200}'));
  assert.ok(q.includes('LET targets = {City: 300, Resident: 700}'));
  assert.ok(q.includes('MATCH (s:$(srcLabel) {synthetic_id: s_id})'));
});

test('every statement runs against the selected target database', async () => {
  const { record } = await runFullFlow({ model: specModel(), database: 'mydb' });
  assert.ok(record.length > 0);
  assert.ok(record.every(r => r.database === 'mydb'));
});

test('a failing statement is reported but the ingestion continues', async () => {
  const { w, record, summary } = await runFullFlow({
    model: specModel(),
    stubOpts: { failOn: 'MERGE (n:Organisation' }
  });
  assert.ok(summary.includes('1 failed'), `summary was: ${summary}`);
  assert.ok(summary.includes('17 succeeded'));
  // relationships after the failed node load still executed
  assert.equal(record.filter(r => r.cypher.includes('MERGE (s)-[r:LOVES]->(t)')).length, 2);
  const logText = w.document.getElementById('log').textContent;
  assert.ok(logText.includes('FAILED'));
});

test('unchecked items are excluded from the ingestion', async () => {
  const record = [];
  const { window: w } = await loadPage({ neo4j: stubNeo4j(record) });
  await dropModel(w, specModel());
  await connect(w);
  // uncheck the whole Relationships group
  const relGroup = [...w.document.querySelectorAll('details.tree-group')]
    .find(g => g.querySelector('summary').textContent.includes('Relationships'));
  const groupCb = relGroup.querySelector('summary input[type=checkbox]');
  groupCb.checked = false;
  groupCb.dispatchEvent(new w.Event('change'));
  await ingestAndWait(w);
  assert.ok(!record.some(r => r.cypher.includes('MERGE (s)-[r:')));
});
