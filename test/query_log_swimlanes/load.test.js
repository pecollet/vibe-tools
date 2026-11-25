'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  loadPage,
  snippet,
  timestampCount,
  dropText,
  logFile,
  flush,
  laneLabels,
} = require('./helpers/page');

const LOG = snippet();
const EXPECTED = timestampCount(LOG);

test('dropping a query.log excerpt plots one lane per completed query', async () => {
  const { window: w, document: doc, plots } = loadPage();
  assert.equal(doc.getElementById('fileCount').textContent, '0');
  assert.match(doc.getElementById('chart').textContent, /No intervals parsed yet/);

  await dropText(w, LOG);

  assert.equal(doc.getElementById('fileCount').textContent, '1');
  assert.equal(doc.getElementById('intervalCount').textContent, String(EXPECTED));
  assert.ok(EXPECTED >= 4, 'fixture should contain several timestamped queries');
  const labels = laneLabels(plots);
  assert.equal(labels.length, EXPECTED);
  assert.ok(labels.some(label => label.includes('AccessGroup')), labels.join('\n'));
  const durations = Array.from(plots.at(-1).data[0].x);
  assert.ok(durations.some(ms => ms > 0), 'elapsed time should set a non-zero bar');
});

test('a non-extensible file object still loads', async () => {
  const { window: w, document: doc, plots } = loadPage();
  const frozen = Object.freeze({
    name: 'query.log.004',
    text: async () => LOG,
  });
  const drop = doc.getElementById('drop');
  const event = new w.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [frozen] } });
  drop.dispatchEvent(event);
  await flush();

  assert.equal(doc.getElementById('fileCount').textContent, '1');
  assert.equal(laneLabels(plots).length, EXPECTED);
  assert.doesNotMatch(doc.getElementById('chart').textContent, /not extensible|Cannot add property/i);
});

test('a saved filter is not applied on its own, so a new file stays visible', async () => {
  const { document: doc, plots } = loadPage({
    beforeParse(window) {
      window.localStorage.setItem(
        'query-log-swimlanes.filterHistory',
        JSON.stringify(['this-will-not-match-zzz'])
      );
    },
  });
  assert.equal(doc.getElementById('cypherFilter').value, '');
  const option = doc.querySelector('#filterHistory option');
  assert.equal(option && option.value, 'this-will-not-match-zzz');

  await dropText(doc.defaultView, LOG);
  assert.equal(doc.getElementById('intervalCount').textContent, String(EXPECTED));
  assert.equal(laneLabels(plots).length, EXPECTED);
});

test('the file input snapshots the selection before the control is cleared', async () => {
  const { window: w, document: doc, plots } = loadPage();
  const input = doc.getElementById('fileInput');
  const file = logFile(LOG);
  let reads = 0;
  const live = {
    length: 1,
    0: file,
    [Symbol.iterator]: function* () {
      if (reads++) return;
      yield file;
    },
  };
  Object.defineProperty(input, 'files', { configurable: true, get: () => live });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await flush();

  assert.equal(input.value, '');
  assert.equal(doc.getElementById('fileCount').textContent, '1');
  assert.equal(laneLabels(plots).length, EXPECTED);
});

test('a resize relayout does not drop lanes that were just loaded', async () => {
  const { window: w, document: doc, plots } = loadPage();
  await dropText(w, LOG);
  assert.equal(plots.length, 1);

  doc.getElementById('chart').emit('plotly_relayout', {
    autosize: true,
    'xaxis.range[0]': '2020-01-01 00:00:00',
    'xaxis.range[1]': '2020-01-01 00:00:01',
  });
  await flush();

  assert.equal(plots.length, 1);
  assert.equal(laneLabels(plots).length, EXPECTED);
  assert.equal(doc.getElementById('intervalCount').textContent, String(EXPECTED));
});

test('zooming the time axis keeps only overlapping lanes and a later file load restores them', async () => {
  const { window: w, document: doc, plots } = loadPage();
  await dropText(w, LOG);
  const chart = doc.getElementById('chart');

  chart.emit('plotly_relayout', {
    'xaxis.range[0]': '2026-11-24 08:00:00',
    'xaxis.range[1]': '2026-11-24 08:01:00',
  });
  await flush();

  assert.equal(laneLabels(plots).length, 0);
  assert.match(chart.textContent, /No queries overlap/);
  assert.equal(doc.getElementById('intervalCount').textContent, `0 in view (${EXPECTED})`);

  chart.emit('plotly_relayout', { 'xaxis.autorange': true });
  await flush();
  assert.equal(laneLabels(plots).length, EXPECTED);
  assert.equal(doc.getElementById('intervalCount').textContent, String(EXPECTED));

  chart.emit('plotly_relayout', {
    'xaxis.range[0]': '2026-11-24 08:00:00',
    'xaxis.range[1]': '2026-11-24 08:01:00',
  });
  await flush();
  assert.equal(laneLabels(plots).length, 0);

  await dropText(w, LOG);
  assert.equal(doc.getElementById('fileCount').textContent, '2');
  assert.equal(laneLabels(plots).length, EXPECTED * 2);
  assert.equal(doc.getElementById('intervalCount').textContent, String(EXPECTED * 2));
});
