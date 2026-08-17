'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, dropModel, readTree, norm } = require('../helpers/page');
const { specModel } = require('../helpers/fixtures');

test('cypherPropertyType maps model types to Cypher property types', async () => {
  const { window: w } = await loadPage();
  assert.equal(w.cypherPropertyType('String'), 'STRING');
  assert.equal(w.cypherPropertyType('Boolean'), 'BOOLEAN');
  assert.equal(w.cypherPropertyType('Long'), 'INTEGER');
  assert.equal(w.cypherPropertyType('Number'), 'INTEGER');
  assert.equal(w.cypherPropertyType('Double'), 'FLOAT');
  assert.equal(w.cypherPropertyType('Date'), 'DATE');
  assert.equal(w.cypherPropertyType('DateTime'), 'ZONED DATETIME');
  assert.equal(w.cypherPropertyType('LocalDateTime'), 'LOCAL DATETIME');
  assert.equal(w.cypherPropertyType('Time'), 'ZONED TIME');
  assert.equal(w.cypherPropertyType('LocalTime'), 'LOCAL TIME');
  assert.equal(w.cypherPropertyType('Duration'), 'DURATION');
  assert.equal(w.cypherPropertyType('Point'), 'POINT');
  // unknown types cannot be constrained
  assert.equal(w.cypherPropertyType('UNKNOWN'), null);
  assert.equal(w.cypherPropertyType('?'), null);
  assert.equal(w.cypherPropertyType(''), null);
  assert.equal(w.cypherPropertyType(null), null);
});

test('buildGraphType creates node element types for implied labels and relationship element types for endpoint label constraints', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const gt = w.buildGraphType();
  assert.ok(gt.statement.startsWith('ALTER CURRENT GRAPH TYPE SET {'));
  // node element types embed the property type / existence constraints of their identifying label
  assert.ok(gt.statement.includes('(:Person => :Resident {name :: STRING NOT NULL})'), gt.statement);
  assert.ok(gt.statement.includes('(:Pet => :Resident&Animal {name :: STRING, healthCertificate :: STRING})'), gt.statement);
  // relationship element type with source/target labels and its property constraints
  assert.ok(gt.statement.includes('(:Resident)-[:LIVES_IN => {since :: DATE NOT NULL}]->(:City)'), gt.statement);
  assert.deepEqual(norm(Array.from(gt.identifyingLabels).sort()), ['Person', 'Pet']);
  assert.deepEqual(norm(Array.from(gt.identifyingRelTypes)), ['LIVES_IN']);
});

test('buildGraphType returns no statement when there are no implied labels or endpoint constraints', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, {
    nodeLabels: {
      A: { properties: [], label: 'A', impliedLabels: [], count: 1 }
    },
    relationshipTypes: {
      T: {
        properties: [], type: 'T', sourceNodeLabels: ['A'], targetNodeLabels: ['A'],
        constrainedSourceNodeLabels: [], constrainedTargetNodeLabels: [],
        count: 1, sourceLabelCounts: [], targetLabelCounts: []
      }
    }
  });
  const gt = w.buildGraphType();
  assert.equal(gt.statement, null);
  assert.equal(gt.identifyingLabels.size, 0);
  assert.equal(gt.identifyingRelTypes.size, 0);
});

test('relationship element types omit unconstrained endpoints', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, {
    nodeLabels: { A: { properties: [], label: 'A', impliedLabels: [], count: 1 } },
    relationshipTypes: {
      ONLY_SRC: {
        properties: [], type: 'ONLY_SRC', sourceNodeLabels: ['A'], targetNodeLabels: ['A'],
        constrainedSourceNodeLabels: ['A'], constrainedTargetNodeLabels: [],
        count: 1, sourceLabelCounts: [], targetLabelCounts: []
      }
    }
  });
  const gt = w.buildGraphType();
  assert.ok(gt.statement.includes('(:A)-[:ONLY_SRC =>]->()'), gt.statement);
});

test('an existence-constrained property with unknown type becomes ANY NOT NULL in element types', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, {
    nodeLabels: {
      A: {
        properties: [{ key: 'p', type: 'UNKNOWN', indexTypes: [], constraintTypes: ['Existence'] }],
        label: 'A', impliedLabels: ['B'], count: 1
      },
      B: { properties: [], label: 'B', impliedLabels: [], count: 0 }
    },
    relationshipTypes: {}
  });
  const gt = w.buildGraphType();
  assert.ok(gt.statement.includes('(:A => :B {p :: ANY NOT NULL})'), gt.statement);
});

test('propertyTypeStatements generates IS :: constraints, excluding graph type identifying labels/types', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const gt = w.buildGraphType();
  const stmts = w.propertyTypeStatements(gt.identifyingLabels, gt.identifyingRelTypes);
  // City is not identifying -> standalone property type constraints
  assert.deepEqual(norm(stmts).sort(), [
    'CREATE CONSTRAINT IF NOT EXISTS FOR (n:City) REQUIRE n.name IS :: STRING',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (n:City) REQUIRE n.population IS :: INTEGER'
  ].sort());
  // Person/Pet (identifying labels) and LIVES_IN (identifying rel type) are covered
  // by the graph type element types and must not be duplicated
  const all = w.propertyTypeStatements();
  assert.ok(norm(all).some(s => s.includes('(n:Person) REQUIRE n.name IS :: STRING')));
  assert.ok(norm(all).some(s => s.includes('()-[r:LIVES_IN]-() REQUIRE r.since IS :: DATE')));
});

test('the graph type is the first item of the Constraints group in the details tree', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const constraints = readTree(w)['Constraints'];
  const first = constraints[0];
  assert.equal(first.name, 'graph type');
  assert.ok(first.cypher.startsWith('ALTER CURRENT GRAPH TYPE SET {'));
  assert.ok(first.checked);
  // property type constraints appear as their own items
  const ptItems = constraints.filter(i => i.name.startsWith('property type'));
  assert.equal(ptItems.length, 2);
  assert.ok(ptItems.every(i => i.cypher.includes('IS :: ')));
});
