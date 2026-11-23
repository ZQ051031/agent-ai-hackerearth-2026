export const CONTACT_FIELDS = [
  'firstname', 'email', 'company', 'jobtitle', 'lifecyclestage', 'hs_email_optout',
  'triage_intent', 'triage_use_case', 'triage_outreach_allowed',
];

const NOTE_TO_OBJECT = { contacts: 202, deals: 214 };

export class HubSpotError extends Error {
  constructor(operation, status, retryAfter = null) {
    super(`HubSpot ${operation} failed (${status})`);
    this.name = 'HubSpotError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.retryable = status === 'transport' || status === 429 || status >= 500;
  }
}

export class HubSpotClient {
  constructor({ token = process.env.HUBSPOT_ACCESS_TOKEN,
    baseUrl = 'https://api.hubapi.com', fetchImpl = fetch } = {}) {
    if (!token?.trim()) throw new Error('Set HUBSPOT_ACCESS_TOKEN before connecting to HubSpot.');
    this.token = token;
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }

  async request(operation, path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await this.fetch(new URL(path, this.baseUrl), {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new HubSpotError(operation, 'transport');
    }
    if (!response.ok) {
      throw new HubSpotError(operation, response.status, response.headers.get('Retry-After'));
    }
    try {
      return await response.json();
    } catch {
      throw new HubSpotError(operation, 'transport');
    }
  }

  getObject(objectType, id, properties) {
    const query = new URLSearchParams({ properties: properties.join(',') });
    return this.request('read object', `/crm/v3/objects/${objectType}/${encodeURIComponent(id)}?${query}`);
  }

  async *associatedIds(fromType, id, toType) {
    let after;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (after !== undefined) query.set('after', after);
      const page = await this.request('list associations',
        `/crm/v4/objects/${fromType}/${encodeURIComponent(id)}/associations/${toType}?${query}`);
      for (const item of page.results) yield String(item.toObjectId);
      after = page.paging?.next?.after;
    } while (after !== undefined);
  }

  async findContactsByEmail(email) {
    const found = await this.request('search email', '/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['email'],
        limit: 2,
      },
    });
    return found.results.map(({ id }) => String(id));
  }

  async *associatedNotes(type, id) {
    for await (const noteId of this.associatedIds(type, id, 'notes')) {
      const note = await this.getObject('notes', noteId, ['hs_note_body']);
      yield { id: String(note.id), body: note.properties.hs_note_body ?? '' };
    }
  }

  async createNote({ body, associations }) {
    const note = await this.request('create note', '/crm/v3/objects/notes', {
      method: 'POST',
      body: {
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body },
        associations: associations.map(({ type, id }) => ({
          to: { id },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_OBJECT[type] }],
        })),
      },
    });
    if (!/^[1-9][0-9]*$/.test(String(note?.id))) throw new HubSpotError('create note', 'transport');
    return note;
  }
}
