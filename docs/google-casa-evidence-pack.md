# Google OAuth Restricted-Scope Verification & CASA Evidence Pack

**Status:** draft evidence, not submitted. Owner: whoever holds compliance/security review for this org (spec §20 risk register, "High" severity — see [`architecture/SEMA_CALENDAR_MAIL_SPEC.md`](../architecture/SEMA_CALENDAR_MAIL_SPEC.md) §7.3, §20).

This is Phase 3 slice 11 (see [`plans/sema-p3-s11-google-casa-verification-prep.md`](../plans/sema-p3-s11-google-casa-verification-prep.md)) — process/paperwork, not code, with its own external lead time. This document collects the evidence an engineer can ground from the actual codebase; it is a **starting draft for the compliance owner**, not a substitute for their review or for actually submitting anything to Google/Microsoft.

**Do not treat this slice as done until Google's verification/CASA assessment evidence is actually submitted and, ideally, provisionally accepted** — spec's Phase 3 exit gate requires the requirement *satisfied*, not "documentation written." If this slips, spec's own contingency (§20) is a Microsoft-only beta scope by explicit CTO decision.

## 1. Why this is on the critical path

Spec §7.3: *"Gmail restricted scopes are a programme dependency. The product plan shall treat Google verification and CASA security assessment as a critical path item from Phase 1. Phase 3 beta cannot start until assessment requirements for intended Gmail restricted scopes are satisfied, or the beta is limited to non-Gmail/Microsoft-only scope by explicit CTO decision."*

Google's restricted-scope verification + CASA (Cloud Application Security Assessment) process is not instantaneous — REF-04/REF-05 in the spec's reference table point at Google's own production-readiness and CASA documentation. Starting the paperwork only once Phase 3 is "otherwise done" would make this a late, unplanned blocker; that is the mistake this slice exists to prevent.

## 2. Scopes actually requested by this codebase today

Grounded directly in `server/app/connect/provider_connections/adapters/*.py` — not a guess:

| Provider | Scope string (as requested today) | Classification | Where in code |
|---|---|---|---|
| Google Calendar | `openid email https://www.googleapis.com/auth/calendar.readonly` | Non-restricted (calendar) | `adapters/google.py` |
| Gmail | `openid email https://www.googleapis.com/auth/gmail.readonly` | **Restricted** | `adapters/gmail.py` |
| Microsoft Calendar | `offline_access Calendars.Read User.Read` | Microsoft equivalent (publisher verification track) | `adapters/outlook.py` |
| Microsoft Mail | `offline_access Mail.Read User.Read` | Microsoft equivalent (publisher verification track) | `adapters/outlook_mail.py` |

**Not yet requested, but implemented and waiting on this evidence pack landing first:** `gmail.send` (Gmail) and `Mail.Send` (Microsoft Graph). Phase 3 slice 9 (`server/app/connect/mail_service/send.py`, `adapters/gmail.py::send_message`, `adapters/outlook_mail.py::send_message`) built the send capability but deliberately did **not** widen `build_authorization_url`'s scope string — each adapter's `send_message` docstring flags that an existing read-only connection will 403 until the user reconnects with the wider scope, and that widening the consent flow is a follow-up gated on this evidence pack, not a silent scope creep. When this pack is submitted, it should cover `gmail.send` and `Mail.Send` alongside `gmail.readonly`/`Mail.Read` so a second verification round isn't needed later.

Per spec's own scope-minimization principle (§20 risk control: "scope minimisation"), only `gmail.readonly` is live today; `gmail.send` stays un-requested in the OAuth flow until this evidence pack clears.

## 3. Scope justification narrative (draft, for Google's verification form)

> Zoiko Meet ("ZoikoSema") is a workspace product combining video meetings, chat, calendar, and (this feature) unified mail. `gmail.readonly` is used to sync a user's own mailbox metadata and (once Phase 3 slice 4 lands) message content into a unified inbox view inside the product, so a user can read and search their mail alongside their calendar and chat without switching tools. `gmail.send` (not yet requested — see §2) will be used only for user-initiated sends: composing, replying to, and forwarding messages the user authored themselves, including AI-drafted replies the user reviews and approves before send (spec's governed L1/L2/L3 autonomy model — see `architecture/SEMA_CALENDAR_MAIL_SPEC.md` §4). No bulk-export, no third-party resale of mail content, no automated mass-sending.

This paragraph is a starting draft only — the compliance owner should verify it against Google's actual current verification form fields (REF-03/REF-04 in the spec) before submission, since Google's form structure changes independently of this document.

## 4. Security assessment questionnaire — grounded answers

Google's CASA questionnaire asks about data handling, storage, and access controls. Real, current answers, not aspirational ones:

| Question area | Current state | Source |
|---|---|---|
| Encryption at rest for OAuth tokens | Fernet envelope encryption (`app/connect/shared/crypto.py`), keyed by `TOKEN_VAULT_KEY`. **Gap, already flagged internally:** this is a Phase 1 stopgap; spec §7.4 wants HSM/KMS-backed vault as the end state. Must be disclosed as a gap with a hardening plan, not omitted. | `architecture/SEMA_CALENDAR_MAIL_CONTEXT.md` §5 |
| Tenant isolation | Every `connect_*` table enforces `tenant_id` at both the application layer (`TenantContext.require()`) and Postgres RLS (`current_setting('app.tenant_id')`). | `app/connect/shared/tenant.py`, `migrations/connect_v3_*.sql` |
| Audit logging of access/mutation | Append-only audit ledger (`app/connect/audit/`), DB-trigger-enforced immutability, every mutation logs actor/resource/metadata in the same transaction. | `app/connect/audit/service.py` |
| Outbound data-loss prevention | **Not yet implemented** (Phase 3 slice 6, DLP MVP, is still blocked on slice 4/5 landing as of this writing). Mail send (slice 9) has a DLP preflight call-site (`mail_service/send.py::check_outbound_dlp`) that is currently a stub returning "pass" — this must be disclosed honestly in the assessment, not glossed over, and the assessment timeline should account for slice 6 landing before Gmail send scope goes to production traffic. | `app/connect/mail_service/send.py` |
| Data retention / deletion on disconnect | `disconnect_provider()` purges the encrypted refresh/access token immediately; synced mail/calendar rows are not currently purged on disconnect (open question — flag to compliance owner: does Google's assessment require synced-content deletion on revoke, not just token deletion?). | `app/connect/provider_connections/service.py::disconnect_provider` |
| Least-privilege scope requests | Only `gmail.readonly` is requested today; `gmail.send` is deliberately withheld from the OAuth consent flow until this evidence pack clears (see §2). | `adapters/gmail.py` |
| Incident response / token compromise | Spec §20 names this a "Critical" risk with a stated control plan (HSM/KMS vault, least-privilege token access, anomaly detection, rapid revocation, blast-radius report) — **not yet built**; disclose as a planned control, not a present one. | `architecture/SEMA_CALENDAR_MAIL_SPEC.md` §20 |

**Honesty note for whoever submits this:** Google's CASA process penalizes assessments that describe aspirational controls as if they were live. The gaps above (HSM/KMS vault, DLP, incident response tooling) are real and should be presented as a dated roadmap, not backfilled with vague language.

## 5. Privacy policy requirement

Google's restricted-scope verification requires a published, publicly accessible privacy policy describing what user data is accessed and how it's used (REF-03). **Gap: this repository has no dedicated privacy policy document or page today** — a repo-wide search turned up only scattered references (`client/src/pages/Register.jsx`, `AccountSettings.jsx`, `architecture/SPEC.md`) but no actual privacy policy content or route. This needs a real legal/product-owned document before submission, not an engineering-authored one — flagging as an explicit open item rather than drafting placeholder legal text here.

## 6. Microsoft-side equivalent (lighter, but still real)

Per spec §7.3/§18: Microsoft's process is publisher verification + tenant admin consent documentation, not a CASA-equivalent security assessment. Current scopes (`Calendars.Read`, `Mail.Read`, `User.Read`, `offline_access` — see §2 table) are all delegated, non-admin-consent-only scopes already in the "lighter" tier. `Mail.Send` (once the slice 9 scope widening lands) stays in the same tier — no incremental Microsoft-side review category change expected, but this should be confirmed against Microsoft's current publisher-verification requirements at submission time (they change independently of this document, same caveat as §3).

## 7. Contingency (spec §20)

If Google's verification/CASA process is not complete by the time Phase 3 beta would otherwise start, spec's own risk control is explicit: **Microsoft-only beta scope by explicit CTO decision**, not a silent scope cut. Track this as a real fallback plan, not a fallback that quietly becomes permanent without that decision being made explicitly.

## 8. Next steps (for the compliance/security owner, not engineering)

1. Verify the scope justification narrative (§3) and questionnaire answers (§4) against Google's current, live verification form — this document is a snapshot as of the code that exists today, not a live sync with Google's requirements.
2. Get a real privacy policy published (§5) — currently blocking, no placeholder exists.
3. Decide whether `gmail.send`/`Mail.Send` should be requested in the same verification round as `gmail.readonly`/`Mail.Read` (recommended, to avoid a second review cycle) — see §2.
4. Submit to Google; track REF-05's annual revalidation requirement once (if) provisionally accepted.
5. Start the lighter Microsoft publisher-verification track in parallel (§6) — it does not block on Google's process or vice versa.
6. Revisit §4's DLP gap once Phase 3 slice 6 actually lands — the assessment should reflect real state at submission time, not this document's snapshot.
