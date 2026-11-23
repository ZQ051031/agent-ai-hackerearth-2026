# Lead Relay — agent blueprint

**Track:** HubSpot Innovation. **Operator:** inbound CRM owner. **Outcome:** every new record gets a reasoned disposition; qualified inbound leads get a draft without giving AI permission to send, merge records, or move deals.

## Architecture

```text
HubSpot new contact/deal → Agent.ai intake (ID only) → CRM reads / association checks
                                                       ↓
                                            normalize → score → decision
                                                       ↓
                                           eligible? → prepare draft
                                                       ↓
                                          one linked HubSpot audit note
                                                       ↓
                               owner reviews draft, decides and acts outside agent
```

Use a single serial workflow per HubSpot portal. Start with an operator-run input or polling workflow, then enable an unattended schedule only if the free builder offers secure credential storage, iteration, scheduling and suitable concurrency controls. Webhooks are an alternative intake, not a dependency. No third-party enrichment, paid model/API, outgoing email tool or external state service is required. The local prototype ingests the same event data one at a time via a demo sequence; it does not run a scheduler, a webhook server or a live Agent.ai deployment.

## Data model and provisioning

| Entity | Fields and ownership |
|---|---|
| Creation event | `type: contacts\|deals`, `id: positive decimal string`. Trust only authorized CRM/owner sources. Ignore upstream snapshots; read the current CRM data. ID and event keys are portal-local. |
| Contact | Read `firstname`, primary `email`, `company`, `jobtitle`, `lifecyclestage`, `hs_email_optout`. For outreach eligibility, verify in the portal that opt-out status is present and meaningful; an unset field is not permission. |
| Contact inputs (custom) | Create `triage_intent` as a dropdown with internal values `demo`, `pricing`, `general`; `triage_use_case` as text; `triage_outreach_allowed` as a dropdown with internal values `yes`, `no`, default unset. Only an authorized human or approved policy process sets eligibility; the agent never sets it. Use authoritative inbound form/CRM data. |
| Deal | Read existing deal by ID; resolve linked contacts through associations. No inference from deal title, amounts or stage IDs. Only a unique association can supply a contact. |
| Derived profile | Valid-looking primary email, business-domain indicator, normalized intent/lifecycle, first name, company/job-title/use-case presence, authorization flag. No identity guessing. |
| Decision | `key` = `contacts:<id>` or `deals:<id>`; optional factor map, 0–100 score, tier, optional draft, decision enum, note ID, optional replay flag. |
| Audit note | `hs_timestamp` (UTC), `hs_note_body` (escape HTML); first paragraph is the replay marker (format below). Follow with completed steps, factor values, decision, and draft if queued. Link to the trigger object and, for a uniquely linked deal, also its contact. Do not put email addresses, raw form text or credentials in the note. |

Marker format: `Lead Relay v1 | <event key> | <decision>`.

Normalize control characters to spaces, collapse whitespace, trim, and cap fields (name 50, email 255, use case 300, others 120). Lowercase email, intent and lifecycle. A plausible email contains one `@`, a nonempty local part without whitespace, and a dot-separated ASCII domain; no deliverability check is performed. Use only these exact freemail domains: `gmail.com`, `googlemail.com`, `yahoo.com`, `outlook.com`, `hotmail.com`, `icloud.com`, `aol.com`, `live.com`, `proton.me`, `protonmail.com`. A valid domain not on the list gets a weak business-domain signal, not a verified affiliation. Never use protected attributes, scrape social profiles, infer budget or seniority, or assume a missing field.

## Scoring and routing

| Signal | Points |
|---|---:|
| Inbound intent `demo` / `pricing` / `general` / other or missing | 40 / 30 / 10 / 0 |
| Use case supplied | 20 |
| Company supplied | 15 |
| Job title supplied | 15 |
| Business-domain indicator | 10 |

Hot ≥70; warm 45–69; low 0–44. These are prioritization heuristics, not eligibility or disqualification. Score is explanatory; higher-priority routing rules override it.

Evaluate in order:

1. Validate type/ID. Read the trigger object and look up attached notes. If the exact event key is present, return the prior disposition and note reference, `replay: true`, no draft or new write.
2. For a deal, resolve all contact associations (stop after two distinct IDs). If not exactly one, write `review_association` on the deal; ask the owner to reconcile. New associations may lag record creation: allow a short grace period before sweeping new deals and treat an ambiguous association as a human handoff, not an automatic rerun.
3. Enrich and calculate the score. If lifecycle is `customer` or `evangelist`, write `existing_customer`; direct the owner to the existing account/service process. If no plausible email, write `review_identity`; owner verifies identity.
4. Search exact primary email. If search returns zero, stop as retryable indexing lag; do not draft or write a terminal note. For deal events check the contact's notes as well. If the same event key is already linked there, return it as a replay. If the search gives more than one result or another ID, write `review_duplicate`; owner compares records, never merge or email automatically.
5. If a prior Lead Relay note on this contact is marked `awaiting_approval`, write `draft_already_on_file`; an original marker means “draft created”, not that it is still pending. This prevents contact/deal double follow-up; use the original note, not a fresh draft.
6. Require both `triage_outreach_allowed === "yes"` and `hs_email_optout === "false"` (HubSpot property values are strings). Otherwise write `blocked_outreach`. An opt-out flag is not itself lawful basis, and “no opt-out” does not prove a channel subscription.
7. Low → `nurture_no_draft` (review if useful; do not enroll in a sequence). Hot/warm → `awaiting_approval`, with one editable draft in the associated note. Draft personalization uses a safe first name, inbound topic and whether use-case context exists; it does not quote arbitrary form text.
8. Write one note containing the trace, not one per action. Only report completion after the note write is acknowledged, or after finding the prior marker during reconciliation.

## Human approval and boundaries

A draft is **not** approval, sending, a marketing opt-in, or meeting booking. The owner opens the linked record and checks recipient and identity, actual channel eligibility/subscription and global suppression, account ownership, any prior conversation, accuracy and tone. They can edit, approve or discard. If their normal process permits sending, they send manually from an authorized channel and record that decision/outcome in the CRM separately. The workflow cannot execute email, change contact properties, update lifecycle/deals, grant consent, merge records, or create any external side effect except the audit note. Keep draft visibility restricted to the relevant CRM team and follow portal retention policy; run the demo on fictional data only.

## Failure handling

| Failure | Operator behavior |
|---|---|
| Malformed/unauthenticated creation input | Reject; no CRM lookup or write. Do not log raw inbound payload. |
| Missing object / deleted / archived (404) | Stop without claiming a note exists. For a brand-new ID allow a bounded visibility recheck before routing to owner review. |
| Search not indexed yet / transient read or rate limit | Retry the full event after delay. Use `Retry-After` on 429 when present; otherwise use increasing delay (e.g. 2, 5, 15 seconds). After three retries hold for review. Do not skip failed records silently. |
| 400 (schema), 401/403 (auth/scope), malformed provider payload | Stop, surface safe diagnostics and fix config/credential shape before reprocessing. Never echo auth headers or provider response bodies. A malformed read response must not authorize an action. |
| Timeout/5xx/malformed response on the note write | Outcome may be unknown. Pause affected processing, wait for CRM visibility, check exact event marker on both relevant objects and resume only after verifying whether the write landed. Never blindly retry the POST. |
| Workflow unavailable or cannot securely store secrets, paginate or control concurrency | Do not enable automation. Use synthetic build runs and the local demo while resolving the limitation. |

Notes provide best-effort idempotence, not an atomic lock: marker edits/deletions, parallel workers, delayed association visibility or ambiguous writes can defeat it. Do not enable multiple consumers of the same portal or let the model select arbitrary duplicate winners. Keep a minimal authenticated run history for failures (event key, failed stage, HTTP status/retry class, timestamp), without payloads. Successful paths are logged in CRM; if reads/writes are unavailable the run history is the fallback until reconciliation. The prototype exposes failures to its caller rather than auto-retrying.
