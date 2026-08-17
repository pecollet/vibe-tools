'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, dropModel, setScale, connect, readTree, stubNeo4j } = require('../helpers/page');
const { specModel } = require('../helpers/fixtures');

test('scaleFactor and scaled follow the slider (0-200%, default 100%)', async () => {
  const { window: w, document: doc } = await loadPage();
  assert.equal(doc.getElementById('scaleSlider').value, '100');
  assert.equal(w.scaleFactor(), 1);
  assert.equal(w.scaled(100000), 100000);
  setScale(w, 50);
  assert.equal(w.scaleFactor(), 0.5);
  assert.equal(w.scaled(100000), 50000);
  assert.equal(doc.getElementById('scaleReadout').textContent, '50% (×0.50)');
  setScale(w, 200);
  assert.equal(w.scaled(100000), 200000);
  setScale(w, 0);
  assert.equal(w.scaled(100000), 0);
});

test('scaled treats null/undefined counts as 0', async () => {
  const { window: w } = await loadPage();
  assert.equal(w.scaled(null), 0);
  assert.equal(w.scaled(undefined), 0);
});

test('the details tree contains all four groups with the expected items', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const tree = readTree(w);
  assert.deepEqual(Object.keys(tree), ['Constraints', 'Indexes', 'Nodes', 'Relationships']);
  // a synthetic_id key constraint per node label + 2 existence constraints from the model
  assert.equal(tree['Constraints'].filter(i => i.name.startsWith('synthetic_id key')).length, 7);
  assert.equal(tree['Nodes'].length, 7);
  // LOVES splits into 2 unambiguous queries; SHARES_HELD_BY + LIVES_IN give 1 item each
  assert.equal(tree['Relationships'].length, 4);
});

test('items with zero or missing counts are unchecked by default', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const tree = readTree(w);
  const byName = Object.fromEntries(tree['Nodes'].map(i => [i.name, i]));
  assert.equal(byName['Organisation'].checked, true);
  assert.equal(byName['Animal'].checked, false);          // count 0
  assert.equal(byName['Resolved_Entity'].checked, false); // count null
  const shares = tree['Relationships'].find(i => i.name.startsWith('SHARES_HELD_BY'));
  assert.equal(shares.checked, false);                    // count null
});

test('changing the scale regenerates non-edited queries and updates counts', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  setScale(w, 50);
  const tree = readTree(w);
  const org = tree['Nodes'].find(i => i.name === 'Organisation');
  assert.equal(org.meta, '50,000 nodes');
  assert.ok(org.cypher.includes('UNWIND range(1, 50000) AS i'));
});

test('user-edited queries are preserved when the scale changes', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const ta = [...w.document.querySelectorAll('.tree-item textarea')]
    .find(t => t.value.includes('MERGE (n:Organisation'));
  ta.value = '// my custom query';
  ta.dispatchEvent(new w.Event('input'));
  setScale(w, 50);
  assert.equal(ta.value, '// my custom query');
  assert.ok(ta.classList.contains('edited'));
  // other items still regenerate
  const resident = readTree(w)['Nodes'].find(i => i.name === 'Resident');
  assert.ok(resident.cypher.includes('range(1, 3)') || resident.cypher.includes('range(1, 2)'));
});

test('the reset button appears on edit and restores the generated query', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const ta = [...w.document.querySelectorAll('.tree-item textarea')]
    .find(t => t.value.includes('MERGE (n:Organisation'));
  const generated = ta.value;
  const resetBtn = ta.parentElement.querySelector('.reset-btn');
  assert.ok(!resetBtn.classList.contains('visible'), 'reset button hidden before any edit');

  ta.value = '// my custom query';
  ta.dispatchEvent(new w.Event('input'));
  assert.ok(resetBtn.classList.contains('visible'), 'reset button shown after edit');

  resetBtn.click();
  assert.equal(ta.value, generated);
  assert.ok(!ta.classList.contains('edited'), 'orange border cleared after reset');
  assert.ok(!resetBtn.classList.contains('visible'), 'reset button hidden after reset');
});

test('reset regenerates at the current scale and re-enables scale updates', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const ta = [...w.document.querySelectorAll('.tree-item textarea')]
    .find(t => t.value.includes('MERGE (n:Organisation'));
  ta.value = '// my custom query';
  ta.dispatchEvent(new w.Event('input'));

  // reset while the slider is at 50% -> regenerated with the scaled count
  setScale(w, 50);
  ta.parentElement.querySelector('.reset-btn').click();
  assert.ok(ta.value.includes('UNWIND range(1, 50000) AS i'));

  // after reset, the item follows scale changes again
  setScale(w, 200);
  assert.ok(ta.value.includes('UNWIND range(1, 200000) AS i'));
});

test('reset restores the original text of static items (constraints/indexes)', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const ta = [...w.document.querySelectorAll('.tree-item textarea')]
    .find(t => t.value.includes('REQUIRE n.synthetic_id IS NODE KEY'));
  const original = ta.value;
  ta.value = 'DROP EVERYTHING';
  ta.dispatchEvent(new w.Event('input'));
  ta.parentElement.querySelector('.reset-btn').click();
  assert.equal(ta.value, original);
});

test('the group checkbox toggles all child items', async () => {
  const { window: w } = await loadPage();
  await dropModel(w, specModel());
  const nodesGroup = [...w.document.querySelectorAll('details.tree-group')]
    .find(g => g.querySelector('summary').textContent.includes('Nodes'));
  const groupCb = nodesGroup.querySelector('summary input[type=checkbox]');
  groupCb.checked = false;
  groupCb.dispatchEvent(new w.Event('change'));
  const items = [...nodesGroup.querySelectorAll('.tree-item input[type=checkbox]')];
  assert.ok(items.every(cb => !cb.checked));
  groupCb.checked = true;
  groupCb.dispatchEvent(new w.Event('change'));
  assert.ok(items.every(cb => cb.checked));
});

test('saved URL, user and database are loaded from local storage at startup', async () => {
  const { document: doc } = await loadPage({
    beforeParse(w) {
      w.localStorage.setItem('doppelgrapher.neo4jUrl', 'neo4j://saved:7687');
      w.localStorage.setItem('doppelgrapher.neo4jUser', 'saveduser');
      w.localStorage.setItem('doppelgrapher.neo4jDatabase', 'saveddb');
    }
  });
  assert.equal(doc.getElementById('neo4jUrl').value, 'neo4j://saved:7687');
  assert.equal(doc.getElementById('neo4jUser').value, 'saveduser');
  assert.equal(doc.getElementById('neo4jDatabase').value, 'saveddb');
});

test('successful connectivity check saves URL, user and database — but never the password', async () => {
  const { window: w } = await loadPage({ neo4j: stubNeo4j() });
  const status = await connect(w, { url: 'bolt://example:7687', user: 'u1', password: 'secret!', database: 'db1' });
  assert.ok(status.includes('Connected'));
  assert.ok(status.includes('database "db1"'));
  assert.equal(w.localStorage.getItem('doppelgrapher.neo4jUrl'), 'bolt://example:7687');
  assert.equal(w.localStorage.getItem('doppelgrapher.neo4jUser'), 'u1');
  assert.equal(w.localStorage.getItem('doppelgrapher.neo4jDatabase'), 'db1');
  for (let i = 0; i < w.localStorage.length; i++) {
    const key = w.localStorage.key(i);
    assert.ok(!w.localStorage.getItem(key).includes('secret!'), `password leaked into localStorage key ${key}`);
  }
});

test('failed connectivity check reports the error and keeps section 3 locked', async () => {
  const { window: w, document: doc } = await loadPage({ neo4j: stubNeo4j([], { failConnect: true }) });
  const status = await connect(w);
  assert.ok(status.includes('Connection failed'));
  assert.ok(doc.getElementById('section3').classList.contains('locked'));
});

test('successful connectivity check unlocks section 3', async () => {
  const { window: w, document: doc } = await loadPage({ neo4j: stubNeo4j() });
  await connect(w);
  assert.ok(!doc.getElementById('section3').classList.contains('locked'));
});

test('targetDatabase defaults to "neo4j" when the field is blank', async () => {
  const { window: w, document: doc } = await loadPage();
  doc.getElementById('neo4jDatabase').value = '   ';
  assert.equal(w.targetDatabase(), 'neo4j');
  doc.getElementById('neo4jDatabase').value = 'mydb';
  assert.equal(w.targetDatabase(), 'mydb');
});
