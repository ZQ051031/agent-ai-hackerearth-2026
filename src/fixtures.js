const eligible = { lifecyclestage: 'lead', hs_email_optout: 'false', triage_outreach_allowed: 'yes' };

export const fixture = {
  contacts: [
    { id: '101', properties: {
      ...eligible, firstname: 'Avery', email: 'avery@northwind.example', company: 'Northwind',
      jobtitle: 'VP of Operations', triage_intent: 'demo', triage_use_case: 'Reduce manual handoffs',
    } },
    { id: '102', properties: {
      ...eligible, firstname: 'Robin', email: 'robin@personal.example', triage_intent: 'general',
    } },
    { id: '103', properties: {
      ...eligible, firstname: 'Morgan', email: 'morgan@tailspin.example', company: 'Tailspin',
      jobtitle: 'Operations Lead', lifecyclestage: 'customer', triage_intent: 'demo',
    } },
    { id: '104', properties: {
      ...eligible, firstname: 'Kit', email: 'kit@contoso.example', triage_intent: 'pricing',
    } },
    { id: '105', properties: { ...eligible, email: 'kit@contoso.example' } },
  ],
  deals: [
    { id: '201', properties: { dealstage: 'appointmentscheduled' }, contactIds: ['101'] },
    { id: '202', properties: { dealstage: 'appointmentscheduled' }, contactIds: ['103'] },
  ],
};

export const demoEvents = [
  { label: 'Hot contact', type: 'contacts', id: '101' },
  { label: 'Cold contact', type: 'contacts', id: '102' },
  { label: 'Existing customer deal', type: 'deals', id: '202' },
  { label: 'Duplicate email', type: 'contacts', id: '104' },
  { label: 'Deal linked to queued contact', type: 'deals', id: '201' },
  { label: 'Replay hot contact', type: 'contacts', id: '101' },
];
