# vibe-tools tests

Tests for the single-page tools in this repo. Shared tooling (dependencies, npm scripts)
lives here at the `test/` root; each tool gets its own subdirectory (currently only
`doppelgrapher/`). Tests use Node's built-in test runner (`node:test`) and load the tools'
HTML pages into [jsdom](https://github.com/jsdom/jsdom) — the tools themselves are not modified.

## Running

```bash
cd test
npm install
npm test              # everything (unit + functional)
npm run test:unit
npm run test:functional
```

Requires Node.js 20+.

## Layout

```
test/
  doppelgrapher/
    helpers/       # jsdom page loader, model_json fixtures, hc.db / zip builders
    unit/          # unit tests for every function in doppelgrapher.html
    functional/    # end-to-end flows (stubbed driver + real Neo4j ingestion)
```

To add tests for another tool, create a sibling directory (e.g. `test/config_viewer/`)
with `*.test.js` files — `node --test` discovers them recursively, no script changes needed.

## The real-database functional test

`doppelgrapher/functional/neo4j-db.test.js` ingests a synthetic graph into a real Neo4j
database and asserts the written data. It picks its target in this order:

1. **Environment variables** — set `NEO4J_TEST_URI` (and optionally `NEO4J_TEST_USER`,
   `NEO4J_TEST_PASSWORD`, `NEO4J_TEST_DATABASE`) to use an existing database.
   The test writes data into it, so point it at a throwaway instance.
2. **Docker** — if no env vars are set and Docker is available, a temporary Neo4j
   Enterprise container is started via Testcontainers (`NEO4J_ACCEPT_LICENSE_AGREEMENT=eval`;
   override the image with `NEO4J_TEST_IMAGE`, default `neo4j:enterprise`).
   Enterprise is required because the tool creates NODE KEY constraints, and the
   generated Cypher uses Cypher 25 syntax (`LET`, dynamic labels), so the server must
   be 2025.06 or later.
3. Otherwise the test **skips** with a message.

All other tests run fully offline (npm-installed `sql.js`, `jszip` and a stubbed
`neo4j-driver` are injected in place of the CDN-loaded libraries).
