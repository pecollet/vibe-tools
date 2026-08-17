'use strict';

const JSZip = require('jszip');
const { getSQL } = require('./page');

// The model_json example from the specification document.
const SPEC_MODEL = {
  nodeLabels: {
    Resolved_Entity: {
      provenance: 'query logs',
      properties: [{ key: 'synthetic_id', type: 'UNKNOWN', indexTypes: [], constraintTypes: [], indexed: false }],
      label: 'Resolved_Entity', impliedLabels: [], count: null
    },
    Organisation: {
      provenance: 'both',
      properties: [
        { key: 'del_indc', type: 'String', indexTypes: [], constraintTypes: [], indexed: false },
        { key: 'synthetic_id', type: 'String', indexTypes: ['RANGE'], constraintTypes: [], indexed: true },
        { key: 'duns_nbr', type: 'UNKNOWN', indexTypes: ['RANGE'], constraintTypes: [], indexed: true },
        { key: 'nme', type: 'String', indexTypes: [], constraintTypes: [], indexed: false }
      ],
      label: 'Organisation', impliedLabels: [], count: 100000
    },
    Animal: { provenance: 'both', properties: [], label: 'Animal', impliedLabels: [], count: 0 },
    Resident: {
      provenance: 'both',
      properties: [{ key: 'name', type: 'String', indexTypes: [], constraintTypes: [], indexed: false }],
      label: 'Resident', impliedLabels: [], count: 5
    },
    City: {
      provenance: 'both',
      properties: [
        { key: 'population', type: 'Number', indexTypes: [], constraintTypes: ['PropertyType'], indexed: false },
        { key: 'name', type: 'String', indexTypes: [], constraintTypes: ['PropertyType', 'Existence'], indexed: false }
      ],
      label: 'City', impliedLabels: [], count: 4
    },
    Person: {
      provenance: 'both',
      properties: [{ key: 'name', type: 'String', indexTypes: [], constraintTypes: ['Existence', 'PropertyType'], indexed: false }],
      label: 'Person', impliedLabels: ['Resident'], count: 5
    },
    Pet: {
      provenance: 'both',
      properties: [
        { key: 'name', type: 'String', indexTypes: [], constraintTypes: ['PropertyType'], indexed: false },
        { key: 'healthCertificate', type: 'String', indexTypes: [], constraintTypes: ['PropertyType'], indexed: false }
      ],
      label: 'Pet', impliedLabels: ['Resident', 'Animal'], count: 0
    }
  },
  relationshipTypes: {
    SHARES_HELD_BY: {
      provenance: 'query logs', properties: [], type: 'SHARES_HELD_BY',
      sourceNodeLabels: ['Organisation'], targetNodeLabels: ['Resolved_Entity'], undirectedNodeLabels: [],
      constrainedSourceNodeLabels: [], constrainedTargetNodeLabels: [],
      count: null, sourceLabelCounts: [], targetLabelCounts: []
    },
    LOVES: {
      provenance: 'both', properties: [], type: 'LOVES',
      sourceNodeLabels: ['Resident', 'Person'], targetNodeLabels: ['City'], undirectedNodeLabels: [],
      constrainedSourceNodeLabels: [], constrainedTargetNodeLabels: [],
      count: 1,
      sourceLabelCounts: [{ label: 'Resident', count: 1 }, { label: 'Person', count: 1 }],
      targetLabelCounts: [{ label: 'City', count: 1 }]
    },
    LIVES_IN: {
      provenance: 'both',
      properties: [{ key: 'since', type: 'Date', indexTypes: [], constraintTypes: ['PropertyType', 'Existence'], indexed: false }],
      type: 'LIVES_IN',
      sourceNodeLabels: ['Resident', 'Person'], targetNodeLabels: ['City'], undirectedNodeLabels: [],
      constrainedSourceNodeLabels: ['Resident'], constrainedTargetNodeLabels: ['City'],
      count: 0, sourceLabelCounts: [], targetLabelCounts: []
    }
  }
};

function specModel() {
  return JSON.parse(JSON.stringify(SPEC_MODEL));
}

/** Spec model + an ambiguous n-n relationship type (several sources AND several targets). */
function ambiguousModel() {
  const m = specModel();
  m.relationshipTypes.AMBIG = {
    provenance: 'both', properties: [], type: 'AMBIG',
    sourceNodeLabels: ['Organisation', 'Person'], targetNodeLabels: ['City', 'Resident'], undirectedNodeLabels: [],
    constrainedSourceNodeLabels: [], constrainedTargetNodeLabels: [],
    count: 1000,
    sourceLabelCounts: [{ label: 'Organisation', count: 800 }, { label: 'Person', count: 200 }],
    targetLabelCounts: [{ label: 'City', count: 300 }, { label: 'Resident', count: 700 }]
  };
  return m;
}

/** Small model for the real-database ingestion test (all query shapes, fast to load). */
function smallDbModel() {
  return {
    nodeLabels: {
      Organisation: {
        provenance: 'both',
        properties: [
          { key: 'nme', type: 'String', indexTypes: [], constraintTypes: [], indexed: false },
          { key: 'duns_nbr', type: 'String', indexTypes: ['RANGE'], constraintTypes: [], indexed: true, estimatedUniqueSize: 20 }
        ],
        label: 'Organisation', impliedLabels: [], count: 200
      },
      Resident: {
        provenance: 'both',
        properties: [{ key: 'name', type: 'String', indexTypes: [], constraintTypes: [], indexed: false }],
        label: 'Resident', impliedLabels: [], count: 50
      },
      City: {
        provenance: 'both',
        properties: [
          { key: 'population', type: 'Number', indexTypes: [], constraintTypes: ['PropertyType'], indexed: false },
          { key: 'name', type: 'String', indexTypes: [], constraintTypes: ['PropertyType', 'Existence'], indexed: false }
        ],
        label: 'City', impliedLabels: [], count: 10
      },
      Person: {
        provenance: 'both',
        properties: [{ key: 'name', type: 'String', indexTypes: [], constraintTypes: ['Existence', 'PropertyType'], indexed: false }],
        label: 'Person', impliedLabels: [], count: 50
      },
      // implied label constraint (graph type node element type): every Robot is a Machine.
      // Robot is deliberately not a relationship endpoint: implied labels make
      // synthetic_id ambiguous across the overlapping labels.
      Robot: {
        provenance: 'both',
        properties: [{ key: 'serial', type: 'String', indexTypes: [], constraintTypes: [], indexed: false }],
        label: 'Robot', impliedLabels: ['Machine'], count: 20
      },
      Machine: { provenance: 'both', properties: [], label: 'Machine', impliedLabels: [], count: 0 }
    },
    relationshipTypes: {
      // 1-n: split into one query per source label
      LOVES: {
        provenance: 'both', properties: [], type: 'LOVES',
        sourceNodeLabels: ['Resident', 'Person'], targetNodeLabels: ['City'], undirectedNodeLabels: [],
        constrainedSourceNodeLabels: [], constrainedTargetNodeLabels: [],
        count: 40,
        sourceLabelCounts: [{ label: 'Resident', count: 10 }, { label: 'Person', count: 30 }],
        targetLabelCounts: [{ label: 'City', count: 40 }]
      },
      // 1-1 (via inferred label constraints), with a relationship property
      LIVES_IN: {
        provenance: 'both',
        properties: [{ key: 'since', type: 'Date', indexTypes: [], constraintTypes: ['PropertyType', 'Existence'], indexed: false }],
        type: 'LIVES_IN',
        sourceNodeLabels: ['Resident', 'Person'], targetNodeLabels: ['City'], undirectedNodeLabels: [],
        constrainedSourceNodeLabels: ['Resident'], constrainedTargetNodeLabels: ['City'],
        count: 30, sourceLabelCounts: [], targetLabelCounts: []
      },
      // ambiguous n-n: weighted random picks with dynamic labels
      WORKS_WITH: {
        provenance: 'both', properties: [], type: 'WORKS_WITH',
        sourceNodeLabels: ['Organisation', 'Person'], targetNodeLabels: ['Organisation', 'Resident'], undirectedNodeLabels: [],
        constrainedSourceNodeLabels: [], constrainedTargetNodeLabels: [],
        count: 100,
        sourceLabelCounts: [{ label: 'Organisation', count: 70 }, { label: 'Person', count: 30 }],
        targetLabelCounts: [{ label: 'Organisation', count: 60 }, { label: 'Resident', count: 40 }]
      }
    }
  };
}

/** Build an hc.db SQLite file (as Uint8Array) with the given model and create statements. */
async function buildHcDb({ modelJson, createStatements = null }) {
  const SQL = await getSQL();
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE global_vars (key TEXT, value TEXT)');
    db.run('CREATE TABLE db_vars (key TEXT, value TEXT)');
    db.run('INSERT INTO global_vars VALUES (?, ?)', ['model_json', JSON.stringify(modelJson)]);
    if (createStatements !== null) {
      db.run('INSERT INTO db_vars VALUES (?, ?)', ['indexes_create_statements', createStatements]);
    }
    return db.export();
  } finally {
    db.close();
  }
}

/** Wrap bytes into a zip (as Uint8Array) at the given internal path. */
async function buildZip(entries) {
  const zip = new JSZip();
  for (const [path, bytes] of Object.entries(entries)) zip.file(path, bytes);
  return await zip.generateAsync({ type: 'uint8array' });
}

module.exports = { specModel, ambiguousModel, smallDbModel, buildHcDb, buildZip };
