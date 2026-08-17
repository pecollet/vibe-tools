'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const JSZip = require('jszip');

const HTML_PATH = path.resolve(__dirname, '..', '..', '..', 'doppelgrapher.html');

let sqlPromise = null;
function getSQL() {
  if (!sqlPromise) sqlPromise = require('sql.js')();
  return sqlPromise;
}

/**
 * Load doppelgrapher.html into jsdom. The page's CDN loaders (`ensureLib`,
 * `initSqlJsOnce`) return early when the corresponding global is already set,
 * so we inject the npm versions of JSZip and sql.js and tests run fully offline.
 *
 * options.beforeParse(window): runs before the page's scripts (e.g. to seed localStorage).
 * options.neo4j: object to expose as window.neo4j (stub or the real neo4j-driver module).
 */
async function loadPage(options = {}) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const virtualConsole = new VirtualConsole();          // silence page console noise
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.JSZip = JSZip;
      if (options.neo4j) window.neo4j = options.neo4j;
      if (options.beforeParse) options.beforeParse(window);
    }
  });
  const { window } = dom;
  window.__sqljs = await getSQL();                       // bypass sql.js CDN download
  return { dom, window, document: window.document };
}

// --- fake File objects (handleFile only uses name/size/text/arrayBuffer) ---

function jsonFile(modelObj, name = 'model.json') {
  const text = JSON.stringify(modelObj);
  return { name, size: text.length, text: async () => text };
}

function rawJsonFile(text, name = 'model.json') {
  return { name, size: text.length, text: async () => text };
}

function binFile(name, bytes) {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

/**
 * Normalize a value coming out of the jsdom VM for deep-equality assertions:
 * arrays/objects created in the page's realm have foreign prototypes, which
 * assert.deepStrictEqual rejects even when the contents are identical.
 */
function norm(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// --- UI interaction helpers ---

async function waitFor(fn, { timeout = 10000, interval = 20, message = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${message}`);
}

async function dropModel(window, modelObj) {
  await window.handleFile(jsonFile(modelObj));
}

function setScale(window, percent) {
  const slider = window.document.getElementById('scaleSlider');
  slider.value = String(percent);
  slider.dispatchEvent(new window.Event('input'));
}

async function connect(window, { url = 'bolt://stub:7687', user = 'neo4j', password = 'pw', database = 'neo4j' } = {}) {
  const doc = window.document;
  doc.getElementById('neo4jUrl').value = url;
  doc.getElementById('neo4jUser').value = user;
  doc.getElementById('neo4jPassword').value = password;
  doc.getElementById('neo4jDatabase').value = database;
  doc.getElementById('btnConnect').click();
  await waitFor(
    () => doc.getElementById('s2ok').textContent === '✅'
      || doc.getElementById('connStatus').classList.contains('bad'),
    { message: 'connectivity check to finish' }
  );
  return doc.getElementById('connStatus').textContent;
}

async function ingestAndWait(window, { timeout = 30000 } = {}) {
  const doc = window.document;
  doc.getElementById('btnIngest').click();
  await waitFor(
    () => doc.getElementById('ingestSummary').textContent.trim() !== '',
    { timeout, message: 'ingestion to finish' }
  );
  return doc.getElementById('ingestSummary').textContent;
}

/** Collect the details tree as { GroupTitle: [{name, meta, checked, cypher}] }. */
function readTree(window) {
  const out = {};
  for (const group of window.document.querySelectorAll('details.tree-group')) {
    const title = group.querySelector('summary').textContent.trim().replace(/\s*\(\d+\)$/, '').trim();
    out[title] = [...group.querySelectorAll('.tree-item')].map(item => ({
      name: item.querySelector('.item-name').textContent,
      meta: item.querySelector('.item-meta').textContent,
      checked: item.querySelector('input[type=checkbox]').checked,
      cypher: item.querySelector('textarea').value
    }));
  }
  return out;
}

/**
 * A stub of the neo4j-driver browser global. Records every session.run() into
 * `record` as {cypher, database}. opts.failOn: substring that makes run() throw.
 * opts.failConnect: makes the connectivity check reject.
 */
function stubNeo4j(record = [], opts = {}) {
  const stub = {
    record,
    driverCalls: [],   // {url, config} for every driver() instantiation
    auth: { basic: (user, password) => ({ scheme: 'basic', user, password }) },
    driver: (url, auth, config) => (stub.driverCalls.push({ url, config }), {
      // driver 6.x API: getServerInfo() verifies connectivity and returns the details
      getServerInfo: async ({ database } = {}) => {
        if (opts.failConnect) throw new Error('stub connection refused');
        return { address: 'stub:7687', agent: 'Neo4j/stub', protocolVersion: { major: 6, minor: 1 } };
      },
      close: async () => {},
      session: ({ database } = {}) => ({
        run: async (cypher) => {
          if (opts.failOn && cypher.includes(opts.failOn)) throw new Error(`stub failure on: ${opts.failOn}`);
          record.push({ cypher, database });
          return { records: [] };
        },
        close: async () => {}
      })
    })
  };
  return stub;
}

module.exports = {
  HTML_PATH, loadPage, getSQL, norm,
  jsonFile, rawJsonFile, binFile,
  waitFor, dropModel, setScale, connect, ingestAndWait, readTree, stubNeo4j
};
