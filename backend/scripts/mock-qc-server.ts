/**
 * DeployCenter — Mock QC REST server (local, throwaway test double)
 *
 * Simulates just enough of QC 11 / ALM's classic REST API surface to
 * exercise qc-rest.service.ts's client code end-to-end WITHOUT a real QC
 * connection: auth handshake, XML entity CRUD, the `{field['value']}` query
 * filter syntax, entity-fields metadata, and attachments.
 *
 * WHAT THIS CAN AND CANNOT TELL YOU (read before trusting a green run):
 *  - CAN catch bugs in OUR OWN code: wrong request shape, broken XML
 *    build/parse round-trip, wrong call order in an orchestration, a crash
 *    on an unexpected response shape, charset/encoding round-tripping
 *    correctly through our own axios + fast-xml-parser stack.
 *  - CANNOT tell you whether our ASSUMPTIONS about the real QC instance are
 *    correct — field names (user-01/02/03 etc.), entity type names
 *    (release-folder vs release-folders, requirement vs requirement-folder),
 *    whether `dev-comments` is actually a rich-text field that renders
 *    embedded <b> as bold, whether POST-create is even supported the way we
 *    assume. This mock is built from the SAME assumptions as the real
 *    client code, so by construction it can only ever confirm those
 *    assumptions, never contradict them. Only a real QC test can do that.
 *
 * Usage:
 *   npx ts-node scripts/mock-qc-server.ts
 *   (or set MOCK_QC_PORT to change the default port 3010)
 *
 * Then point DeployCenter at it (AdminPanel > System Params, dev/test env
 * only — never do this against a real environment):
 *   QC_REST_BASE_URL   = http://localhost:3010
 *   QC_REST_DOMAIN     = MOCK
 *   QC_REST_PROJECT    = MOCK
 *   QC_REST_BUG_STATUS_FIELD = user-04   (any name — this mock doesn't care)
 * ...and make sure your own User row has a qcLogin set to anything (e.g.
 * your own name) — the mock accepts any username with an empty password,
 * same as real QC's passwordless accounts. Username "fail401" is special-
 * cased to always return 401, to test that error path deliberately.
 *
 * State is in-memory only, reset on restart. GET /__mock__/dump returns
 * everything currently stored, for quick inspection while testing.
 */

import * as http from 'http';
import { XMLParser } from 'fast-xml-parser';

const PORT = Number(process.env.MOCK_QC_PORT || 3010);
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// ── In-memory store — generic across every entity type (defects, releases,
// release-cycles, release-folders, and later requirement-folders/
// requirements/test-folders/tests etc.) so adding a new QC module to test
// later needs no changes here. Keyed by collection path segment as it
// appears in the URL (e.g. "release-cycles").
type Entity = Record<string, string> & { id: string };
const collections = new Map<string, Map<string, Entity>>();
let nextId = 1000;

function collectionFor(name: string): Map<string, Entity> {
  if (!collections.has(name)) collections.set(name, new Map());
  return collections.get(name)!;
}

// ── XML building — mirrors exactly what qc-rest.service.ts's own parsers
// (parseFields / parseEntitiesListXml / parseEntityFieldsXml /
// parseAttachmentsXml) expect, since those are the real contract we're
// testing against.
function xmlEscape(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function entityXml(entityType: string, entity: Entity): string {
  const fields = Object.entries(entity)
    .map(([name, value]) => `<Field Name="${xmlEscape(name)}"><Value>${xmlEscape(value)}</Value></Field>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Entity Type="${xmlEscape(entityType)}"><Fields>${fields}</Fields></Entity>`;
}
function entitiesListXml(entityType: string, entities: Entity[]): string {
  const items = entities.map(e => {
    const fields = Object.entries(e).map(([name, value]) => `<Field Name="${xmlEscape(name)}"><Value>${xmlEscape(value)}</Value></Field>`).join('');
    return `<Entity Type="${xmlEscape(entityType)}"><Fields>${fields}</Fields></Entity>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Entities TotalResults="${entities.length}">${items}</Entities>`;
}
function attachmentsXml(): string {
  // Empty by default — no test asset behind this mock. Extend here if a
  // specific attachments-list scenario needs testing.
  return `<?xml version="1.0" encoding="UTF-8"?><Attachments></Attachments>`;
}

// Canned field metadata for probeEntityFields — enough shape to exercise
// parseEntityFieldsXml, not a claim about real QC's actual customization.
const ENTITY_FIELDS: Record<string, { name: string; label: string; type: string; required: boolean }[]> = {
  release: [
    { name: 'name', label: 'Release Name', type: 'string', required: true },
    { name: 'start-date', label: 'Start Date', type: 'date', required: false },
    { name: 'end-date', label: 'End Date', type: 'date', required: false },
    { name: 'parent-id', label: 'Release Folder', type: 'reference', required: false },
    { name: 'user-01', label: 'Release Type', type: 'string', required: false },
    { name: 'user-03', label: 'Production Date', type: 'date', required: false },
  ],
  'release-cycle': [
    { name: 'name', label: 'Cycle Name', type: 'string', required: true },
    { name: 'start-date', label: 'Start Date', type: 'date', required: false },
    { name: 'end-date', label: 'End Date', type: 'date', required: false },
    { name: 'parent-id', label: 'Release ID', type: 'reference', required: true },
    { name: 'user-01', label: 'QG Threshold High', type: 'string', required: false },
    { name: 'user-02', label: 'QG Threshold Medium', type: 'string', required: false },
    { name: 'user-03', label: 'QG Threshold Low', type: 'string', required: false },
  ],
  'requirement-folder': [
    { name: 'name', label: 'Folder Name', type: 'string', required: true },
    { name: 'parent-id', label: 'Parent Folder', type: 'reference', required: false },
  ],
  requirement: [
    { name: 'name', label: 'Requirement Name', type: 'string', required: true },
    { name: 'parent-id', label: 'Parent Folder', type: 'reference', required: true },
    { name: 'type-id', label: 'Requirement Type', type: 'string', required: true },
    { name: 'user-02', label: 'CR Number', type: 'string', required: false },
  ],
  defect: [
    { name: 'name', label: 'Summary', type: 'string', required: true },
    { name: 'status', label: 'Status', type: 'string', required: false },
    { name: 'dev-comments', label: 'Dev Comments', type: 'string', required: false },
  ],
};
function entityFieldsXml(entityType: string): string {
  const fields = ENTITY_FIELDS[entityType];
  if (!fields) return `<?xml version="1.0" encoding="UTF-8"?><Fields></Fields>`;
  const items = fields.map(f => `<Field Name="${f.name}" Label="${xmlEscape(f.label)}" Type="${f.type}" required="${f.required ? 'Y' : 'N'}"></Field>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Fields>${items}</Fields>`;
}

// ── Incoming XML parsing — same shape our own buildFieldsPayload /
// buildRequirementPayload produce. A reference-type field (target-rel etc.)
// has a ValueReferenceValue attribute alongside its text, which
// fast-xml-parser turns into an object instead of a string — mirrors the
// exact fix applied to qc-rest.service.ts's own parseFields/
// parseEntitiesListXml after this mock caught the bug there.
function extractValueText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    return text != null ? String(text) : '';
  }
  return String(value);
}
function parseIncomingFields(xml: string): Record<string, string> {
  if (!xml) return {};
  const parsed = xmlParser.parse(xml);
  const list = parsed?.Entity?.Fields?.Field ?? [];
  const arr = Array.isArray(list) ? list : [list];
  const out: Record<string, string> = {};
  for (const f of arr) {
    const name = f?.['@_Name'];
    if (!name) continue;
    const value = Array.isArray(f.Value) ? f.Value[0] : f.Value;
    out[name] = extractValueText(value);
  }
  return out;
}

// `{field['value']}` — the only query syntax our client code actually sends
// (findOrCreateReleaseFolder, listReleaseCyclesRest).
function matchesQuery(entity: Entity, query: string | null): boolean {
  if (!query) return true;
  const m = query.match(/\{([\w-]+)\[\'(.*?)\'\]\}/);
  if (!m) return true;
  const [, field, value] = m;
  return entity[field] === value;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function log(...args: unknown[]) {
  console.log(`[mock-qc]`, new Date().toISOString(), ...args);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';
  log(method, path, url.search || '');

  // ── Auth handshake ───────────────────────────────────────────────────
  if (path === '/authentication-point/authenticate') {
    const auth = req.headers.authorization || '';
    const decoded = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf-8') : '';
    const [username] = decoded.split(':');
    if (username === 'fail401') {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { 'Set-Cookie': `LWSSO_COOKIE_KEY=mock-sso-${username || 'anon'}` }).end();
    return;
  }
  if (path === '/rest/site-session') {
    res.writeHead(200, { 'Set-Cookie': `QCSession=mock-session-${Date.now()}` }).end();
    return;
  }
  if (path === '/authentication-point/logout') {
    res.writeHead(200).end();
    return;
  }

  // ── Debug dump ───────────────────────────────────────────────────────
  if (path === '/__mock__/dump') {
    const dump: Record<string, Entity[]> = {};
    collections.forEach((map, name) => { dump[name] = Array.from(map.values()); });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(dump, null, 2));
    return;
  }

  // ── Entity-fields metadata probe ─────────────────────────────────────
  const fieldsMatch = path.match(/^\/rest\/domains\/[^/]+\/projects\/[^/]+\/customization\/entities\/([\w-]+)\/fields$/);
  if (fieldsMatch && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(entityFieldsXml(fieldsMatch[1]));
    return;
  }

  // ── Attachments (must be matched before the generic :id route below) ──
  const attachMatch = path.match(/^\/rest\/domains\/[^/]+\/projects\/[^/]+\/([\w-]+)\/([^/]+)\/attachments\/?([^/]*)$/);
  if (attachMatch) {
    const [, , , fileName] = attachMatch;
    if (fileName) {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('mock attachment content');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(attachmentsXml());
    }
    return;
  }

  // ── Generic entity collection + single-entity CRUD ───────────────────
  // /rest/domains/:domain/projects/:project/:entityType[/:id]
  const genericMatch = path.match(/^\/rest\/domains\/([^/]+)\/projects\/([^/]+)\/([\w-]+)(?:\/([^/]+))?$/);
  if (genericMatch) {
    const [, , , entityType, id] = genericMatch;
    const store = collectionFor(entityType);

    if (!id && method === 'GET') {
      const query = url.searchParams.get('query');
      const rows = Array.from(store.values()).filter(e => matchesQuery(e, query));
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(entitiesListXml(entityType, rows));
      return;
    }
    if (!id && method === 'POST') {
      const body = await readBody(req);
      const fields = parseIncomingFields(body);
      const newId = String(nextId++);
      const entity: Entity = { id: newId, ...fields };
      store.set(newId, entity);
      log(`  created ${entityType} #${newId}:`, fields);
      res.writeHead(201, { 'Content-Type': 'application/xml', Location: `${path}/${newId}` }).end(entityXml(entityType, entity));
      return;
    }
    if (id && method === 'GET') {
      const entity = store.get(id);
      if (!entity) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(entityXml(entityType, entity));
      return;
    }
    if (id && method === 'PUT') {
      const entity = store.get(id);
      if (!entity) { res.writeHead(404).end(); return; }
      const body = await readBody(req);
      const fields = parseIncomingFields(body);
      Object.assign(entity, fields); // field-level merge, matching our own client's assumption
      log(`  updated ${entityType} #${id}:`, fields);
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(entityXml(entityType, entity));
      return;
    }
  }

  res.writeHead(404).end(`mock-qc: no route for ${method} ${path}`);
});

server.listen(PORT, () => {
  log(`Mock QC REST server listening on http://localhost:${PORT}`);
  log(`Point QC_REST_BASE_URL at this URL in dev/test SystemParams — never in a real environment.`);
});
