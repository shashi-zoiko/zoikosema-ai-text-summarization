ZOIKO SEMA  |  Governed Agentic Communications




Sema Calendar & Mail
Engineering Specification
Version 1.1 — Consolidated Build Specification
Prepared for Engineering, Security, Product Design, Product Management, and Enterprise Procurement
Category Statement
Zoom, Teams, and Google give customers calendars and inboxes. Sema gives governed agents that can act on calendars and inboxes at an autonomy level the organisation sets, with every action traceable, reviewable, policy-bound, and reversible where the underlying medium permits.

Field	Value
Product	Zoiko Sema — Governed Agentic Communications
Document owner	Office of the Founder / CTO
Engineering owner	Zoiko Tech Inc — Platform Engineering
Primary audience	Engineering, Security, Product Design, Product Management, QA, Compliance
Status	Approved for build planning; implementation requires phase-gate sign-off
Classification	Internal — Zoiko Tech Inc
Date	8 July 2026

This document supersedes the baseline response and incorporates the CTO/product review supplied by the Founder. It corrects standards-sensitive claims where official sources differ and converts the direction into a build-grade specification with phase gates, security controls, acceptance criteria, and explicit non-goals.

Table of Contents
• 0. Executive Lock Statement
• 1. Scope, Non-Goals, and Product Doctrine
• 2. System Context and Reference Architecture
• 3. The Sema Work Graph
• 4. Autonomy Model for Calendar and Mail
• 5. Action Review, Rollback, and Reasoning Trace
• 6. ZoikoTime and Zoiko One Integration
• 7. Provider Integration Architecture
• 8. Sync Engine, Data Lifecycle, and Observability
• 9. Confidentiality, Encryption, and Privacy Guarantees
• 10. Security, Compliance, and Governance Controls
• 11. Service Architecture
• 12. API, Data, and Event Contracts
• 13. AI Orchestration and Agent Safety
• 14. Admin Console Requirements
• 15. User Experience and Design System Requirements
• 16. Packaging, Entitlements, and Commercial Controls
• 17. Build / Integrate / Defer Decisions
• 18. Roadmap, Phase Gates, and Exit Criteria
• 19. QA, Security Testing, and Acceptance Criteria
• 20. Risk Register and Control Plan
• 21. Decision Register
• Appendices A-D: Schemas, Scope Matrix, Standards References, Corrections Register

0. Executive Lock Statement
Zoiko Sema shall incorporate Calendar and Mail as governed agent-action categories, not as standalone productivity apps. Calendar and Mail are high-impact surfaces because agents can alter time, commitments, recipients, records, and external communications. They therefore enter Sema through the same governance spine as meetings, messaging, calls, summaries, and future agentic actions: autonomy levels, policy versioning, reasoning traces, review queues, DLP, audit ledger, rollback affordances, and MCP-mediated tool access.
The approved sequencing remains: integrate before hosting. Sema shall first integrate external calendars, then deliver native Sema Calendar, then Mail Connect, then shared mail workflows, and only then evaluate hosted Zoiko Mail under a strict enterprise-demand gate. Hosted email is not a feature extension; it is an operational security and deliverability business.
Decision	Locked Position
Strategic frame	Governed agentic action over calendar and inbox, not Zoom/Google feature imitation.
First build priority	Calendar integration and Sema Meet scheduling.
Second build priority	Native Sema Calendar with ZoikoTime-aware scheduling.
Third build priority	Mail Connect with Google and Microsoft integration, Action Review, DLP, and delayed send.
Hosted mail	Conditional Phase 5 only; gated by signed enterprise demand and staffed abuse/deliverability operations.
Differentiator	The Sema Work Graph plus ZoikoTime workforce truth.
Non-negotiable control	No agent action without policy evaluation, trace, audit event, and rollback semantics appropriate to the medium.

1. Scope, Non-Goals, and Product Doctrine
1.1 Scope
• Calendar integration with Google Calendar and Microsoft 365 / Outlook Calendar.
• Native Sema Calendar, including personal, team, resource, roster-derived, and meeting-native calendars.
• Mail Connect for Gmail and Microsoft 365 / Outlook mail, with send/reply/forward, search, AI summaries, AI drafts, and governed conversions into meetings, channels, tasks, and notes.
• Shared mailboxes and delegated access where they reinforce collaboration and governance.
• Agentic controls across calendar and mail: autonomy ceilings, review queue, reasoning trace, DLP, audit, rollback, and policy versioning.
• Admin Console surfaces for mail, calendar, security, audit, MCP tools, data residency, retention, and legal hold.
1.2 Explicit Non-Goals
• Sema shall not become a helpdesk, CRM, billing inbox product, or Zendesk/Front clone. Assignment and shared inbox primitives are allowed; ticketing/SLA productisation is not.
• Sema shall not host customer email in Phase 1-4.
• Sema shall not represent connected Gmail or Outlook content as end-to-end encrypted by Sema.
• Sema shall not use third-party sync middleware that stores tenant mail plaintext outside Zoiko governance unless the Founder/CTO explicitly accepts the procurement and data-risk trade-off.
• Sema shall not ship autonomous send or autonomous scheduling without DLP, policy evaluation, audit capture, and rollback/delayed-send semantics.
1.3 Doctrine
Every feature must satisfy at least one of three tests: it makes an agent action possible, it makes an agent action governable, or it supplies the minimum substrate required for either. Incumbent feature parity is not a sufficient reason to build.
2. System Context and Reference Architecture
Sema Calendar and Mail sit inside the Zoiko ecosystem. Identity, tenancy, licensing, user lifecycle, and cross-product navigation are inherited from Zoiko One. Workforce truth is inherited from ZoikoTime. Meetings, calls, messaging, notes, and AI summaries remain first-class Sema surfaces. Calendar and Mail add two action-heavy domains to the same governed workspace.
Layer	System Component	Responsibility
User surface	Sema Calendar, Inbox, Event Composer, Mail Composer, Review Queue	End-user interaction, approvals, edits, scheduling, drafting, visibility of governance status.
Agent surface	Sema AI, governed MCP tools, Action Review Service	Agent proposals, preparations, bounded execution, tool access, policy-aware automation.
Governance spine	Policy Engine, Audit Ledger, DLP, Settings History, RBAC	Every action is evaluated, versioned, traceable, and auditable.
Data substrate	Work Graph, Search Index, Event Store, Token Vault, Object Storage	Typed relationships, provider references, secure token storage, content indexing, object references.
Provider edge	Google Workspace, Microsoft 365, CalDAV/IMAP fallback, SMTP submission	External interoperability and connected-account sync.
Enterprise control	Data residency, BYOK, legal hold, e-discovery, MCP registry	Procurement-grade enterprise controls and compliance evidence.

Architecture Rule
Calendar and Mail must not create a second identity plane, a second policy engine, a second audit system, or a second AI permission model. Duplication is an architectural defect.

3. The Sema Work Graph
The Work Graph is the typed, policy-filtered substrate agents operate over. It is not an analytics afterthought. It is the authoritative relationship model for people, organisations, messages, email, calendar events, meetings, summaries, tasks, files, policies, and agent actions.
3.1 Initial Node Types
Node	Required Attributes	Notes
Person	identity_id, tenant_id, display_name, email_aliases, ZoikoTime_worker_id, external_flag, status	Maps to Zoiko One and ZoikoTime.
Organisation	org_id, domains, relationship_type, risk_class, tenant_relationship	Customer, vendor, internal, partner, regulator, unknown.
Message	message_id, channel_id, thread_ref, sender_id, timestamps, confidentiality_class	Sema messaging surface.
Email	email_id, rfc5322_message_id, provider_ref, mailbox_ref, subject_hash, sender, recipients, confidentiality_class, provider_state	Connected mail stores provider refs and permissible indexed content only.
CalendarEvent	event_id, provider_ref, title, time_range, timezone, RRULE, attendees, resources, confidentiality_class, version_chain_id	Native events use Sema authority; connected events preserve provider authority.
Meeting	meeting_id, sema_meet_ref, transcript_ref, recording_ref, participants, policy_flags	Links calendar to live/recorded collaboration.
AISummary	summary_id, source_refs, model_id, model_version, prompt_policy_version, autonomy_level, generated_at	Captures policy and model state at generation.
Task	task_id, owner_id, due_date, status, source_node_ref, priority	Task may be human or agent-created.
File	file_id, storage_ref, owner_id, DLP_classification, retention_class	Content storage remains separate from graph metadata.
AgentAction	action_id, category, autonomy_level, action_type, policy_version, reasoning_trace_ref, rollback_state, executed_by	Mandatory for every agent mutation.
PolicyVersion	policy_id, version, effective_at, author, diff_ref, scope	Every evaluated action links to policy version.

3.2 Edge Discipline
Edges are typed and immutable unless explicitly superseded. Every AgentAction must link to the agent identity, policy version in force, reasoning trace, affected nodes, reviewed-by principal where applicable, DLP verdicts, and rollback object where applicable.
Edge Type	From	To	Purpose
sent_by	Email / Message	Person	Sender attribution and audit.
attendee_of	Person	CalendarEvent / Meeting	Scheduling and participation.
derived_from	AISummary / Task / Email Draft	Email / Meeting / Message / File	Lineage and provenance.
follows_up	Task / Email / CalendarEvent	Meeting / Email / Message	Commitment chain.
governed_by	AgentAction / Object	PolicyVersion	Point-in-time policy evidence.
executed_by_agent	AgentAction	Agent Identity	Attribution and accountability.
mutated	AgentAction	CalendarEvent / Email Draft / Task	Blast-radius analysis.
reviewed_by	AgentAction	Person	Human approval evidence.
blocked_by	AgentAction	PolicyVersion / DLP Verdict	Explainable denial.

3.3 Query and Access Rules
• Graph queries are policy-filtered before reaching AI orchestration.
• Cryptographically inaccessible content never appears in server-side graph search because Zoiko infrastructure has no plaintext.
• Policy-excluded content appears only to principals and services admitted by the active policy version.
• Audit Ledger references graph nodes by immutable identifiers; mutable display names are never the audit key.
• Every query that includes connected-account mail or calendar data must record purpose, principal, scope, and policy basis in telemetry.
4. Autonomy Model for Calendar and Mail
The five-level autonomy model applies with per-category overrides. A tenant may set Calendar to L4 and Mail to L2, or vice versa. Administrators set organisation ceilings; users may lower but never raise their effective level above the tenant ceiling.
Level	Calendar Semantics	Mail Semantics	Control Requirement
L0 — Observe	Read/index events for context only.	Read/index mail for context only.	No mutation. Policy-filtered context only.
L1 — Suggest	Suggest times, agendas, attendees, and conflicts. Human creates.	Suggest summaries and draft language. Human sends.	Displayed as recommendation; no staged mutation.
L2 — Prepare	Stage a complete event proposal in Action Review Queue.	Stage send-ready draft in Action Review Queue.	Human approval required before mutation.
L3 — Execute with Review Window	Create/move/decline events within policy; rollback through event version chain.	Send within policy using delayed-send buffer before external delivery.	Policy, DLP, trace, audit, and rollback window required.
L4 — Autonomous within Bounds	Full scheduling authority within scoped bounds: domains, working hours, resource caps, ZoikoTime constraints.	Autonomous send within allowlist/domain scope, DLP class, volume cap, and recipient rules.	Continuous monitoring, incident brake, and admin controls required.

4.1 Effective Autonomy Resolution
The effective autonomy level is the minimum of: tenant category ceiling, workspace policy, user preference, sensitivity class limit, recipient/domain risk policy, DLP verdict, MCP server ceiling where tool-mediated, and incident brake state. The engine must compute this deterministically and log the resolved inputs.
4.2 Category-Specific Policy Inputs
Policy Input	Calendar Application	Mail Application
Domain scope	External guests, allowed domains, regulator/vendor domains.	Recipient allowlist/denylist, external warnings, domain risk.
Working-time rules	Working hours, ZoikoTime shift, rest window, OOO, holidays.	Send-time scheduling and after-hours warning.
Sensitivity class	Confidential title handling, meeting access, AI summary rules.	DLP class, AI exclusion, attachment restrictions.
Volume/cost caps	Room cost, catering, paid resources, external API quotas.	Daily agent send volume, API quota budget, deliverability risk caps.
Human review	Required for sensitive attendees, resource costs, policy exceptions.	Required for sensitive content, external recipients, high-volume sends.

5. Action Review, Rollback, and Reasoning Trace
5.1 Action Review Queue
Sema shall provide one cross-category Action Review Queue for calendar, mail, messaging, spend, and future agent actions. Queue fragmentation is prohibited because it hides risk from administrators and reviewers.
Queue Item Field	Requirement
Proposed action	Plain-language description and machine-readable action payload.
Reasoning trace	Concise agent rationale, source graph nodes, prompt/tool chain, model/version, confidence and uncertainty markers.
Policy verdicts	Pass/fail/warn status for autonomy, DLP, retention, recipient, resource, ZoikoTime, and spend policies.
Blast radius	Recipients, attendees, resources, customers, external domains, files, and graph nodes affected.
Rollback semantics	Exact action available: cancel buffered send, restore event version, tombstone internal message, or no post-delivery rollback.
Human controls	Approve, edit, reject, request re-draft, lower autonomy, escalate to admin.
SLA metrics	Age, reviewer queue, approval latency, rejection rate, policy-block rate.

5.2 Rollback Semantics
Action Type	Rollback Requirement	User-Facing Label
External email send	Cancelable only while delayed-send buffer has not expired. No false recall after provider delivery.	Cancel send before delivery.
Internal Zoiko-to-Zoiko mail	Message tombstoning/recall possible where message remains under Zoiko authority.	Recall internal message.
Calendar event create/update/delete	Version chain restores prior state and emits required iTIP/iMIP updates.	Restore previous event version.
AI summary generation	Delete or supersede summary; source records remain unchanged.	Remove or replace summary.
Task creation/update	Restore previous task version or delete task if newly created.	Undo task change.

5.3 Delayed-Send Buffer
Default external delayed-send buffer is 5 minutes. Admin range is 0-30 minutes. L3/L4 external agent send requires a non-zero buffer unless tenant policy explicitly accepts zero-buffer send for a defined domain or allowlist. Buffer expiry is an irreversible delivery threshold for external recipients.
5.4 Reasoning Trace Standard
• Reasoning traces must be reviewable without exposing private chain-of-thought. They show decision factors, policy checks, source references, tool calls, and final action rationale.
• Each trace is immutable after execution and linked to the AgentAction node.
• Sensitive source snippets are redacted according to the reviewer’s access rights.
• Trace export is available to Enterprise audit roles with role-appropriate redaction.
6. ZoikoTime and Zoiko One Integration
6.1 ZoikoTime Scheduling Differentiator
Free/busy is table stakes. Sema scheduling shall read workforce truth from ZoikoTime and enforce it as a hard constraint where tenant policy requires. This is the strategic differentiator versus standalone calendar products.
ZoikoTime Input	Scheduling Behaviour
Shift schedules	Scheduling assistant shall not propose off-shift meetings unless policy allows override.
Approved leave and OOO	Marked unavailable and protected from autonomous booking.
Rest-period rules	L3/L4 agents cannot book slots that violate rest windows.
Maximum consecutive scheduled hours	Constraint solver rejects overload schedules and explains rejection.
Rosters and teams	Team calendars and availability groups auto-populate from ZoikoTime rosters.
Presence signals	Presence = calendar state × ZoikoTime state; ZoikoTime wins where workforce status conflicts.

6.2 Zoiko One Identity and Licensing
• Zoiko One remains the identity, tenant, licensing, entitlement, and cross-product navigation authority.
• No independent mailbox/calendar identity plane is permitted.
• SCIM provisioning and deprovisioning must flow through Zoiko One and immediately affect mail/calendar access grants.
• Per-tier entitlements are evaluated at the Zoiko One licensing layer and enforced by Sema policy services.
7. Provider Integration Architecture
7.1 Calendar Providers
Provider	Mechanism	Build Requirement
Google Calendar	Google Calendar API; incremental sync tokens; push notification channels.	Renew watch channels before expiry; if syncToken receives 410 Gone, clear local state for that scope and perform full resync.
Microsoft 365 / Outlook	Microsoft Graph delta queries; change notifications; immutable IDs.	Renew subscriptions before expiry. Current documentation lists Outlook message/event/contact subscription maximums under seven days; rich notifications are under one day.
CalDAV / Apple / Generic	CalDAV after Phase 2.	Adapter interface only until a customer requirement justifies shipping.
External invite interop	RFC 5545 iCalendar, RFC 5546 iTIP, RFC 6047 iMIP.	Mandatory for external scheduling. Non-Sema attendees receive standards-compliant iMIP email invites.

7.2 Mail Providers
Provider	Mechanism	Build Requirement
Gmail	Gmail API; history.list incremental sync; Pub/Sub push where applicable.	Restricted scopes require Google OAuth restricted-scope verification and security assessment if restricted data is stored/transmitted by Zoiko servers.
Microsoft 365 / Outlook Mail	Microsoft Graph Mail delta and change notifications.	Publisher verification, tenant admin consent, delta reconciliation, immutable IDs.
Generic IMAP	IMAP with XOAUTH2 where available.	Fallback only; no basic-auth dependency for major providers.
JMAP	RFC 8620/8621 adapter interface.	Optional adapter, not a launch dependency. Ship only when customer/provider demand warrants.
SMTP Submission	RFC 6409 where API send is unavailable.	Use authenticated submission with policy/DLP preflight; avoid open relay architecture.

7.3 Google Verification and CASA Gate
Gmail restricted scopes are a programme dependency. The product plan shall treat Google verification and CASA security assessment as a critical path item from Phase 1. Phase 3 beta cannot start until assessment requirements for intended Gmail restricted scopes are satisfied, or the beta is limited to non-Gmail/Microsoft-only scope by explicit CTO decision.
7.4 Token Vault Requirements
• OAuth refresh tokens are crown-jewel assets and must be stored in an HSM/KMS-backed token vault with per-tenant envelope encryption.
• Token access is service-to-service authorised, short-lived, purpose-bound, and audited.
• Token use must be correlated to sync jobs, user actions, agent actions, or admin maintenance jobs.
• Credential revocation, provider disconnect, user deprovisioning, and tenant offboarding must revoke provider tokens and purge derived data under policy.
8. Sync Engine, Data Lifecycle, and Observability
8.1 Sync Engine
The sync engine shall be provider-agnostic with provider-specific adapters. Connected-provider records are provider-authoritative. Native Sema objects are Sema-authoritative. All mutations must be idempotent, retryable, observable, and traceable to the initiating principal or agent.
Capability	Requirement
Initial backfill	Newest-first stream with user-visible progress; rate-limited per tenant and provider quota.
Incremental sync	Push-first; poll fallback. Tokens/checkpoints stored per mailbox/calendar and per folder/resource where required.
Conflict resolution	Provider-authoritative for connected accounts; Sema-authoritative for native objects; conflicts produce visible resolution events.
Idempotency	Provider immutable IDs plus Sema idempotency keys; no duplicate sends or duplicate event mutations.
Poison handling	Malformed provider payloads enter quarantine with alerting, not silent drop.
Reconciliation	Daily diff sweep; no silent data loss. Diff-alerting required for material drift.
Quota budgeting	Per-tenant API quota budgets treated as spend-like controls with alerting at 80% and hard policy options.

8.2 SLOs
Metric	Target	Measurement
Inbox/event freshness under push	P95 < 60 seconds	Provider change timestamp to Sema visible timestamp.
Inbox/event freshness under polling fallback	P95 < 5 minutes	Poll cycle plus processing latency.
Duplicate outbound send	0 tolerated	Idempotency audit and provider-send reconciliation.
Silent data loss	0 tolerated	Daily reconciliation and diff-alerting.
Review queue availability	99.9% for Business+; Enterprise SLO by contract	Service health and synthetic approvals.
Audit capture completeness	100% for governed actions	Action-to-audit reconciliation.

8.3 Observability
• Metrics: sync lag, provider error rate, webhook expiry, renewal success, quota burn, DLP blocks, delayed-send cancellations, policy-denial rates, queue latency.
• Logs: structured, tenant-scoped, PII-minimised, retention-controlled, and queryable by incident role.
• Traces: provider API calls, policy evaluation, DLP decision, agent action, review transition, rollback execution.
• Alerts: webhook/channel renewal failure, sync drift, token vault anomaly, outbound send spike, DLP system unavailable, audit ledger write failure.
9. Confidentiality, Encryption, and Privacy Guarantees
9.1 Two Guarantees That Must Never Be Confused
Guarantee	Meaning	Applies To	Product Language
Cryptographically inaccessible	Client-side encrypted with keys unavailable to Zoiko infrastructure, tenant admins, and Sema AI.	Confidential channels/DMs; Confidential meetings; future Zoiko-to-Zoiko internal mail under Phase 5.	Confidential Mode / end-to-end encrypted where verified.
Policy-excluded	Plaintext may exist in Zoiko infrastructure or external provider, but is excluded from AI/search/export/retention by enforced policy.	Connected Gmail/Outlook mail; external calendar data; most provider-connected content.	AI-Excluded or Policy-Protected. Not E2EE.

9.2 Hard Rules
• Connected Gmail/Outlook mail must never be labelled end-to-end encrypted by Sema.
• Policy-Protected and AI-Excluded controls require distinct iconography from cryptographic Confidential Mode.
• Confidential external calendar invites must use placeholder titles externally where true details should not leave Sema. The UI must disclose that protocol metadata such as time, organiser, and attendee routing can leave Sema.
• Cryptographically inaccessible content has no server-side plaintext path and is absent from server-side AI context and e-discovery by construction.
• Policy-excluded content reaches AI orchestration only if the active tenant policy affirmatively admits it, and the admitting policy version is recorded on the AISummary node.
9.3 Data Protection
Control	Requirement
Transport	TLS 1.3 for service and client traffic where supported; provider API TLS required.
At-rest encryption	AES-256 or cloud-provider equivalent; per-tenant envelope encryption.
Enterprise keys	BYOK available for Enterprise; key disablement produces defined tenant lockout workflow.
Data residency	Tenant-level region-pinned storage and processing from Phase 1 architecture.
Search index	Policy-filtered index; cryptographic content indexed client-side only where supported.
Attachment storage	Object storage references only in graph; malware verdict and DLP class recorded separately.

10. Security, Compliance, and Governance Controls
10.1 Identity and Access
• OAuth 2.0 with granular, minimum-necessary scopes per provider.
• Tenant-level admin consent for Microsoft 365 and Google Workspace enterprise tenants.
• SSO through SAML/OIDC, SCIM lifecycle provisioning, and MFA policy enforcement.
• Admin roles require stronger authentication posture; Enterprise supports AAL3-aligned administrative controls.
• Delegated access is represented as graph edges and audit events, not hidden provider-only state.
10.2 Mail Threat Surface
Threat Area	Control Requirement
HTML rendering	Sandboxed rendering pipeline; sanitisation allowlist; no script execution; strict CSP; no graph write access from renderer.
Remote images	Proxy through Zoiko image proxy with tracker stripping and IP protection; user/admin policy controls.
Attachments	Malware scanning and detonation vendor integration before preview/download where policy requires.
Links	Link rewriting with time-of-click reputation checks for applicable tiers.
Phishing	Suspicious sender/domain warnings; lookalike domain detection; external recipient warnings.
Outbound leakage	DLP preflight on user-composed and agent-composed content before send. DLP unavailability fails closed for governed sends.
Token compromise	Token vault anomaly detection, rapid revocation, blast-radius report, forced provider reconnect where required.

10.3 Audit and Records
• Audit Ledger is append-only and covers admin actions, user actions on governed objects, provider connection events, all AgentActions, and rollback events.
• Settings history is a SOC 2 asset: every policy change is versioned, diffable, attributable, exportable, and queryable as-of a date.
• Retention and legal hold apply to native content and eligible connected-content indexes within provider and legal constraints.
• E-discovery exports must use standard formats and include policy-version context and audit references.
10.4 Hosted Mail Addendum — Phase 5 Only
Hosted Zoiko Mail shall implement SPF, DKIM, and DMARC according to the current DMARC standards-track split: RFC 9989 core, RFC 9990 aggregate reporting, and RFC 9991 failure reporting, which obsolete RFC 7489. Generated records must exclude deprecated DMARC tags where the current standard excludes them and must implement current organisational-domain discovery requirements. Hosted mail also requires deliverability monitoring, bounce handling, feedback-loop processing, outbound rate limiting, postmaster tooling, anti-spam/anti-phishing, quarantine, and abuse operations.
11. Service Architecture
Service	Primary Responsibility	Critical Notes
Identity Service	Zoiko One-federated SSO, SCIM, OAuth app connection, token-vault integration.	No separate identity plane.
Calendar Service	Native events, availability, RRULE engine, iTIP/iMIP, event version chain.	Rollback substrate for calendar actions.
Scheduling Engine	Constraint solver across free/busy, ZoikoTime, policy, resource cost, and attendee scope.	Exposed to agents only through governed tools.
Mail Connector Service	Provider adapters, sync, backfill, provider mutation, send/reply/forward orchestration.	No duplicate sends; provider-specific rate control.
Mail Rendering Service	Sanitisation, image proxy, attachment preview pipeline.	Isolated blast radius; no graph mutation rights.
Work Graph Service	Typed graph, edge enforcement, confidentiality-aware query layer.	Policy-filtered before AI.
AI Orchestration Service	Summaries, drafts, scheduling suggestions, extraction, executive briefs.	Receives only allowed subgraphs.
Policy Engine	Autonomy, DLP, retention, legal hold, access, data residency, MCP grants.	Single evaluation point for agent actions.
Action Review Service	Review queue, delayed send, approvals, rollback execution.	Cross-category queue.
Audit Ledger	Append-only audit events and export.	Write failure blocks governed actions.
Notification Service	Reminders, digests, push, review alerts.	Respects presence and ZoikoTime status.
Search Service	Unified search across mail, calendar, messages, meetings, tasks, files.	Security-trimmed results.
MCP Registry	Tenant-managed agent/tool server registry and tool grants.	No direct agent tokens outside registry.

12. API, Data, and Event Contracts
12.1 Internal API Principles
• Every mutation API requires principal, tenant, idempotency key, policy context, and trace context.
• Agent-triggered APIs require autonomy level, agent identity, policy version, and tool grant reference.
• APIs that mutate provider state must return provider acknowledgement, local graph mutation ID, audit event ID, and rollback descriptor.
• No service may bypass Policy Engine for convenience paths, maintenance paths, or batch jobs.
12.2 Canonical Event Names
Event	Producer	Required Consumers
calendar.event.synced	Calendar adapter	Work Graph, Search, Audit/Telemetry
calendar.event.mutated	Calendar Service	Work Graph, Audit, Notification, Search
mail.message.synced	Mail Connector	Work Graph, Search, DLP metadata pipeline
mail.draft.prepared	AI Orchestration / User Surface	Action Review, Audit
mail.send.buffered	Action Review Service	Notification, Audit
mail.send.cancelled	Action Review Service	Audit, Notification
mail.send.released	Mail Connector	Audit, Work Graph
agent.action.created	AI Orchestration	Audit Ledger, Action Review, Work Graph
policy.evaluated	Policy Engine	Audit Ledger, Observability
settings.policy.versioned	Admin Console	Audit Ledger, Settings History, Compliance Export

12.3 Minimum Object Versioning
• CalendarEvent requires full version chain for Sema-native events and metadata/version snapshots for connected-provider events where provider permits.
• Mail draft versions must be preserved from agent draft through human edits to final send or rejection.
• Admin policy versions must be immutable after publication; changes create new versions.
• Rollback operations create new events rather than deleting history.
13. AI Orchestration and Agent Safety
13.1 Permitted AI Workflows by Phase
Phase	AI Workflows
Phase 1	Calendar conflict explanation, meeting brief suggestions, agenda suggestions at L1.
Phase 2	AI agenda builder, pre-meeting brief, follow-up suggestions, L2 event preparation.
Phase 3	Thread summaries, reply drafts, email-to-meeting/channel/task conversion, L3 delayed-send execution.
Phase 4	Bounded L4 scheduling/send, executive briefing across Work Graph, shared inbox triage.
Phase 5	Hosted-mail-only internal cryptographic confidential mail workflows where policy allows.

13.2 Agent Safety Rules
• Agents receive only the policy-filtered subgraph needed for the declared task.
• Agents must not infer permission from prior access; every action requires fresh policy evaluation.
• Agent-composed mail is DLP-scanned before queueing and again before release from delayed-send buffer if the draft changed.
• Agents cannot bypass ZoikoTime rest/shift constraints in L3/L4 calendar actions.
• Agents cannot add external recipients, attachments, or links beyond policy scope without human approval.
• Every agent tool call is mediated by the tenant MCP registry and logged against the tool grant used.
13.3 Human Trust UI
Agent-touched objects use the violet signal consistently: proposed event, drafted email, edited draft, queue item, AI summary, and autonomous action. Users must be able to identify agent involvement without opening an object.
14. Admin Console Requirements
All Calendar Admin, Mail Admin, and Security Admin surfaces shall carry the “Managed by Zoiko Group” policy chip when the setting is governed by Zoiko Group policy, tenant policy, or enterprise policy. Settings history is mandatory on all surfaces.
Surface	Required Controls
Calendar Admin	Provider integrations; working hours; ZoikoTime constraints; resource/room rules; cost caps; external guest rules; recording defaults; AI summary defaults; confidential meeting rules; category autonomy ceiling.
Mail Admin	Connected providers; scopes; shared inbox governance; retention classes; attachment rules; forwarding rules; DLP rules; AI drafting controls; send autonomy; external warnings; delayed-send buffer; quarantine; export/e-discovery.
Security Admin	OAuth apps; MCP server registry; admin consent; session/MFA policy; data residency; legal hold; policy exceptions; audit ledger; token vault status.
Settings History	View policy as-of date; diff any two versions; export policy evidence; identify author, approver, effective time, and affected surfaces.

14.1 Policy Exception Handling
• Every exception is a versioned, audited object with scope, owner, justification, expiry, and approver.
• Exceptions cannot silently raise autonomy above tenant maximum without explicit Enterprise admin permission.
• Expired exceptions fail closed and generate admin notifications.
15. User Experience and Design System Requirements
15.1 Navigation Placement
Surface	Placement
App Launcher	Calendar and Mail join Meetings, Messaging, Calls, Sema AI, AI Meeting Summaries, Sema Notes, Admin Console, Security Center.
Workspace Sidebar	Inbox, Calendar, Meetings, Channels, DMs, Calls, Notes, Tasks, Files, AI, Review Queue.
Create Actions	Meet now, Schedule, From email, From channel, From task, Confidential, Recurring.
Persistent Governance	Action Review Queue and policy state are persistent; they are not buried inside Calendar or Mail.

15.2 Visual Rules
• Zoiko wordmark colour: parent teal. Sema colour: deep navy #172A44. Violet #5A45D6 marks AI/agent-touched objects and primary CTAs.
• Policy-Protected and AI-Excluded icons must be visually distinct from cryptographic Confidential Mode icons.
• External-recipient and external-attendee warnings must be inline at decision point, not after submission.
• Delayed-send countdown must be visible and actionable until release.
• Rollback labels must describe the real rollback available and must never imply external email recall after delivery.
15.3 Accessibility and Internationalisation
• WCAG 2.2 AA baseline for all new surfaces.
• Keyboard-complete review queue, calendar navigation, and mail composition.
• Screen-reader labels for policy state, agent involvement, DLP warnings, and delayed-send state.
• Timezone display must show local time plus event timezone for cross-region invites.
• Recurring-event logic must be tested across DST, locale, and IANA/Windows timezone mapping.
16. Packaging, Entitlements, and Commercial Controls
Packaging maps to the locked $9 / $14 / $22 / Custom annual structure. Autonomy ceiling is the tier axis because the category is governed agentic communications.
Capability	$9	$14	$22	Custom Enterprise
Calendar	Google/Outlook integration, scheduling, reminders, presence.	Native Sema Calendar, team calendars, Scheduling Engine.	Resource booking with spend caps and ZoikoTime constraint scheduling.	Data residency, BYOK, confidential meeting governance.
Mail	One connected account; read and AI summary.	Full Mail Connect; send/actions; unified inbox.	Shared inboxes and retention policies.	Legal hold, e-discovery, DLP, hosted Zoiko Mail add-on when available.
Autonomy ceiling	L1	L2	L3	L4 within bounded policy.
Governance	Basic user controls.	Basic team policies.	Admin policies and audit log.	Audit ledger export, settings history API, MCP registry, compliance evidence.

16.1 Enterprise Add-Ons
• Hosted Zoiko Mail mailboxes — Phase 5 only and gated.
• Compliance archive and e-discovery export expansion.
• AI executive briefing over Work Graph.
• Additional storage and extended audit retention.
• Enhanced data residency and BYOK/HYOK options subject to architecture approval.
17. Build / Integrate / Defer Decisions
Build	Integrate	Defer
Work Graph; Policy Engine; Action Review; rollback; Scheduling Engine; Sema Calendar UX; unified search; Audit Ledger; provider adapters; AI workflows; MCP registry.	Malware scanning; attachment detonation; link reputation; deliverability infrastructure for Phase 5; anti-spam engine core for Phase 5 evaluation.	Hosted mail operations; mailbox migration tooling; JMAP shipping; booking-page product; CRM/helpdesk productisation.

17.1 Sync Middleware Decision
Nylas-class sync intermediaries are disqualified for default architecture because they can introduce third-party plaintext custody into the governance perimeter. Any exception requires Founder/CTO approval, customer-specific risk acceptance, security review, data-processing terms, and explicit procurement narrative. Speed is not sufficient justification.
18. Roadmap, Phase Gates, and Exit Criteria
Phase	Scope	Exit / Entry Gate
Phase 1 — Calendar Integration MVP	Google + Outlook calendar sync; Sema Meet scheduling; availability incl. ZoikoTime reads; RSVP; reminders; presence; admin consent; iMIP outbound.	Sync SLOs met for 30 consecutive beta days; RRULE/timezone corpus green; M365 and Workspace admin consent validated; CASA/security-assessment programme started.
Phase 2 — Native Sema Calendar	Native day/week/month/agenda; team/resource calendars; ZoikoTime rosters; recurring events; Scheduling Engine GA; AI agenda/brief/follow-up at L1-L2; event version history.	L2 Action Review live; event rollback restores versions and issues external updates; confidential external placeholder behaviour verified.
Phase 3 — Mail Connect	Gmail + Outlook unified inbox; read/search/send/reply/forward; email-to-meeting/channel/task; AI summaries/drafts; L3 delayed-send; AI-Excluded controls; rendering pipeline; DLP outbound.	Google restricted-scope requirements satisfied for Gmail scope; rendering security audit clean; delayed-send rollback verified; inbox freshness SLO met.
Phase 4 — Shared Inboxes & L4	Shared/group mailboxes; assignment and internal notes; delegated access; L4 bounded autonomy; executive briefing over Work Graph.	L4 incident-free for 60 days on design-partner tenants; audit-ledger export accepted by enterprise compliance reviewer.
Phase 5 — Hosted Zoiko Mail	Custom-domain mail hosting; native mailboxes; aliases/distribution lists; retention/e-discovery; anti-spam; anti-phishing; confidential Zoiko-to-Zoiko internal mail.	Entry gate only: at least two signed enterprise customers name hosted mail as procurement requirement; abuse/deliverability team staffed and on-call; unit economics approved.

18.1 Execution Sequence
1. Ratify doctrine and circulate Confidential Mode distinction as normative reference.
2. Start Google restricted-scope verification/security assessment programme in Phase 1.
3. Define Work Graph schema, Policy Engine contracts, and audit-event schema.
4. Build OAuth/token vault, tenant residency, per-tenant keying, and admin consent foundations.
5. Build Google/Outlook calendar sync, renewal daemons, RRULE/timezone test corpus.
6. Build Sema Meet scheduling, presence, reminders, iMIP outbound invites.
7. Build Native Sema Calendar, ZoikoTime constraint solver, event versioning, L2 queue.
8. Build mail adapters, rendering, unified inbox, DLP, delayed-send, and AI drafts.
9. Build unified search, shared inboxes, L4 bounded autonomy, and executive briefing.
10. Evaluate Phase 5 only against its entry gate; do not pre-commit.
19. QA, Security Testing, and Acceptance Criteria
19.1 Functional Test Matrix
Area	Acceptance Criteria
RRULE/timezone	DST, EXDATE, RDATE, COUNT vs UNTIL, IANA/Windows mapping, recurring updates, attendee exceptions.
Provider sync	Initial backfill, incremental sync, webhook expiry, token expiry, 410 resync, Graph subscription renewal, delta drift, poison quarantine.
Mail rendering	Malicious HTML, script stripping, remote-image proxy, CSP enforcement, attachment preview isolation.
Agent actions	L0-L4 permission boundaries, DLP preflight, trace capture, review flow, rollback, audit ledger completeness.
Confidentiality	No server-side AI/search access to cryptographic content; policy-excluded content admitted only by policy version.
Admin settings	Version history, diff, as-of query, export, Managed by Zoiko Group chip, exception expiry.
ZoikoTime	Shift, leave, rest windows, roster-based team calendars, presence conflict resolution.

19.2 Security Testing
• Threat model for token vault, mail rendering, provider webhooks, DLP bypass, AI prompt/tool injection, graph policy filtering, and audit ledger integrity.
• External penetration test before Phase 3 beta due to connected mail threat surface.
• CASA/security assessment evidence prepared from Phase 1 rather than retrofitted in Phase 3.
• Red-team test: agent tries to leak policy-excluded content, add external recipient, bypass DLP, book rest-window violation, and send outside domain scope.
• Tabletop incident: provider token compromise, malicious attachment, webhook spoofing, duplicate send, audit ledger outage.
19.3 Release Acceptance
• No P0/P1 open defects in sync, token security, DLP, audit, rendering, or rollback flows.
• Audit reconciliation shows every governed mutation has a corresponding audit event.
• No known path allows agent action above effective autonomy level.
• No UI copy implies external email recall after delivery or connected-mail E2EE.
• Procurement evidence pack complete for Enterprise beta: data residency, encryption, access control, audit, settings history, provider scope handling, subprocessor position.
20. Risk Register and Control Plan
Risk	Severity	Control Plan
Hosted mail absorbs company focus prematurely.	Critical	Phase 5 gate: signed demand, staffed abuse/deliverability operations, approved unit economics.
Google verification/security assessment delays Mail Connect.	High	Start in Phase 1; scope minimisation; Phase 3 gate; Microsoft-only contingency by CTO approval.
Provider sync drift causes user-trust failure.	High	Daily reconciliation, diff alerts, clear sync state, user-visible status, full resync paths.
Token compromise creates tenant data exposure.	Critical	HSM/KMS token vault, least-privilege token access, anomaly detection, rapid revocation, blast-radius report.
Agent sends sensitive content externally.	Critical	DLP preflight, external warnings, autonomy ceilings, delayed-send buffer, volume/domain caps.
Confidential Mode overclaim creates regulatory/procurement exposure.	Critical	Normative copy rules, design labels, procurement language, QA copy review.
ZoikoTime constraints overcomplicate scheduling.	Medium	Constraint phases: read-only visibility Phase 1; hard enforcement Phase 2+; policy toggles.
Mail rendering exploit compromises graph/services.	High	Isolated renderer, no script, strict CSP, no graph write access, external audit.
Audit ledger outage blocks core workflows.	High	Degraded mode blocks governed mutations; queue non-governed reads; incident runbook.
Third-party middleware pressure due to speed.	High	Default disqualification; exception requires Founder/CTO decision and procurement risk acceptance.

21. Decision Register
ID	Decision	Rationale
DR-01	Calendar and Mail are governed agent-action categories.	Matches Sema category strategy and differentiates beyond feature parity.
DR-02	Integrate before hosting.	Reduces deliverability, abuse, migration, and operations burden.
DR-03	Calendar before Mail.	Meeting scheduling is closest to current Sema value and lower-risk than connected mail.
DR-04	ZoikoTime constraints are first-class.	Creates unreplicable workforce-truth scheduling advantage.
DR-05	No third-party plaintext sync middleware by default.	Protects telecoms/enterprise procurement posture.
DR-06	Action Review Queue is cross-category.	Reduces hidden agent risk and improves administrative control.
DR-07	External mail rollback means delayed-send cancellation only.	Avoids dishonest recall language after delivery.
DR-08	Connected mail is AI-Excluded/Policy-Protected, not E2EE.	Accurate guarantee boundary and procurement defensibility.
DR-09	Autonomy ceiling maps to tier packaging.	Makes the commercial model express the product category.
DR-10	Hosted Zoiko Mail requires enterprise-demand gate.	Prevents premature operational security burden.

Appendix A — Work Graph Schema Summary
Entity	Primary Key	Critical Relationships
Person	person_id	attendee_of, sent_by, reviewed_by, owns, member_of
Organisation	org_id	domain_of, customer_of, vendor_of, risk_classified_as
Email	email_id	sent_by, received_by, derived_from, converted_to, governed_by
CalendarEvent	event_id	attendee_of, linked_to_meeting, uses_resource, governed_by, version_of
Meeting	meeting_id	derived_summary, produced_transcript, has_recording, follows_up
AISummary	summary_id	derived_from, generated_by, governed_by, supersedes
Task	task_id	assigned_to, derived_from, follows_up, due_on
AgentAction	action_id	executed_by_agent, governed_by, read, mutated, reviewed_by, rolled_back_by
PolicyVersion	policy_version_id	governs, supersedes, authored_by, approved_by

Appendix B — Provider Scope and Permission Matrix
Provider	Permission Class	Controls
Google Calendar	Calendar read/write scopes as required by feature.	Minimum scopes; tenant consent; push channel renewal; 410 resync.
Gmail	Restricted Gmail scopes for read/send depending on feature.	Google verification, CASA/security assessment where applicable, least privilege, assessment evidence.
Microsoft Calendar/Mail	Graph delegated/application permissions as required.	Publisher verification, admin consent, delta, change notification subscription renewal.
IMAP/SMTP	Mailbox access and authenticated submission.	XOAUTH2 preferred; no major-provider basic-auth dependency; DLP before SMTP send.
CalDAV	Calendar read/write for generic providers.	Phase 2+ adapter; customer-driven delivery.
JMAP	JMAP core/mail capabilities.	Interface reserved; not a launch dependency.

Appendix C — Standards and External References
Ref	Description	URL
REF-01	IETF RFC 9989 — DMARC core, Standards Track, May 2026; obsoletes RFC 7489 and RFC 9091.	https://datatracker.ietf.org/doc/rfc9989/
REF-02	RFC Editor RFC 7489 record showing RFC 7489 is obsolete and replaced by RFC 9989, RFC 9990, RFC 9991.	https://www.rfc-editor.org/info/rfc7489/
REF-03	Google Gmail API scopes: restricted scopes require restricted-scope OAuth verification; server storage/transmission of restricted data requires security assessment.	https://developers.google.com/workspace/gmail/api/auth/scopes
REF-04	Google restricted-scope verification: annual security assessment for apps accessing restricted data from or through a third-party server.	https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
REF-05	Google Cloud Console Help — CASA/security assessment and annual revalidation.	https://support.google.com/cloud/answer/13465431
REF-06	Microsoft Graph change notifications: subscription lifetimes, Outlook message/event/contact under seven days; rich notifications under one day.	https://learn.microsoft.com/en-us/graph/change-notifications-overview
REF-07	Google Calendar Events list: expired syncToken returns 410 Gone and requires full synchronisation without syncToken.	https://developers.google.com/workspace/calendar/api/v3/reference/events/list
REF-08	Google Calendar Push Notifications: watch channels and HTTPS webhook receiver.	https://developers.google.com/workspace/calendar/api/guides/push
REF-09	RFC 5546 — iTIP group scheduling methods.	https://datatracker.ietf.org/doc/html/rfc5546
REF-10	RFC 6047 — iMIP binding from iTIP to email transports.	https://datatracker.ietf.org/doc/html/rfc6047
REF-11	RFC 8620/8621 — JMAP core and JMAP Mail.	https://datatracker.ietf.org/doc/html/rfc8621
REF-12	RFC 6409 — Message Submission for Mail.	https://datatracker.ietf.org/doc/html/rfc6409
REF-13	NIST SP 800-63B — authentication assurance levels.	https://pages.nist.gov/800-63-4/sp800-63b.html

Appendix D — Corrections Register vs Baseline
#	Baseline Defect	Final Correction
1	Calendar and Mail treated as apps rather than agent-action categories.	Autonomy model, review queue, traces, rollback, MCP registry, and policy controls are the organising spine.
2	Confidential Mode conflated cryptographic and policy guarantees.	Defined Cryptographically Inaccessible vs Policy-Excluded; banned connected-mail E2EE claims.
3	Category sprawl into helpdesk/CRM.	Cut ticketing/SLA/CRM productisation; integrate through graph APIs and MCP tools.
4	Pricing used non-locked tier ladder.	Mapped to $9 / $14 / $22 / Custom and autonomy ceilings.
5	ZoikoTime absent.	Made workforce-truth scheduling a first-class differentiator.
6	Google restricted-scope assessment omitted.	Made verification/security assessment a Phase 1 programme dependency and Phase 3 gate.
7	JMAP overweighted as launch dependency.	Retained adapter interface; deferred shipping until customer/provider demand.
8	iCalendar/iTIP/iMIP missing.	Made external invite interop mandatory.
9	“Managed by Zoiko Group” chip omitted.	Made it an acceptance criterion on admin and relevant end-user surfaces.
10	Settings history omitted.	Made settings history an audit asset with as-of, diff, export.
11	Phase gates/SLOs/control evidence weak.	Added measurable SLOs, gates, audit reconciliation, release criteria.
12	Sync mechanics hand-waved.	Specified push/poll, Graph renewal, Google 410 resync, quota budgeting, poison quarantine.
13	Email rollback unclear.	Delayed-send is the honest external rollback; internal recall only under Zoiko authority.
14	Microsoft Graph subscription lifetime overgeneralised as ≤3 days.	Corrected Outlook message/event/contact maximum to under seven days; rich notifications under one day per current Microsoft documentation.
15	Hosted email framed as inevitable.	Gated hosted Zoiko Mail by signed enterprise demand, staffing, and unit economics.

End of specification. Amendments must be versioned and must update the Decision Register, Risk Register, and affected phase gates.
