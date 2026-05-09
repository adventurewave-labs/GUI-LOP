# 0001. Record Architecture Decisions

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Architecture Review Board
- **Tags:** governance, process

## Context

GUI-LOP is evolving from a proof-of-concept into a production platform that
will host long-lived business workflows. Multiple teams (backend, frontend,
data, security) will make architectural choices over time, and the
rationale for those choices is currently scattered across PR descriptions,
chat messages, and oral tradition.

We need a lightweight, low-ceremony way to capture *why* a particular
architectural choice was made so that future contributors can understand,
challenge, or revisit those choices without archaeology.

## Decision

We will record every significant architectural decision as an Architecture
Decision Record (ADR) stored in `docs/adr/`. We adopt Michael Nygard's
ADR format with light extensions for alternatives, compliance, and tags.

A decision is "significant" if it:

- Is hard to reverse later (data model changes, framework choices, contracts).
- Affects more than one bounded context.
- Establishes a cross-cutting standard (logging, security, naming).
- Introduces a new external dependency or vendor.

## Alternatives Considered

- **Wiki page per decision** — easy to write, but harder to review and
  version with code; rejected because we want decisions to evolve with the
  codebase.
- **Free-form `DECISIONS.md`** — single file is hard to navigate and
  review; rejected.
- **No formal record** — current state; rejected because tribal knowledge
  does not survive team rotation.

## Consequences

### Positive

- New contributors can read `docs/adr/` to understand "why is it this way?".
- Pull-request reviewers have a canonical place to challenge architecture.
- Decisions become first-class artefacts under version control.

### Negative / Trade-offs

- Adds writing overhead for non-trivial changes.
- Requires discipline to keep the index current.

### Neutral

- ADRs are written in Markdown and reviewed via the same PR flow as code.

## Compliance and Verification

- The PR template includes a checkbox: "Does this change require an ADR?".
- The architecture review board reviews `docs/adr/` quarterly.

## References

- Michael Nygard, "Documenting Architecture Decisions" (2011)
- ThoughtWorks Tech Radar entry on Lightweight Architecture Decision Records
