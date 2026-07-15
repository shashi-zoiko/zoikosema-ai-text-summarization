# Phase 3 · Slice 11 — Google CASA / Restricted-Scope Verification Evidence Pack

**Branch:** none — process/paperwork, not code
**Status:** planned, should start in parallel with slice 1, not after slice 10
**Spec refs:** §7.3, §18 Phase 3 exit gate, §19.2, §20 risk register

## Goal

Spec §7.3 names Google verification/CASA security assessment as a Phase 1 programme dependency and a HARD Phase 3 beta-exit gate blocker — not a code slice, an external compliance process with its own lead time (Google's review process is not instantaneous). Tracking it as its own slice, started early, is what prevents it from being discovered as a blocker only when Phase 3 is otherwise "done."

## What this actually is

- Preparing the evidence Google's OAuth verification and CASA (Cloud Application Security Assessment) process requires for the Gmail restricted scopes this build requests (`gmail.readonly` from slice 1, `gmail.send` from slice 9): a privacy policy, scope-justification narrative, security assessment questionnaire responses, and (per REF-05) annual revalidation once approved.
- A Microsoft-side equivalent (publisher verification, admin consent documentation) for the Outlook Mail app registrations from slices 1/3/9 — lighter-weight than Google's process but still a real external dependency, not automatic.

## Owner

Whoever owns compliance/security review for this org — this is explicitly named in spec §20's risk register as a "High" severity item with its own control plan ("Start in Phase 1 [of the Mail track]; scope minimisation; Phase 3 gate; Microsoft-only contingency by CTO approval" if Google's process is delayed).

## Do not treat as done until

Google's verification/CASA assessment evidence is actually submitted and, ideally, provisionally accepted — not just "documentation written." Spec's Phase 3 exit gate requires the requirements *satisfied*, not merely in progress. If this slips, spec's own contingency (§20) is a Microsoft-only beta scope by explicit CTO decision — track that as the fallback plan, not a silent scope cut.
