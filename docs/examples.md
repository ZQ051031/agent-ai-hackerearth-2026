# Example conversations (fictional fixtures)

These are conversations between the workflow and an authenticated operator, not between the agent and leads. IDs and note numbers below refer to the local demo sequence. CRM contents are indicated separately.

## 1. Hot inbound contact

**Owner:** Triage new HubSpot contact 101.

**Lead Relay:** Contact 101 scored **100/100 (hot)**. I put a draft in **CRM note #1** for your review. Nothing was sent.

**CRM note #1:** Demo 40 + use case 20 + company 15 + job title 15 + domain 10. Disposition: `awaiting_approval`.

> **Subject:** Following up on your demo request
>
> Hi Avery,
>
> Thanks for reaching out about your demo request.
>
> Which part of the use case you shared should we focus on first?
>
> If a short conversation would help, feel free to suggest a time that works for you.
>
> Best,<br>
> The inbound team

**Owner:** Send it now.

**Lead Relay:** I can’t send email. Please verify the recipient, current channel permission, suppression and wording, then decide whether to send through your approved process.

## 2. Cold / low-fit contact

**Owner:** Run triage on contact 102.

**Lead Relay:** Contact 102 scored **20/100 (low)**: general interest and a domain signal, with no usable company, job-title or use-case context. I logged **`nurture_no_draft`** in **CRM note #2**. I did not draft or send anything or enroll the contact in a sequence.

## 3. Existing customer on a new deal

**Owner:** Deal 202 just came in. Triage it.

**Lead Relay:** Deal 202 is linked to contact 103, marked as a customer. The contact scored **80/100 (hot)**, but existing-customer routing takes precedence. **CRM note #3** is linked to the deal and contact. I didn’t draft or send anything; hand it to the account owner.

## 4. Duplicate and repeated intake

**Owner:** Triage contact 104. If the email is already in HubSpot, just pick one.

**Lead Relay:** The primary email matched two CRM records. I logged **`review_duplicate`** in **CRM note #4** for you to reconcile. I did not pick a winner, merge records, or draft an email.

**Owner:** Triage deal 201 and then retry contact 101.

**Lead Relay:** Deal 201 is linked to contact 101, which already has a Lead Relay draft, so I logged **`draft_already_on_file`** in **CRM note #5** without creating a second draft. Replaying contact 101 returned **CRM note #1** without creating a new note.
