# Lead Relay — HackerEarth Agent.ai Challenge

**HubSpot Innovation track · Solo entry build kit**

Lead Relay turns a newly created HubSpot contact or deal into an explainable handoff. It enriches the record from existing CRM data, scores inbound intent and fit, checks identity and outreach eligibility, and saves an editable follow-up draft only for qualified leads. Every completed disposition is logged on the relevant HubSpot timeline, including why the agent did **not** draft. No email is sent. HubSpot Innovation is a fit because the agent connects contacts, deals, identity checks, and owner follow-up in one auditable workflow instead of leaving that work in a chat transcript or automating a risky send.

## Challenge and entry status

| Item | Challenge brief |
|---|---|
| Official page | [HackerEarth Agent.ai Challenge](https://www.hackerearth.com/agent-ai) |
| Dates | **16 Sep – 14 Dec 2026**; winners announced **19 Dec 2026** |
| Prizes | **$50,000 total**: HubSpot Innovation **$30,000 for the top 5 agents**; Marketing Mavericks **$20,000** |
| Eligibility | Free, global, 18+, **solo only**; build a no-code agent on Agent.ai |

**New entries are still accepted until 14 Dec 2026 according to the challenge brief, even though the official page already displays the Top 5 agents per track.** Use the official page's **Submit Now** link and verify you are in the intended challenge cycle before entering any details. If the destination presents a different cycle or the required Agent.ai builder is inaccessible, ask the organizers for the current links rather than submitting to another event or moving the agent to an unapproved platform.

This repository is the build kit and a local prototype, **not a live Agent.ai agent or a submitted entry**. Creating the agent on your account and registering and submitting on HackerEarth are **your steps**. No registration or submission was done.

## 1. Run the prototype (free, no accounts required)

Use Node.js **22 or newer**. There are no dependencies to install. From the repository root:

```sh
node --version
npm test
npm run demo
```

The demo starts an in-process HTTP mock bound to loopback and runs a six-event fixture through the same HTTP client used for the real HubSpot integration. Expect one personalized draft, low-fit, existing-customer and duplicate dispositions, one related-deal suppression, and one replay returning the first note. The five CRM notes are in memory and disappear when the process exits. Tests and demo never dial real HubSpot; they do not require or read your private app credential.

The real client in [src/hubspot.js](src/hubspot.js) defaults to HubSpot's API and reads `HUBSPOT_ACCESS_TOKEN`. Optional, **only after you provision and verify a test portal**: copy `.env.example` to `.env`, put your own scoped token there, and supply one test-record ID to the callable workflow. This creates a **real CRM note** but cannot send email. The following is an operator example, not a step required for the challenge demo:

```sh
cp .env.example .env
# Edit .env locally, then replace 123456 with your synthetic contact ID:
node --env-file=.env --input-type=module -e '
  import { HubSpotClient } from "./src/hubspot.js";
  import { createTriage } from "./src/triage.js";
  const { key, decision, noteId } = await createTriage(new HubSpotClient())({
    type: "contacts", id: process.argv[1]
  });
  console.log({ key, decision, noteId });
' 123456
```

Never commit `.env` or credentials. The local prototype handles discrete events, not background intake; the scheduler and webhook flows are specified for the platform build.

## 2. Recreate Lead Relay on Agent.ai (your account)

1. Open the Agent.ai builder from your account or the current organizer-provided link and create a **private**, no-code workflow named **Lead Relay**. During public-page checks, the bare `agent.ai` URL redirected away from the Agent.ai builder. If you see a redirect and cannot access your builder, get the current Agent.ai build link from the organizers; do not treat a replacement platform as equivalent. Skip any paid feature or upgrade.
2. Read the [blueprint](docs/blueprint.md) and create the three custom contact fields in your test HubSpot portal. Prepare authorized synthetic contacts/deals and confirm the outreach/status fields before using live HTTP actions.
3. Add typed record-ID inputs, the fixed CRM read/search/note actions, deterministic guards and branches from the [workflow specification](docs/agent-ai-build.md). Keep secrets in protected credential/connection storage and keep CRM access private. Implement score and routing in no-code logic, not in the model. Paste the [agent system prompt](docs/prompts.md) into the agent instructions and map the exact deterministic draft template. A free constrained generation action is optional.
4. Run as the authenticated operator with test fixture IDs. Check the contact timeline, the shared deal/contact note, approval-only behavior, duplicate handling and replay. Compare to the [example conversations](docs/examples.md). Add **one** intake option (scheduled search or verified webhook) only if your free builder meets its stated safety and delivery requirements; retain manual intake otherwise.
5. Prepare a public demo configuration of the same workflow with a synthetic fixture mode: map fixture IDs to static object, association, search and note-history values in builder branches; route writes to a simulated note output. Keep the scoring, decision and draft actions the same. For the replay scenario, seed the existing synthetic note in the fixture history. Do not expose private tokens, live CRM data or any credentialed live writes. Test the public Agent.ai URL using only fictional inputs before submission and disclose that this mode simulates the CRM side effects. Use the private test run or local recording to show linked CRM write behavior. If the builder cannot provide safe public access or the required link, confirm what the organizers accept instead of exposing the private agent.

## 3. Register and submit (your steps; by 14 Dec 2026)

1. Visit the [official challenge page](https://www.hackerearth.com/agent-ai) and follow **Submit Now** to the HackerEarth challenge portal. Verify it matches the event cycle above. Sign in or create your free HackerEarth account, register as an eligible solo participant and select **HubSpot Innovation** when prompted. Do not pay for access.
2. Once your no-code workflow is assembled under your own Agent.ai account, copy its shareable Agent.ai URL. Check it can be opened by reviewers and that no live CRM data or secrets are exposed.
3. In the event's submission form, enter the public agent URL and complete the requested fields. Use the title **Lead Relay**, the summary above and the repository link. Include the short demo overview/recording if requested or supported. Follow the current form instructions for any additional required fields.
4. Submit **before 14 Dec 2026** rather than waiting for the closing hour, and keep the confirmation. If the portal is gated, mislabeled or unavailable, contact the organizers through the challenge page before the deadline. Winners are announced **19 Dec 2026**.

## Demo script (4:20)

| Time | Show / say |
|---|---|
| 0:00–0:40 | “A contact or deal arrives in HubSpot. Lead Relay checks fit, identity and permission before the owner sees a draft.” Show the Agent.ai branches if assembled, or the workflow diagram if demonstrating the build kit. |
| 0:40–1:40 | Run `npm run demo`. Show Avery's 100/100 disposition, subject and draft. Explain the 40/20/15/15/10 signal breakdown and point to note #1. |
| 1:40–2:30 | Show the low-fit, existing-customer and duplicate cases. Explain why even a high score cannot override an existing relationship. |
| 2:30–3:15 | Show that note #5 links deal 201 and contact 101 without adding a draft. Replay returns note #1; five notes for six events. |
| 3:15–4:20 | Walk through the owner approval/suppression check and the no-send boundary. Distinguish the loopback mock from the private Agent.ai + HubSpot build; close on the linked audit trail and the time saved on human triage. |

[Blueprint](docs/blueprint.md) · [Agent.ai tool and webhook specification](docs/agent-ai-build.md) · [Prompts and template](docs/prompts.md) · [Sample conversations](docs/examples.md)
