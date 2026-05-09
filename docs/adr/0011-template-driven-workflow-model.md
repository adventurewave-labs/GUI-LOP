# 0011. Template-Driven Workflow Definition Model

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Product, Backend team
- **Tags:** workflow, modelling, templates

## Context

Workflows are the heart of the product. The first cut shipped three
hard-coded templates (`data-analysis`, `decision-making`,
`content-creation`) embedded in the server source. New templates
required a code change and a deploy; this is unsustainable.

We need a definition model that:

- Lets domain experts (not only engineers) author and version
  templates.
- Captures sequencing, branching (eventually), and human-input steps.
- Validates structure before a template is published.
- Lets the engine execute any conforming template.

## Decision

We will model workflows as instances of versioned **WorkflowTemplate**
aggregates. A template consists of:

- A unique `template_key` (kebab-case) and a human name and
  description.
- An ordered list of **Step** value objects. Each step has:
  - `name`, `kind` (`automated | human | external`),
  - `inputs` and `outputs` (JSON Schema refs),
  - optional `precondition` / `postcondition` (logic expressions),
  - optional `ui_spec` for human steps (drives UI generation, see the
    UI Generation context).
- A `default_config` JSONB blob with template-level configuration.

Storage: `workflow_templates` table; templates are immutable per
version, with a `version` column and a `template_key` carrying the
current default version.

A **Workflow** aggregate is an *instance* of a template. It has its
own status, context, generated UI, and human responses. The engine
advances a workflow one step at a time, dispatching to the appropriate
adapter based on step kind.

Initial templates ship with the platform; new templates are published
by privileged users via the Templates API (with ADR 0009 permissions).

## Alternatives Considered

- **Code-defined workflows (decorators or DSL in code)** — most
  flexible, slowest to iterate on for non-engineers. Rejected.
- **BPMN 2.0** — industry standard, but heavyweight and demands a
  full BPMN engine. Captured as a possible future direction once the
  template DSL stabilises.
- **External workflow engine (Temporal, Camunda)** — powerful but
  introduces a major dependency. Re-evaluate if our needs grow into
  long-running, replayable, or distributed workflows.

## Consequences

### Positive

- Non-engineers can publish new templates.
- Templates are versioned and auditable.
- Template authoring tooling can be built incrementally without
  breaking existing workflows.

### Negative / Trade-offs

- We are building (a small) workflow engine; we must resist scope
  creep into BPMN territory.
- Step branching is intentionally deferred until use cases demand it.

### Neutral

- The execution semantics of templates are documented in
  `docs/ddd/03-bounded-contexts/workflow-orchestration.md`.

## Compliance and Verification

- Template publication runs JSON Schema validation server-side.
- A reference test suite exercises every shipped template end-to-end.

## References

- `docs/ddd/03-bounded-contexts/workflow-orchestration.md`
- `database/schemas/01_main_schema.sql`
