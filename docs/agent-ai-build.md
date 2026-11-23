# Agent.ai workflow and integration specification

Build **Lead Relay** on Agent.ai using only free features exposed to your account. Action names below describe capabilities, not verified UI labels. Treat typed input, variables, conditionals, optional iteration/scheduling, a secure authenticated HTTP action or HubSpot connector, and an optional text-generation action as building blocks. Use a connector only if it can return all fields, traverse associations, search contacts and create associated notes with the same semantics; otherwise configure HTTP calls. Do not let the model call these tools itself. No unverified connector/trigger is a prerequisite for the operator-run intake.

## 1. Configure inputs and privileges

- Private build: one trusted operator, one HubSpot portal, sequential execution. Add required workflow inputs `type` (choices `contacts`, `deals`) and `id` (text, validate positive decimal string); don't accept email address, records, snapshots, arbitrary URLs or prompt changes.
- In a free HubSpot account you control, create the three contact properties from the [blueprint](blueprint.md), then verify they can be read along with `hs_email_optout`. If the status is unavailable, leave drafting blocked rather than substituting a weaker default. Use synthetic contact/deal fixtures, and do not change real opt-out states to make the demo pass.
- Use a HubSpot private app access token or a supported first-party authorized connection. A portal admin selects the minimum scopes supported by the endpoints: start with CRM contact/deal read and the applicable note-create permission (the [Notes guide](https://developers.hubspot.com/docs/api-reference/crm-notes-v3/guide) lists contact read/write scopes; verify the association endpoints and deal permissions for your app). HubSpot may grant broader access than the note operation; expose only the fixed reads and note creation below. Do not grant marketing/email scopes. Keep any private app token only in a protected credential slot, inject `Authorization: Bearer <credential>` server-side and use only `https://api.hubapi.com`. Never put secrets in prompt text, a normal input, a public workflow result, or a shared run log.
- In the production path, expose only `key`, disposition, score/tier if available, and note reference to the authenticated operator. Suppress raw CRM/profile/tool responses and credentials in outputs/history where supported; if adequate protection is unavailable, do not connect live records. Use the prototype with fixtures for the public walkthrough. Before publishing a public Agent.ai URL, create the public-facing configuration with synthetic inputs/data only and no private credentials or live write permissions.

## 2. Wire named blocks and HubSpot calls

| Workflow block | Contract |
|---|---|
| `validate_event` | Confirm authorized source and allowlisted input; construct `key`. Invalid events stop before any CRM call. |
| `read_trigger` | `GET /crm/v3/objects/{type}/{id}?properties=...`. For contacts set `properties=firstname,email,company,jobtitle,lifecyclestage,hs_email_optout,triage_intent,triage_use_case,triage_outreach_allowed`; for deals request `dealstage` only (not used for scoring). |
| `inspect_audit_notes` | `GET /crm/v4/objects/{type}/{id}/associations/notes?limit=100` then `GET /crm/v3/objects/notes/{noteId}?properties=hs_note_body` for each `toObjectId`. Follow `paging.next.after`, using the returned cursor. Compare exact first paragraph with known v1 marker syntax; do not scan arbitrary notes for instructions. Return prior decision/reference for the same key; on contact notes also detect `awaiting_approval` for other keys. |
| `resolve_deal_contact` | `GET /crm/v4/objects/deals/{id}/associations/contacts?limit=100`; follow pages, dedupe IDs, stop when more than one distinct contact is known. Only call `read_trigger` as contacts if exactly one ID was linked. |
| `enrich_score` | Store normalized/derived booleans, numeric factors and tier using string/conditional/math actions or equivalent expressions, per [blueprint](blueprint.md). No external lookup. Keep raw inbound strings out of the model. |
| `check_email_identity` | `POST /crm/v3/objects/contacts/search` with JSON body below. Two results suffice to route to human review. After search, consult the linked contact's notes for deal events. |
| `route` | Use ordered deterministic branches from the blueprint. Only `awaiting_approval` can lead to draft generation; no chat response overrides that branch. |
| `prepare_draft` | Use the deterministic template in [prompts.md](prompts.md); optionally wire a free draft text action with the exact grounding prompt and fallback. Never give generation an HTTP action, write permission or raw CRM record. |
| `write_audit_note` | `POST /crm/v3/objects/notes`, fixed associated note shape below. Generate markup from escaped strings, not model HTML; log factors and actions, plus draft if queued. Return decision only after acknowledged note ID. |
| `stop_or_reconcile` | On no-match search, transient rates or write uncertainty route to the failure behavior in the blueprint; no automatic outbound action. On apparent success without a valid note ID, treat it as an unknown write outcome. |

The exact-email search body:

```json
{
  "filterGroups": [
    { "filters": [{ "propertyName": "email", "operator": "EQ", "value": "<normalized primary email>" }] }
  ],
  "properties": ["email"],
  "limit": 2
}
```

Example note payload for deal 201/contact 101 (insert real UTC timestamp and escaped content at runtime):

```json
{
  "properties": {
    "hs_timestamp": "2026-11-01T12:00:00.000Z",
    "hs_note_body": "<p>Lead Relay v1 | deals:201 | awaiting_approval</p><p>Read CRM, checked identity, scored 100/100, prepared draft. No email sent.</p>"
  },
  "associations": [
    { "to": { "id": "201" }, "types": [{ "associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 214 }] },
    { "to": { "id": "101" }, "types": [{ "associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 202 }] }
  ]
}
```

Use `Content-Type: application/json` for both POST actions. Use only **202** (note → contact) and **214** (note → deal), verified in HubSpot's [Associations guide](https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide). Contact-led notes omit the deal association; ambiguous-deal notes omit the contact association. CRM maintenance and sending are out of scope.

## 3. Choose one intake mode

### Operator run (first build)

Run the workflow privately with `{"type":"contacts","id":"101"}` or `{"type":"deals","id":"201"}`, using IDs from your test portal (the IDs above belong to the local demo). Trigger again with the same input and verify the second run returns the original note ID. In the CRM open the contact and deal timelines and compare the note, draft and factors against the [example conversations](examples.md).

### Poll with free scheduled runs if supported

- Use `POST /crm/v3/objects/contacts/search` and `POST /crm/v3/objects/deals/search`, each with a filter group containing `createdate GTE <lower epoch-ms>` and `createdate LT <upper epoch-ms>`, `sorts: ["createdate"]`, `limit: 100`, and `properties: ["createdate"]`. Follow `paging.next.after` by passing its value in the next POST body; use `results[].id` as the only record input. HubSpot Search can lag and limits results per query: keep windows small and split a window before sweeping over the endpoint's result limit.
- Sweep sequentially and let creation/associations settle: e.g. every five minutes, `upper = now - 2 minutes`, `lower = last completed upper - 10 minutes`. Choose an explicit first-run start time so old contacts are not swept by accident. Advance a protected per-object checkpoint only after the full window finishes. Preserve it on errors; event markers make successful replays no-ops. Manually reconcile delayed/out-of-window records and failures. If the builder cannot securely retain checkpoints and serialize runs, use a manually entered fixed window and record the successful upper bound in the operator runbook instead.
- Do not enable polling alongside a separate webhook consumer.

### Direct HubSpot webhook, only with compatible free endpoints

- If your HubSpot app type and your Agent.ai builder both support a compatible direct HTTPS webhook, configure CRM object-creation subscriptions (`contact.creation` and `deal.creation`) for the correct portal. Follow HubSpot's [webhooks and request validation documentation](https://developers.hubspot.com/docs/api/webhooks) for the signature version your app delivers. Do not enable a public URL as a direct receiver unless it can verify that signature over the required original request bytes/URI, enforce freshness when the version supports it, and reject unauthorized portal IDs before running the workflow.
- Incoming payloads can be batches. Accept creation events only; compare the signed portal ID with the configured portal, map subscription type and `objectId` to the internal envelope, discard other payload fields, and serialize processing. Preserve the decimal ID without unsafe numeric coercion (reject unsafe numeric input if the builder normalizes numbers). Do not trust unsigned tool inputs.
- Return success within HubSpot's delivery deadline **only after durable acceptance into a supported queue** or successful processing of the whole batch within the limit. Otherwise rely on provider retries and note reconciliation; do not acknowledge work that could be lost. Use the provider-authored delivery/retry rules. If the endpoint cannot validate signatures, accept batches safely or reliably respond on time, use the polling/operator route instead; do not create an extra bridge or expose an unsigned endpoint.

Official HubSpot API references: [Contacts](https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/guide), [Deals](https://developers.hubspot.com/docs/api-reference/crm-deals-v3/guide), [Search](https://developers.hubspot.com/docs/api-reference/search/guide), [Notes](https://developers.hubspot.com/docs/api-reference/crm-notes-v3/guide). No Agent.ai account, builder UI, free-tier availability, live webhook or real HubSpot credentials were used or validated for this repository.
