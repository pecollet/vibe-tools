'use strict';

// Functional test: real end-to-end ingestion into a temporary Neo4j database,
// asserting the data actually written. Target resolution order:
//   1. NEO4J_TEST_URI (+ NEO4J_TEST_USER / NEO4J_TEST_PASSWORD / NEO4J_TEST_DATABASE)
//   2. a temporary Neo4j Enterprise container via Testcontainers (needs Docker;
//      Enterprise is required for NODE KEY constraints, the generated Cypher
//      uses Cypher 25 syntax, and graph types (ALTER CURRENT GRAPH TYPE)
//      require 2026.02+)
//   3. otherwise the test skips.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const { loadPage, dropModel, connect, ingestAndWait } = require('../helpers/page');
const { smallDbModel } = require('../helpers/fixtures');

const CONTAINER_PASSWORD = 'testpassword123';

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

async function resolveTarget() {
  if (process.env.NEO4J_TEST_URI) {
    return {
      uri: process.env.NEO4J_TEST_URI,
      user: process.env.NEO4J_TEST_USER || 'neo4j',
      password: process.env.NEO4J_TEST_PASSWORD || '',
      database: process.env.NEO4J_TEST_DATABASE || 'neo4j',
      external: true,
      stop: async () => {}
    };
  }
  if (!dockerAvailable()) return null;
  const { GenericContainer, Wait } = require('testcontainers');
  const image = process.env.NEO4J_TEST_IMAGE || 'neo4j:enterprise';
  const container = await new GenericContainer(image)
    .withEnvironment({
      NEO4J_AUTH: `neo4j/${CONTAINER_PASSWORD}`,
      NEO4J_ACCEPT_LICENSE_AGREEMENT: 'eval'
    })
    .withExposedPorts(7687)
    .withWaitStrategy(Wait.forLogMessage(/Started\./))
    .withStartupTimeout(240000)
    .start();
  return {
    uri: `bolt://${container.getHost()}:${container.getMappedPort(7687)}`,
    user: 'neo4j',
    password: CONTAINER_PASSWORD,
    database: null,   // created below, to prove the database-name field is honored
    external: false,
    stop: () => container.stop()
  };
}

test('ingests a synthetic graph into a real Neo4j and the written data matches the model', { timeout: 900000 }, async (t) => {
  const target = await resolveTarget();
  if (!target) {
    t.skip('No NEO4J_TEST_URI set and Docker is not available — skipping real-database test.');
    return;
  }

  const neo4j = require('neo4j-driver');
  const verifyDriver = neo4j.driver(target.uri, neo4j.auth.basic(target.user, target.password), { disableLosslessIntegers: true });

  try {
    // On a temporary container, ingest into a non-default database to verify
    // the "Database name" field is honored end to end.
    let database = target.database;
    if (!target.external) {
      database = 'doppeltest';
      const sys = verifyDriver.session({ database: 'system' });
      try { await sys.run(`CREATE DATABASE ${database} WAIT`); } finally { await sys.close(); }
    }

    const model = smallDbModel();
    const { window: w } = await loadPage({ neo4j });
    await dropModel(w, model);
    const connStatus = await connect(w, { url: target.uri, user: target.user, password: target.password, database });
    assert.ok(connStatus.includes('Connected'), `connectivity check failed: ${connStatus}`);

    const summary = await ingestAndWait(w, { timeout: 600000 });
    assert.ok(summary.includes('✅'), `ingestion did not succeed cleanly: ${summary}`);

    const session = verifyDriver.session({ database });
    const single = async (cypher) => {
      const res = await session.run(cypher);
      return res.records[0].get(0);
    };
    try {
      // --- node counts match the model exactly ---
      // A label's node count includes the nodes of labels that imply it.
      const expectedNodeCount = (label) => {
        let total = model.nodeLabels[label].count || 0;
        for (const [other, entity] of Object.entries(model.nodeLabels)) {
          if (other !== label && (entity.impliedLabels || []).includes(label)) total += entity.count || 0;
        }
        return total;
      };
      for (const label of Object.keys(model.nodeLabels)) {
        const count = await single(`MATCH (n:${label}) RETURN count(n)`);
        assert.equal(count, expectedNodeCount(label), `node count for :${label}`);
      }

      // --- implied label constraints honored: every Robot also carries :Machine ---
      const robotsWithoutMachine = await single('MATCH (n:Robot) WHERE NOT n:Machine RETURN count(n)');
      assert.equal(robotsWithoutMachine, 0);

      // --- synthetic_id covers 1..count with no gaps or duplicates ---
      const idStats = await session.run(
        'MATCH (n:Organisation) RETURN min(n.synthetic_id) AS mn, max(n.synthetic_id) AS mx, count(DISTINCT n.synthetic_id) AS dc'
      );
      const rec = idStats.records[0];
      assert.equal(rec.get('mn'), 1);
      assert.equal(rec.get('mx'), model.nodeLabels.Organisation.count);
      assert.equal(rec.get('dc'), model.nodeLabels.Organisation.count);

      // --- estimatedUniqueSize bounds the generated value set ---
      const distinctDuns = await single('MATCH (n:Organisation) RETURN count(DISTINCT n.duns_nbr)');
      assert.ok(distinctDuns > 0 && distinctDuns <= 20, `duns_nbr distinct values: ${distinctDuns}`);

      // --- relationship counts: MERGE dedupes random endpoint picks, so 0 < written <= requested ---
      for (const [type, rel] of Object.entries(model.relationshipTypes)) {
        const count = await single(`MATCH ()-[r:${type}]->() RETURN count(r)`);
        assert.ok(count > 0, `no :${type} relationships were written`);
        assert.ok(count <= rel.count, `:${type} count ${count} exceeds requested ${rel.count}`);
      }

      // --- endpoint labels respected ---
      const badLivesIn = await single(
        'MATCH (s)-[r:LIVES_IN]->(t) WHERE NOT s:Resident OR NOT t:City RETURN count(r)'
      );
      assert.equal(badLivesIn, 0);

      // --- relationship properties written with the right type ---
      const nullSince = await single('MATCH ()-[r:LIVES_IN]->() WHERE r.since IS NULL RETURN count(r)');
      assert.equal(nullSince, 0);
      const sinceIsDate = await single(
        'MATCH ()-[r:LIVES_IN]->() RETURN count(r) = count(CASE WHEN valueType(r.since) STARTS WITH "DATE" THEN 1 END)'
      );
      assert.equal(sinceIsDate, true);

      // --- synthetic_id NODE KEY constraints exist for every label ---
      const constraints = await session.run('SHOW CONSTRAINTS YIELD type, labelsOrTypes, properties RETURN *');
      const keyLabels = constraints.records
        .filter(r => r.get('type') === 'NODE_KEY' && (r.get('properties') || []).includes('synthetic_id'))
        .map(r => r.get('labelsOrTypes')[0]);
      for (const label of Object.keys(model.nodeLabels)) {
        assert.ok(keyLabels.includes(label), `missing synthetic_id NODE KEY constraint for :${label}`);
      }

      // --- graph type: relationship source/target label constraints exist ---
      const allCons = constraints.records.map(r => ({
        type: String(r.get('type')),
        lot: (r.get('labelsOrTypes') || [])[0],
        props: r.get('properties') || []
      }));
      assert.ok(allCons.some(c => c.lot === 'LIVES_IN' && /SOURCE/i.test(c.type)),
        'missing LIVES_IN relationship source label constraint (from graph type)');
      assert.ok(allCons.some(c => c.lot === 'LIVES_IN' && /TARGET/i.test(c.type)),
        'missing LIVES_IN relationship target label constraint (from graph type)');

      // --- property type constraints created for non-identifying labels ---
      assert.ok(allCons.some(c => c.lot === 'City' && /PROPERTY_TYPE/i.test(c.type) && c.props.includes('population')),
        'missing City.population property type constraint');
      assert.ok(allCons.some(c => c.lot === 'Person' && /PROPERTY_TYPE/i.test(c.type) && c.props.includes('name')),
        'missing Person.name property type constraint');

      // --- the index from the model was created ---
      const indexes = await session.run('SHOW INDEXES YIELD labelsOrTypes, properties RETURN *');
      assert.ok(
        indexes.records.some(r => (r.get('labelsOrTypes') || [])[0] === 'Organisation' && (r.get('properties') || []).includes('duns_nbr')),
        'missing index on :Organisation(duns_nbr)'
      );
    } finally {
      await session.close();
    }

    // --- the database-name field was honored: the default db stayed empty ---
    if (!target.external) {
      const defaultSession = verifyDriver.session({ database: 'neo4j' });
      try {
        const res = await defaultSession.run('MATCH (n) RETURN count(n)');
        assert.equal(res.records[0].get(0), 0, 'data leaked into the default database');
      } finally {
        await defaultSession.close();
      }
    }
  } finally {
    await verifyDriver.close();
    await target.stop();
  }
});
