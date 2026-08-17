'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, dropModel, readTree } = require('../helpers/page');
const { specModel } = require('../helpers/fixtures');

function nodeCyphers(w) {
  return readTree(w)['Nodes'].map(i => i.cypher);
}
function relCyphers(w) {
  return readTree(w)['Relationships'].map(i => i.cypher).filter(c => c.includes('MERGE (s)-[r:'));
}

function saveSettings(w, { nodesBatch, relsBatch, nodesConcurrency } = {}) {
  const d = w.document;
  d.getElementById('btnSettings').click();
  if (nodesBatch !== undefined) d.getElementById('settingNodesBatch').value = String(nodesBatch);
  if (relsBatch !== undefined) d.getElementById('settingRelsBatch').value = String(relsBatch);
  if (nodesConcurrency !== undefined) d.getElementById('settingNodesConcurrency').value = String(nodesConcurrency);
  d.getElementById('btnSettingsSave').click();
}

test('default settings: 1000-row batches and no explicit concurrency', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  assert.ok(nodeCyphers(w).every(c => c.includes('} IN CONCURRENT TRANSACTIONS OF 1000 ROWS')));
  assert.ok(relCyphers(w).every(c => c.includes('} IN TRANSACTIONS OF 1000 ROWS')));
});

test('the settings button opens the popup with the current values, Cancel closes it unchanged', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const d = w.document;
  const overlay = d.getElementById('settingsOverlay');
  assert.ok(!overlay.classList.contains('open'));

  d.getElementById('btnSettings').click();
  assert.ok(overlay.classList.contains('open'));
  assert.equal(d.getElementById('settingNodesBatch').value, '1000');
  assert.equal(d.getElementById('settingRelsBatch').value, '1000');
  assert.equal(d.getElementById('settingNodesConcurrency').value, '');

  d.getElementById('settingNodesBatch').value = '77';
  d.getElementById('btnSettingsCancel').click();
  assert.ok(!overlay.classList.contains('open'));
  assert.ok(nodeCyphers(w).every(c => c.includes('OF 1000 ROWS')), 'Cancel must not apply changes');

  // reopening shows the (unchanged) saved values again
  d.getElementById('btnSettings').click();
  assert.equal(d.getElementById('settingNodesBatch').value, '1000');
});

test('saving batch sizes updates the TRANSACTIONS OF N ROWS parts of the generated queries', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  saveSettings(w, { nodesBatch: 500, relsBatch: 250 });
  assert.ok(!w.document.getElementById('settingsOverlay').classList.contains('open'), 'Save closes the popup');
  assert.ok(nodeCyphers(w).every(c => c.includes('} IN CONCURRENT TRANSACTIONS OF 500 ROWS')));
  assert.ok(relCyphers(w).every(c => c.includes('} IN TRANSACTIONS OF 250 ROWS')));
});

test('a nodes concurrency value is inserted into IN N CONCURRENT TRANSACTIONS (nodes only)', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  saveSettings(w, { nodesConcurrency: 4 });
  assert.ok(nodeCyphers(w).every(c => c.includes('} IN 4 CONCURRENT TRANSACTIONS OF 1000 ROWS')));
  assert.ok(relCyphers(w).every(c => c.includes('} IN TRANSACTIONS OF 1000 ROWS')));

  // clearing it goes back to the server default
  saveSettings(w, { nodesConcurrency: '' });
  assert.ok(nodeCyphers(w).every(c => c.includes('} IN CONCURRENT TRANSACTIONS OF 1000 ROWS')));
});

test('saving settings preserves user-edited queries', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const ta = [...w.document.querySelectorAll('.tree-item textarea')]
    .find(t => t.value.includes('MERGE (n:Organisation'));
  ta.value = '// my edited query';
  ta.dispatchEvent(new w.Event('input'));
  saveSettings(w, { nodesBatch: 500 });
  assert.equal(ta.value, '// my edited query');
  // non-edited node queries were regenerated
  assert.ok(nodeCyphers(w).some(c => c.includes('OF 500 ROWS')));
});

test('invalid or empty batch sizes fall back to the 1000 default', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  saveSettings(w, { nodesBatch: '', relsBatch: '-5' });
  assert.ok(nodeCyphers(w).every(c => c.includes('OF 1000 ROWS')));
  assert.ok(relCyphers(w).every(c => c.includes('OF 1000 ROWS')));
});
