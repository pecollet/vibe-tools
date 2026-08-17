'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, dropModel, norm } = require('../helpers/page');
const { specModel, ambiguousModel } = require('../helpers/fixtures');

test('effectiveLabels returns observed labels when no constraint exists', async () => {
  const { window: w } = await loadPage();
  const rel = { sourceNodeLabels: ['A', 'B'], targetNodeLabels: ['C'], constrainedSourceNodeLabels: [], constrainedTargetNodeLabels: [] };
  assert.deepEqual(w.effectiveLabels(rel, 'source'), ['A', 'B']);
  assert.deepEqual(w.effectiveLabels(rel, 'target'), ['C']);
});

test('effectiveLabels prefers inferred label constraints when present', async () => {
  const { window: w } = await loadPage();
  const rel = { sourceNodeLabels: ['A', 'B'], targetNodeLabels: ['C', 'D'], constrainedSourceNodeLabels: ['A'], constrainedTargetNodeLabels: [] };
  assert.deepEqual(w.effectiveLabels(rel, 'source'), ['A']);
  assert.deepEqual(w.effectiveLabels(rel, 'target'), ['C', 'D']);
});

test('effectiveLabels tolerates missing arrays', async () => {
  const { window: w } = await loadPage();
  assert.deepEqual(norm(w.effectiveLabels({}, 'source')), []);
});

test('analyzeModel computes summary statistics', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const a = w.analyzeModel();
  assert.equal(a.labels.length, 7);
  assert.equal(a.relTypes.length, 3);
  assert.equal(a.totalNodes, 100014);
  assert.equal(a.totalRels, 1);
  // derived from the model's property metadata (no hc.db statements for raw JSON input)
  assert.equal(a.indexCount, 2);       // Organisation synthetic_id + duns_nbr RANGE indexes
  assert.equal(a.constraintCount, 9);  // all constraintTypes entries across labels & rel types
});

test('analyzeModel warns about multi-labelled nodes via impliedLabels', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const a = w.analyzeModel();
  const warning = a.warnings.find(x => x.includes('Multi-labelled nodes'));
  assert.ok(warning, 'expected a multi-label warning');
  assert.ok(warning.includes(':Person also has [Resident]'));
  assert.ok(warning.includes(':Pet also has [Resident, Animal]'));
});

test('analyzeModel infers label overlap when per-label counts exceed the type count', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const a = w.analyzeModel();
  const warning = a.warnings.find(x => x.includes('Source labels of :LOVES likely overlap'));
  assert.ok(warning, 'expected an overlap warning for LOVES');
  assert.ok(warning.includes('Resident (1), Person (1)'));
});

test('analyzeModel warns about ambiguous n-n relationship types', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, ambiguousModel());
  const a = w.analyzeModel();
  const warning = a.warnings.find(x => x.includes('Ambiguous relationship types'));
  assert.ok(warning, 'expected an ambiguity warning');
  assert.ok(warning.includes(':AMBIG'));
});

test('analyzeModel does not flag LIVES_IN as ambiguous (inferred label constraint narrows it)', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const a = w.analyzeModel();
  const ambiguityWarning = a.warnings.find(x => x.includes('Ambiguous relationship types'));
  assert.equal(ambiguityWarning, undefined);
  assert.ok(a.infos.some(x => x.includes(':LIVES_IN') && x.includes('inferred label constraint')));
});

test('analyzeModel notes entities without counts (query-logs-only provenance)', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const a = w.analyzeModel();
  const note = a.infos.find(x => x.includes('No count available'));
  assert.ok(note, 'expected a null-count note');
  assert.ok(note.includes(':Resolved_Entity'));
  assert.ok(note.includes(':SHARES_HELD_BY'));
});

test('renderAnalysis displays summary pills and warnings in the page', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const zone = w.document.getElementById('analysisZone');
  const pills = [...zone.querySelectorAll('.pill')].map(p => p.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(pills.some(p => p.includes('Node labels') && p.includes('7')));
  assert.ok(pills.some(p => p.includes('Relationship types') && p.includes('3')));
  assert.ok(zone.querySelector('.warnbox'), 'expected a warnings box');
});
