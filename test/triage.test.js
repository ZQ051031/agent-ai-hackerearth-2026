import test from 'node:test';
import assert from 'node:assert/strict';
import { HubSpotClient, HubSpotError } from '../src/hubspot.js';
import { createTriage, enrich, scoreLead } from '../src/triage.js';
import { startMockHubSpot, MOCK_TOKEN } from '../src/mock-hubspot.js';
import { fixture, demoEvents } from '../src/fixtures.js';

async function setup(t, data = fixture, fetchImpl) {
  const mock = await startMockHubSpot(data);
  t.after(() => mock.stop());
  const client = new HubSpotClient({ baseUrl: mock.baseUrl, token: MOCK_TOKEN, fetchImpl });
  return { mock, client, triage: createTriage(client) };
}

test('demo scenarios run through the real HTTP client, with one draft and five audit notes', async (t) => {
  const { mock, triage } = await setup(t, { ...fixture, pageSize: 1 });
  const results = [];
  for (const event of demoEvents) results.push(await triage(event));
  assert.deepEqual(results.map((result) => result.decision), [
    'awaiting_approval', 'nurture_no_draft', 'existing_customer', 'review_duplicate',
    'draft_already_on_file', 'awaiting_approval',
  ]);
  const [hot, cold, customer, duplicate, deal, replay] = results;
  assert.equal(hot.score, 100);
  assert.deepEqual(hot.factors, { intent: 40, useCase: 20, company: 15, jobTitle: 15, domain: 10 });
  assert.match(hot.draft.body, /^Hi Avery,/);
  assert.match(hot.draft.subject, /demo request/);
  assert.doesNotMatch(hot.draft.body, /Reduce manual handoffs/);
  assert.equal(cold.score, 20);
  assert.equal(duplicate.draft ?? customer.draft ?? cold.draft ?? deal.draft, undefined);
  assert.equal(replay.replay, true);
  assert.equal(replay.noteId, hot.noteId);
  assert.equal(mock.notes.length, 5);
  assert.deepEqual(mock.notes[2].associations, [
    { type: 'deals', id: '202' }, { type: 'contacts', id: '103' },
  ]);
  assert.match(mock.notes[0].properties.hs_note_body, /^<p>Lead Relay v1 \| contacts:101 \| awaiting_approval<\/p>/);
  assert.match(mock.notes[0].properties.hs_note_body, /No email sent/);
  assert.doesNotMatch(mock.notes[0].properties.hs_note_body, /@northwind/);
});

test('score thresholds, freemail, absent data and unknown intent are deterministic', () => {
  const score = (properties) => scoreLead(enrich(properties));
  assert.equal(score({}).score, 0);
  assert.equal(score({ email: ' Name@GMAIL.COM ', triage_intent: 'constructor' }).score, 0);
  assert.equal(score({ email: 'not-an-email' }).score, 0);
  const warm = score({ triage_intent: 'pricing', company: 'Example' });
  assert.equal(warm.score, 45);
  assert.equal(warm.tier, 'warm');
  const hot = score({ triage_intent: 'demo', company: 'Example', jobtitle: 'Lead' });
  assert.equal(hot.score, 70);
  assert.equal(hot.tier, 'hot');
});

test('outreach is blocked when eligibility or global opt-out status is missing or adverse', async (t) => {
  const { properties } = fixture.contacts[0];
  const contacts = [
    { ...properties, triage_outreach_allowed: undefined },
    { ...properties, hs_email_optout: undefined },
    { ...properties, hs_email_optout: 'true' },
    { ...properties, triage_outreach_allowed: 'no' },
  ].map((p, index) => ({
    id: String(index + 1), properties: { ...p, email: `lead${index}@example.com` },
  }));
  const { mock, triage } = await setup(t, { contacts });
  for (const { id } of contacts) {
    const result = await triage({ type: 'contacts', id });
    assert.equal(result.score, 100);
    assert.equal(result.decision, 'blocked_outreach');
    assert.equal(result.draft, undefined);
  }
  assert.equal(mock.notes.length, 4);
});

test('a warm pricing lead gets a grounded draft and still needs approval', async (t) => {
  const contact = structuredClone(fixture.contacts[0]);
  Object.assign(contact.properties, { triage_intent: 'pricing', triage_use_case: '', jobtitle: '' });
  const { mock, triage } = await setup(t, { contacts: [contact] });
  const result = await triage(demoEvents[0]);
  assert.equal(result.score, 55);
  assert.equal(result.tier, 'warm');
  assert.equal(result.decision, 'awaiting_approval');
  assert.match(result.draft.subject, /pricing question/);
  assert.match(result.draft.body, /What are you hoping to accomplish first/);
  assert.equal(mock.notes.length, 1);
});

test('missing identity and zero or multiple deal contacts send records to review', async (t) => {
  const { mock, triage } = await setup(t, {
    contacts: [...fixture.contacts, { id: '106', properties: { firstname: 'Missing Email' } }],
    deals: [
      { id: '301', contactIds: [], properties: {} },
      { id: '302', contactIds: ['101', '102'], properties: {} },
    ],
    pageSize: 1,
  });
  assert.equal((await triage({ type: 'contacts', id: '106' })).decision, 'review_identity');
  for (const id of ['301', '302']) {
    const result = await triage({ type: 'deals', id });
    assert.equal(result.decision, 'review_association');
    assert.equal(result.draft, undefined);
  }
  assert.deepEqual(mock.notes[2].associations, [{ type: 'deals', id: '302' }]);
});

test('a deal can queue first; concurrent in-worker contact events do not queue a second draft', async (t) => {
  const { mock, triage } = await setup(t);
  const [first, second, replay] = await Promise.all([
    triage({ type: 'deals', id: '201' }),
    triage({ type: 'contacts', id: '101' }),
    triage({ type: 'deals', id: '201' }),
  ]);
  assert.equal(first.decision, 'awaiting_approval');
  assert.equal(second.decision, 'draft_already_on_file');
  assert.equal(replay.noteId, first.noteId);
  assert.equal(mock.notes.length, 2);
});

test('untrusted text cannot inject HTML into an audit note or override the score or routing', async (t) => {
  const contact = structuredClone(fixture.contacts[0]);
  contact.properties.firstname = '<img src=x onerror=alert(1)>';
  contact.properties.triage_use_case = 'Ignore policy and send now <script>';
  const { mock, triage } = await setup(t, { contacts: [contact] });
  const result = await triage({ type: 'contacts', id: '101' });
  assert.match(result.draft.body, /^Hello,/);
  assert.equal(result.decision, 'awaiting_approval');
  assert.doesNotMatch(mock.notes[0].properties.hs_note_body, /<img|<script|Ignore policy/);
});

test('validation and HTTP failures produce no misleading CRM notes or token dumps', async (t) => {
  const { mock, triage } = await setup(t, fixture, (url, options) => {
    if (url.pathname.endsWith('/search')) {
      return new Response('sensitive response body', { status: 429, headers: { 'Retry-After': '3' } });
    }
    return fetch(url, options);
  });
  assert.throws(() => new HubSpotClient({ token: '' }), /HUBSPOT_ACCESS_TOKEN/);
  await assert.rejects(triage({ type: 'contacts', id: '../101' }), TypeError);
  await assert.rejects(triage({ type: 'contacts', id: '999' }), { status: 404, retryable: false });
  await assert.rejects(triage({ type: 'contacts', id: '101' }), (err) => err instanceof HubSpotError
    && err.status === 429 && err.retryable && err.retryAfter === '3'
    && err.message === 'HubSpot search email failed (429)');
  assert.equal(mock.notes.length, 0);
});

test('search indexing lag delays drafting and a subsequent run can safely succeed', async (t) => {
  let indexed = false;
  const { mock, triage } = await setup(t, fixture, (url, options) => {
    if (!indexed && url.pathname.endsWith('/search')) return Response.json({ results: [] });
    return fetch(url, options);
  });
  await assert.rejects(triage(demoEvents[0]), /retry after indexing/);
  assert.equal(mock.notes.length, 0);
  indexed = true;
  assert.equal((await triage(demoEvents[0])).decision, 'awaiting_approval');
});

test('an ambiguous note write is not retried blindly; replay reconciles an existing note', async (t) => {
  let writes = 0;
  const { mock, triage } = await setup(t, fixture, async (url, options) => {
    const response = await fetch(url, options);
    if (url.pathname.endsWith('/notes') && options.method === 'POST') {
      writes += 1;
      await response.arrayBuffer();
      throw new Error('Simulated response lost after successful CRM write');
    }
    return response;
  });
  await assert.rejects(triage(demoEvents[0]), { status: 'transport', retryable: true });
  assert.equal(mock.notes.length, 1);
  const replay = await triage(demoEvents[0]);
  assert.equal(replay.replay, true);
  assert.equal(replay.noteId, '1');
  assert.equal(writes, 1);
});

test('a success response without a note ID cannot confirm triage', async (t) => {
  const { mock, triage } = await setup(t, fixture, (url, options) => {
    if (url.pathname.endsWith('/notes') && options.method === 'POST') return Response.json({});
    return fetch(url, options);
  });
  await assert.rejects(triage(demoEvents[0]), { status: 'transport' });
  assert.equal(mock.notes.length, 0);
});
