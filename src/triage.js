import { CONTACT_FIELDS } from './hubspot.js';

const PERSONAL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com',
  'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'live.com', 'proton.me', 'protonmail.com']);
const INTENT_POINTS = new Map([['demo', 40], ['pricing', 30], ['general', 10]]);
const NOTE_PREFIX = 'Lead Relay v1';
const isId = (id) => typeof id === 'string' && /^[1-9]\d*$/.test(id);
const clean = (value, max = 120) => typeof value === 'string'
  ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max)
  : '';
const escapeHtml = (value) => value.replace(/[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function enrich(properties) {
  const email = clean(properties.email, 255).toLowerCase();
  const domain = /^[^@\s]+@([a-z\d-]+(?:\.[a-z\d-]+)+)$/.exec(email)?.[1] ?? '';
  return {
    email: domain ? email : '',
    businessDomain: Boolean(domain) && !PERSONAL_DOMAINS.has(domain),
    firstName: clean(properties.firstname, 50),
    company: clean(properties.company),
    jobTitle: clean(properties.jobtitle),
    lifecycle: clean(properties.lifecyclestage).toLowerCase(),
    intent: clean(properties.triage_intent).toLowerCase(),
    useCase: clean(properties.triage_use_case, 300),
    outreachAllowed: properties.triage_outreach_allowed === 'yes' && properties.hs_email_optout === 'false',
  };
}

export function scoreLead(lead) {
  const factors = {
    intent: INTENT_POINTS.get(lead.intent) ?? 0,
    useCase: lead.useCase ? 20 : 0,
    company: lead.company ? 15 : 0,
    jobTitle: lead.jobTitle ? 15 : 0,
    domain: lead.businessDomain ? 10 : 0,
  };
  const score = Object.values(factors).reduce((sum, points) => sum + points, 0);
  return { score, factors, tier: score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'low' };
}

function draftEmail(lead) {
  const greeting = /^[\p{L}\p{M} .’'-]+$/u.test(lead.firstName)
    ? `Hi ${lead.firstName},`
    : 'Hello,';
  const topic = lead.intent === 'demo' ? 'your demo request'
    : lead.intent === 'pricing' ? 'your pricing question' : 'your interest';
  return {
    subject: `Following up on ${topic}`,
    body: [
      greeting,
      `Thanks for reaching out about ${topic}.`,
      lead.useCase
        ? 'Which part of the use case you shared should we focus on first?'
        : 'What are you hoping to accomplish first?',
      'If a short conversation would help, feel free to suggest a time that works for you.',
      'Best,\nThe inbound team',
    ].join('\n\n'),
  };
}

function marker(key, decision) {
  return `${NOTE_PREFIX} | ${key} | ${decision}`;
}

function readMarker(body) {
  const match = /^(?:<p>)?Lead Relay v1 \| ((?:contacts|deals):[1-9]\d*) \| ([a-z_]+)(?=<\/p>|\n|$)/.exec(body);
  return match && { key: match[1], decision: match[2] };
}

async function auditState(client, type, id, eventKey) {
  let alreadyQueued = false;
  for await (const { id: noteId, body } of client.associatedNotes(type, id)) {
    const entry = readMarker(body);
    if (entry?.key === eventKey) return { prior: { decision: entry.decision, noteId } };
    if (entry?.decision === 'awaiting_approval') alreadyQueued = true;
  }
  return { alreadyQueued };
}

async function resolveContact(client, type, id) {
  if (type === 'contacts') return id;
  const contacts = new Set();
  for await (const contactId of client.associatedIds('deals', id, 'contacts')) {
    contacts.add(contactId);
    if (contacts.size > 1) return null;
  }
  return [...contacts][0] ?? null;
}

async function triage(client, event) {
  const { type, id } = event ?? {};
  if ((type !== 'contacts' && type !== 'deals') || !isId(id)) {
    throw new TypeError('Expected a creation event with type contacts/deals and a positive string id.');
  }

  const key = `${type}:${id}`;
  const record = await client.getObject(type, id, type === 'contacts' ? CONTACT_FIELDS : ['dealstage']);
  const existing = await auditState(client, type, id, key);
  if (existing.prior) return { key, replay: true, ...existing.prior };
  const result = { key };
  const trace = [`Read ${type} record and checked audit notes.`];
  const associations = [{ type, id }];
  const contactId = await resolveContact(client, type, id);
  if (!contactId) {
    result.decision = 'review_association';
    trace.push('Deal has no unique linked contact. Owner review; no draft.');
  } else {
    if (type === 'deals') associations.push({ type: 'contacts', id: contactId });
    const contact = type === 'contacts' ? record
      : await client.getObject('contacts', contactId, CONTACT_FIELDS);
    const lead = enrich(contact.properties);
    const { score, tier, factors } = scoreLead(lead);
    Object.assign(result, { score, tier, factors });
    trace.push(`Enriched CRM profile; scored ${score}/100 (${tier}): ${JSON.stringify(factors)}.`);
    if (lead.lifecycle === 'customer' || lead.lifecycle === 'evangelist') {
      result.decision = 'existing_customer';
    } else if (!lead.email) {
      result.decision = 'review_identity';
    } else {
      const matches = await client.findContactsByEmail(lead.email);
      trace.push('Checked primary email with exact CRM contact search.');
      if (matches.length === 0) {
        // Search indexing can lag a newly created record.
        throw new Error('Contact search returned no match; retry after indexing before drafting.');
      }
      const contactAudit = type === 'contacts' ? existing
        : await auditState(client, 'contacts', contactId, key);
      if (contactAudit.prior) return { key, replay: true, ...contactAudit.prior };
      if (matches.length !== 1 || matches[0] !== contactId) result.decision = 'review_duplicate';
      else if (contactAudit.alreadyQueued) result.decision = 'draft_already_on_file';
      else if (!lead.outreachAllowed) result.decision = 'blocked_outreach';
      else if (tier === 'low') result.decision = 'nurture_no_draft';
      else {
        result.decision = 'awaiting_approval';
        result.draft = draftEmail(lead);
      }
    }
    trace.push(result.draft
      ? 'Prepared a draft for owner approval. No email sent.'
      : `Decision: ${result.decision}. No draft or email sent.`);
  }

  const lines = [marker(key, result.decision), ...trace];
  if (result.draft) lines.push(`Draft subject: ${result.draft.subject}`, result.draft.body);
  const body = lines.map((line) => `<p>${escapeHtml(line).replaceAll('\n', '<br />')}</p>`).join('');
  const note = await client.createNote({ body, associations });
  return { ...result, noteId: String(note.id) };
}

export function createTriage(client) {
  let queue = Promise.resolve();
  return (event) => {
    const run = queue.then(() => triage(client, event));
    queue = run.catch(() => {});
    return run;
  };
}
