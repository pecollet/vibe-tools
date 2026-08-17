'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, dropModel, norm } = require('../helpers/page');
const { specModel } = require('../helpers/fixtures');

test('statementsFromModel derives constraints and indexes from property metadata', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const { constraints, indexes } = w.statementsFromModel();
  // Existence constraints for City.name and Person.name; PropertyType constraints skipped
  assert.deepEqual(norm(constraints).sort(), [
    'CREATE CONSTRAINT IF NOT EXISTS FOR (n:City) REQUIRE n.name IS NOT NULL',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Person) REQUIRE n.name IS NOT NULL'
  ].sort());
  // synthetic_id indexes are skipped; only Organisation.duns_nbr remains
  assert.deepEqual(norm(indexes), ['CREATE INDEX IF NOT EXISTS FOR (n:Organisation) ON (n.duns_nbr)']);
});

test('statementsFromModel maps constraint types to NODE KEY / UNIQUE / NOT NULL', async () => {
  const { window: w } = await loadPage();
  const m = {
    nodeLabels: {
      L: {
        properties: [
          { key: 'k1', type: 'String', indexTypes: [], constraintTypes: ['NodeKey'] },
          { key: 'k2', type: 'String', indexTypes: [], constraintTypes: ['Uniqueness'] },
          { key: 'k3', type: 'String', indexTypes: [], constraintTypes: ['Existence'] },
          { key: 'k4', type: 'String', indexTypes: [], constraintTypes: ['PropertyType'] }
        ],
        label: 'L', impliedLabels: [], count: 1
      }
    },
    relationshipTypes: {}
  };
  await dropModel(w, m);
  const { constraints } = w.statementsFromModel();
  assert.ok(constraints.includes('CREATE CONSTRAINT IF NOT EXISTS FOR (n:L) REQUIRE n.k1 IS NODE KEY'));
  assert.ok(constraints.includes('CREATE CONSTRAINT IF NOT EXISTS FOR (n:L) REQUIRE n.k2 IS UNIQUE'));
  assert.ok(constraints.includes('CREATE CONSTRAINT IF NOT EXISTS FOR (n:L) REQUIRE n.k3 IS NOT NULL'));
  assert.ok(!constraints.some(s => s.includes('k4')), 'PropertyType constraints must be skipped');
});

test('statementsFromModel maps index types, including relationship property indexes', async () => {
  const { window: w } = await loadPage();
  const m = {
    nodeLabels: {
      L: {
        properties: [
          { key: 'r', type: 'String', indexTypes: ['RANGE'], constraintTypes: [] },
          { key: 't', type: 'String', indexTypes: ['TEXT'], constraintTypes: [] },
          { key: 'p', type: 'Point', indexTypes: ['POINT'], constraintTypes: [] },
          { key: 'f', type: 'String', indexTypes: ['FULLTEXT'], constraintTypes: [] }
        ],
        label: 'L', impliedLabels: [], count: 1
      }
    },
    relationshipTypes: {
      REL: {
        properties: [{ key: 'w', type: 'String', indexTypes: ['RANGE'], constraintTypes: [] }],
        type: 'REL', sourceNodeLabels: ['L'], targetNodeLabels: ['L'],
        constrainedSourceNodeLabels: [], constrainedTargetNodeLabels: [],
        count: 1, sourceLabelCounts: [], targetLabelCounts: []
      }
    }
  };
  await dropModel(w, m);
  const { indexes } = w.statementsFromModel();
  assert.ok(indexes.includes('CREATE INDEX IF NOT EXISTS FOR (n:L) ON (n.r)'));
  assert.ok(indexes.includes('CREATE TEXT INDEX IF NOT EXISTS FOR (n:L) ON (n.t)'));
  assert.ok(indexes.includes('CREATE POINT INDEX IF NOT EXISTS FOR (n:L) ON (n.p)'));
  assert.ok(indexes.some(s => s.startsWith('CREATE FULLTEXT INDEX') && s.includes('ON EACH [n.f]')));
  assert.ok(indexes.includes('CREATE INDEX IF NOT EXISTS FOR ()-[r:REL]-() ON (r.w)'));
});

test('statementsFromModel deduplicates identical statements', async () => {
  const { window: w } = await loadPage();
  const prop = { key: 'k', type: 'String', indexTypes: ['RANGE', 'RANGE'], constraintTypes: [] };
  await dropModel(w, { nodeLabels: { L: { properties: [prop], label: 'L', impliedLabels: [], count: 1 } }, relationshipTypes: {} });
  const { indexes } = w.statementsFromModel();
  assert.equal(indexes.length, 1);
});
