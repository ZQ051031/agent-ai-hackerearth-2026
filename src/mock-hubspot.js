import { createServer } from 'node:http';

export const MOCK_TOKEN = 'local-demo';
const TYPE_BY_NOTE_ASSOCIATION = new Map([[202, 'contacts'], [214, 'deals']]);

async function readJson(request) {
  let text = '';
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
}

export async function startMockHubSpot({ contacts = [], deals = [], pageSize = 100 } = {}) {
  const objects = {
    contacts: new Map(contacts.map(({ id, properties }) => [id, structuredClone(properties)])),
    deals: new Map(deals.map(({ id, properties }) => [id, structuredClone(properties)])),
    notes: new Map(),
  };
  const contactsByDeal = new Map(deals.map(({ id, contactIds = [] }) => [id, [...contactIds]]));
  const notes = [];
  const server = createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${MOCK_TOKEN}`) {
      return send(401, { message: 'Invalid mock credentials' });
    }
    const url = new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').slice(1);
    const [crm, version, resource, type, id, relation, toType] = segments;
    if (crm !== 'crm' || resource !== 'objects') return send(404, {});
    try {
      if (req.method === 'GET' && version === 'v3' && segments.length === 5) {
        const properties = objects[type]?.get(id);
        if (!properties) return send(404, {});
        const requested = url.searchParams.get('properties')?.split(',') ?? [];
        return send(200, {
          id, properties: Object.fromEntries(requested.map((field) => [field, properties[field] ?? null])),
        });
      }

      if (req.method === 'GET' && version === 'v4' && relation === 'associations') {
        if (!objects[type]?.has(id)) return send(404, {});
        const ids = type === 'deals' && toType === 'contacts' ? contactsByDeal.get(id)
          : toType === 'notes' ? notes.filter((note) =>
            note.associations.some((item) => item.type === type && item.id === id)).map((note) => note.id)
            : null;
        if (!ids) return send(404, {});
        const start = Number(url.searchParams.get('after') ?? 0);
        const end = start + Math.min(Number(url.searchParams.get('limit') ?? 100), pageSize);
        return send(200, {
          results: ids.slice(start, end).map((toObjectId) => ({ toObjectId })),
          ...(end < ids.length ? { paging: { next: { after: String(end) } } } : {}),
        });
      }

      if (req.method === 'POST' && version === 'v3' && type === 'contacts' && id === 'search') {
        const { filterGroups, limit } = await readJson(req);
        const filter = filterGroups?.[0]?.filters?.[0];
        if (filter?.operator !== 'EQ' || filter?.propertyName !== 'email') return send(400, {});
        const matches = [...objects.contacts].filter(([, props]) =>
          props.email?.toLowerCase() === filter.value.toLowerCase());
        return send(200, {
          total: matches.length,
          results: matches.slice(0, limit).map(([id, { email }]) => ({ id, properties: { email } })),
        });
      }

      if (req.method === 'POST' && version === 'v3' && type === 'notes' && segments.length === 4) {
        const { properties, associations } = await readJson(req);
        const links = associations.map(({ to, types: [{ associationCategory, associationTypeId }] }) => ({
          id: String(to.id), type: associationCategory === 'HUBSPOT_DEFINED'
            ? TYPE_BY_NOTE_ASSOCIATION.get(associationTypeId) : undefined,
        }));
        if (!links.length || !links.every(({ id, type }) => objects[type]?.has(id))
            || typeof properties?.hs_note_body !== 'string' || !Number.isFinite(Date.parse(properties.hs_timestamp))) {
          return send(400, {});
        }
        const id = String(notes.length + 1);
        objects.notes.set(id, properties);
        notes.push({ id, properties, associations: links });
        return send(201, { id, properties });
      }
      return send(404, {});
    } catch {
      return send(400, { message: 'Malformed mock request' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    notes,
    stop: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}
