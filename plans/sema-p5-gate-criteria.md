# Phase 5 — Hosted Zoiko Mail: Entry-Gate Checklist (no build plan)

Per spec §18 Phase 5 row and Decision Register DR-10, Phase 5 is **evaluated against an entry gate**, not pre-committed or pre-planned. There is intentionally no slice breakdown here — writing one before the gate is met would be planning work a phase might never reach, which is the opposite of agile.

## Entry gate (must ALL be true before any Phase 5 planning starts)

- At least two signed enterprise customers name hosted mail as an explicit procurement requirement (spec §18, §20 risk register).
- Abuse/deliverability operations team staffed and on-call.
- Unit economics for hosted mail approved.

## What this phase would require, if the gate is ever met (for awareness only, spec §10.4)

Custom-domain mail hosting, native mailboxes, aliases/distribution lists, retention/e-discovery, anti-spam, anti-phishing, confidential Zoiko-to-Zoiko internal mail (cryptographically inaccessible, per §9.1 — the one case where that guarantee applies to mail). SPF/DKIM/DMARC per the current RFC 9989/9990/9991 standards track (obsoleting RFC 7489) — see spec Appendix C REF-01/02.

## Owner of this gate check

Whoever owns the enterprise sales pipeline / CTO's office — this is a business-signal gate, not an engineering-readiness gate. Engineering's only pre-work is making sure Phase 1-4 don't build anything that would need to be re-architected if Phase 5 is later greenlit (e.g., don't hardcode "mail is always a connected provider" assumptions where a native mailbox would need a third code path).
