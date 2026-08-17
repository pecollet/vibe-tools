'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, jsonFile, rawJsonFile, binFile, readTree } = require('../helpers/page');
const { specModel, buildHcDb, buildZip } = require('../helpers/fixtures');

const STATEMENTS = [
  'CREATE LOOKUP INDEX node_label_lookup_index IF NOT EXISTS FOR (n) ON EACH labels(n)',
  'CREATE LOOKUP INDEX rel_type_lookup_index IF NOT EXISTS FOR ()-[r]-() ON EACH type(r)',
  'CREATE INDEX org_duns IF NOT EXISTS FOR (n:Organisation) ON (n.duns_nbr)',
  'CREATE CONSTRAINT org_key IF NOT EXISTS FOR (n:Organisation) REQUIRE n.duns_nbr IS NODE KEY'
].join(';\n');

test('a valid model_json file shows the checkmark and unlocks section 2', async () => {
  const { window: w, document: doc } = await loadPage();
  await w.handleFile(jsonFile(specModel()));
  assert.equal(doc.getElementById('s1ok').textContent, '✅');
  assert.ok(doc.getElementById('fileStatus').classList.contains('good'));
  assert.ok(!doc.getElementById('section2').classList.contains('locked'));
});

test('invalid JSON reports an error and keeps section 2 locked', async () => {
  const { window: w, document: doc } = await loadPage();
  await w.handleFile(rawJsonFile('this is { not json'));
  assert.equal(doc.getElementById('s1ok').textContent, '');
  assert.ok(doc.getElementById('fileStatus').classList.contains('bad'));
  assert.ok(doc.getElementById('fileStatus').textContent.startsWith('Error:'));
  assert.ok(doc.getElementById('section2').classList.contains('locked'));
});

test('JSON without nodeLabels/relationshipTypes is rejected', async () => {
  const { window: w, document: doc } = await loadPage();
  await w.handleFile(jsonFile({ foo: 'bar' }));
  assert.ok(doc.getElementById('fileStatus').classList.contains('bad'));
  assert.ok(doc.getElementById('fileStatus').textContent.includes('not a valid model'));
});

test('an hc.db SQLite file is read directly (model_json + create statements)', async () => {
  const { window: w, document: doc } = await loadPage();
  const dbBytes = await buildHcDb({ modelJson: specModel(), createStatements: STATEMENTS });
  await w.handleFile(binFile('hc.db', dbBytes));
  assert.equal(doc.getElementById('s1ok').textContent, '✅');
  const tree = readTree(w);
  // statements from the report are used instead of model-derived ones
  const constraintCyphers = tree['Constraints'].map(i => i.cypher);
  assert.ok(constraintCyphers.some(c => c.includes('org_key')));
  const indexCyphers = tree['Indexes'].map(i => i.cypher);
  assert.deepEqual(indexCyphers, ['CYPHER 25\nCREATE INDEX org_duns IF NOT EXISTS FOR (n:Organisation) ON (n.duns_nbr)']);
});

test('default LOOKUP index statements are filtered out', async () => {
  const { window: w } = await loadPage();
  const dbBytes = await buildHcDb({ modelJson: specModel(), createStatements: STATEMENTS });
  await w.handleFile(binFile('hc.db', dbBytes));
  const tree = readTree(w);
  const allCyphers = [...tree['Constraints'], ...tree['Indexes']].map(i => i.cypher).join('\n');
  assert.ok(!allCyphers.includes('LOOKUP'));
});

test('analysis counts come from the report statements when available', async () => {
  const { window: w } = await loadPage();
  const dbBytes = await buildHcDb({ modelJson: specModel(), createStatements: STATEMENTS });
  await w.handleFile(binFile('hc.db', dbBytes));
  const a = w.analyzeModel();
  assert.equal(a.indexCount, 1);       // org_duns (LOOKUPs filtered)
  assert.equal(a.constraintCount, 1);  // org_key
});

test('a Health Check zip with hc.db at the root is accepted', async () => {
  const { window: w, document: doc } = await loadPage();
  const dbBytes = await buildHcDb({ modelJson: specModel(), createStatements: STATEMENTS });
  const zipBytes = await buildZip({ 'hc.db': dbBytes });
  await w.handleFile(binFile('report.zip', zipBytes));
  assert.equal(doc.getElementById('s1ok').textContent, '✅');
});

test('a zip with hc.db in a nested directory is accepted', async () => {
  const { window: w, document: doc } = await loadPage();
  const dbBytes = await buildHcDb({ modelJson: specModel() });
  const zipBytes = await buildZip({ 'some/nested/dir/hc.db': dbBytes, 'other.txt': 'hello' });
  await w.handleFile(binFile('report.zip', zipBytes));
  assert.equal(doc.getElementById('s1ok').textContent, '✅');
});

test('a zip without hc.db reports an error', async () => {
  const { window: w, document: doc } = await loadPage();
  const zipBytes = await buildZip({ 'readme.txt': 'nothing here' });
  await w.handleFile(binFile('report.zip', zipBytes));
  assert.ok(doc.getElementById('fileStatus').classList.contains('bad'));
  assert.ok(doc.getElementById('fileStatus').textContent.includes('Could not find hc.db'));
});

test('an hc.db without model_json reports a helpful error', async () => {
  const { window: w, document: doc } = await loadPage();
  const SQL = await require('../helpers/page').getSQL();
  const db = new SQL.Database();
  db.run('CREATE TABLE global_vars (key TEXT, value TEXT)');
  db.run('CREATE TABLE db_vars (key TEXT, value TEXT)');
  const bytes = db.export();
  db.close();
  await w.handleFile(binFile('hc.db', bytes));
  assert.ok(doc.getElementById('fileStatus').classList.contains('bad'));
  assert.ok(doc.getElementById('fileStatus').textContent.includes('No model_json found'));
});

test('missing create statements fall back to model-derived indexes/constraints', async () => {
  const { window: w } = await loadPage();
  const dbBytes = await buildHcDb({ modelJson: specModel(), createStatements: null });
  await w.handleFile(binFile('hc.db', dbBytes));
  const tree = readTree(w);
  assert.ok(tree['Indexes'].some(i => i.cypher.includes('(n:Organisation) ON (n.duns_nbr)')));
  assert.ok(tree['Constraints'].some(i => i.cypher.includes('(n:City) REQUIRE n.name IS NOT NULL')));
});
