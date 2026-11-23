import { HubSpotClient } from './hubspot.js';
import { startMockHubSpot, MOCK_TOKEN } from './mock-hubspot.js';
import { createTriage } from './triage.js';
import { fixture, demoEvents } from './fixtures.js';

const mock = await startMockHubSpot(fixture);
try {
  const triage = createTriage(new HubSpotClient({ baseUrl: mock.baseUrl, token: MOCK_TOKEN }));
  console.log('Lead Relay | local mock HubSpot | no outbound email\n');
  for (const { label, ...event } of demoEvents) {
    const result = await triage(event);
    const score = result.score === undefined ? '' : ` (${result.score}/100, ${result.tier})`;
    const replay = result.replay ? ' (replay; no new note)' : '';
    console.log(`${label}: ${result.decision}${score} → CRM note #${result.noteId}${replay}`);
    if (result.draft) console.log(`  Draft subject: ${result.draft.subject}\n${result.draft.body}\n`);
  }
  console.log(`\nMock CRM audit trail: ${mock.notes.length} notes`);
  for (const { id, associations } of mock.notes) {
    console.log(`  #${id}: ${associations.map(({ type, id }) => `${type}:${id}`).join(', ')}`);
  }
} finally {
  await mock.stop();
}
