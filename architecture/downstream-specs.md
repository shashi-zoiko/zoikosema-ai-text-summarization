# Downstream Specifications — Index

Source authority: `architecture/SPEC.md` §29 (master) and `architecture/SPEC-AI.md` §35 (AI).

All entries below are **Not started** — files in this repo are placeholders. Each downstream specification is owned per the matrix below and must conform to the upstream Class 2 architecture.

## Class 3 — Technical Specifications

| Specification | Owner | Source | Status |
|---|---|---|---|
| Data Architecture | Data Engineering Lead | SPEC §11, §29 | Not started |
| AI Architecture (parent) | Head of AI | SPEC-AI.md (this is the parent) | **Drafted** — `SPEC-AI.md` v2.0 |
| Security Architecture | Security Lead | SPEC §20 | Not started |
| Identity / Tenancy / Workspace Specification | Platform Engineering Lead | SPEC §10 | Not started |
| Messaging and Real-Time Engine Specification | Real-Time Engineering Lead | SPEC §12 | Not started |
| Meetings / Voice / Video Specification | Media Engineering Lead | SPEC §13 | Not started |
| AI Signal Layer Specification | Head of AI | SPEC §14 | Not started |
| ZoikoTime Integration Specification | Sema Lead + ZoikoTime Lead | SPEC §15 | Not started |
| Sema Calendar & Mail — Governed Agentic Communications | Platform Engineering Lead | `SEMA_CALENDAR_MAIL_SPEC.md` v1.1 | **Drafted** — build in progress on `feature/sema-calendar-mail`, Phase 1 (Calendar Integration MVP) |
| Billing and Monetization Specification | Billing Engineering Lead | SPEC §16 | Not started |
| Global Infrastructure and DevOps Blueprint | Head of SRE | SPEC §19 | Not started |
| Mobile / Desktop Specification | Client Engineering Lead | SPEC §18 | Not started |
| API / Webhooks / Integration Framework | Platform/API Lead | SPEC §17 | Not started |
| Release / QA / Certification Plan | Head of SRE + Head of QA | SPEC §24 | Not started |
| AI Gateway Technical Specification | AI Platform Engineering | SPEC-AI §35, ADR-AI-001 | Not started |
| Model Router Specification | AI Platform Engineering | SPEC-AI §35, ADR-AI-002 | Not started |
| Prompt Registry Specification | AI Engineering | SPEC-AI §35, ADR-AI-003 | Not started |
| Context Retrieval Specification | Search / AI Engineering | SPEC-AI §35, ADR-AI-004 | Not started |
| Embedding and Vector Specification | Data / AI Engineering | SPEC-AI §35, ADR-AI-005 | Not started |
| Agentic AI and Tool Specification | AI Engineering / Security | SPEC-AI §35, ADR-AI-016/017 | Not started |
| Knowledge Architecture Specification | AI / Data Engineering | SPEC-AI §35, ADR-AI-022 | Not started |
| ZoikoTime AI Integration Contract | Sema + ZoikoTime Engineering | SPEC-AI §35, ADR-AI-025 | Not started |
| Continuous Evaluation Infrastructure Specification | AI Evaluation Lead | SPEC-AI §35, ADR-AI-024 | Not started |
| Model Lifecycle Specification | Head of AI | SPEC-AI §35, ADR-AI-020 | Not started |

## Class 4 — Operational Runbooks

| Runbook | Owner | Source | Status |
|---|---|---|---|
| Security / Privacy / Compliance Operations | Security + Compliance | SPEC §20, §23 | Not started |
| EU AI Act Compliance Operating Procedure | Compliance / Legal | SPEC-AI §35, ADR-AI-023 | Not started |
| AI Safety Operations Runbook | AI Safety / Security | SPEC-AI §35, ADR-AI-014 | Not started |
| AI Cost Operations Runbook | FinOps / AI Ops | SPEC-AI §35, ADR-AI-013 | Not started |
| Human Evaluation Operations Manual | AI Evaluation Lead | SPEC-AI §35, ADR-AI-027 | Not started |
| AI Incident Response Runbook | Security / AI Ops | SPEC-AI §35, ADR-AI-015 | Not started |

## Conventions

- A downstream specification cannot supersede or contradict its Class 2 parent. Conflicts escalate to ARB.
- Each Class 3 spec must declare the ADRs it depends on; no spec ships without those ADRs in **Accepted** state.
- Each Class 4 runbook must declare its named on-call rotation and PIR template before being marked production-ready.
