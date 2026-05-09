# Bounded Context: UI Generation

> **Subdomain.** Supporting.
> **Status.** Active.
> **Owner.** Frontend team (with backend collaboration).
> **Code.** `src/backend/contexts/ui-generation/`

## Purpose

Translate a step's `UISpecification` plus a `WorkflowContext` into a
concrete, renderable `UIDocument`: a JSON description that the SPA
can render as a form, dashboard, or hybrid surface for a human step.

## Ubiquitous Language (Local Additions)

- **UI Spec** — declarative description of fields and validation
  for a human step, defined inside a `WorkflowTemplate`.
- **UI Document** — concrete artefact derived from a UI Spec, bound
  to a specific workflow id and step id, with stable URL.
- **Component Catalogue** — versioned set of approved UI building
  blocks.
- **Layout** — composition of components into a structured surface.
- **Generation Strategy** — the algorithm chosen to produce a
  layout (template-driven, rules-driven, AI-assisted).

## Aggregates

### `UISpecification`

Generally embedded inside `WorkflowTemplate.steps[i].ui_spec`. The
context has a thin aggregate that wraps it for validation,
versioning, and caching.

```
UISpecification
├── identity: UISpecId (derived from template + step)
├── fields: Field[] (VO)
├── validation: ValidationRule[] (VO)
├── layout: Layout (VO)
└── component_refs: ComponentRef[] (VO)
```

Invariants:

- Field names unique.
- Validation rules reference declared fields.
- Component refs resolve to entries in the active catalogue.

### `UIDocument`

```
UIDocument
├── identity: UIDocumentId
├── workflow_id: WorkflowId
├── step_id: StepId
├── url: string (stable)
├── content_ref: storage key
├── generated_at: Timestamp
├── strategy: GenerationStrategy (VO)
├── version: integer (regeneration bumps)
└── pending_events
```

Invariants:

- Bound to a specific `(workflow_id, step_id)`.
- Immutable; regeneration produces a new `UIDocument` with a new
  id and incremented version.

## Domain Services

- `LayoutComposer.compose(spec, context): Layout`
- `ComponentResolver.resolve(field, catalogue): ComponentInstance`
- `GenerationStrategySelector.choose(spec, context): GenerationStrategy`

## Use Cases

### Commands

- `GenerateUIForStep({ workflow_id, step_id, spec, context })` →
  `UIDocumentId`. Idempotent on `(workflow_id, step_id)` per
  generation; if a current document exists, returns it unless a
  forced regeneration is requested.

### Queries

- `GetUIDocument(id)` → renders metadata + content URL.
- `ListUIComponents(activeOnly)` → catalogue introspection.

## Repositories

- `UIDocumentRepository` (Postgres for metadata, object storage for
  content blobs when large).
- `ComponentCatalogueRepository`.

## Inbound Adapters

### REST

| Method | Path                                           | Use Case               |
| ------ | ---------------------------------------------- | ---------------------- |
| POST   | `/api/v1/ui/generate`                          | `GenerateUIForStep`    |
| GET    | `/api/v1/ui/documents/:id`                     | `GetUIDocument`        |
| GET    | `/api/v1/ui/components`                        | `ListUIComponents`     |

Most generation calls come **from inside the platform** (Workflow
Orchestration calling the local port), not over HTTP.

### Internal Port

The Workflow Orchestration context calls this context through:

```ts
interface UIGenerationService {
  generateForStep(args: {
    workflowId: WorkflowId;
    stepId: StepId;
    spec: UISpecification;
    context: WorkflowContext;
  }): Promise<UIDocumentReference>;
}
```

## Outbound Dependencies

- **Component Catalogue** (internal repository).
- **AI Provider Adapter** (ACL, ADR 0023) for AI-assisted strategies.
- **Object Storage** (port) for content blobs.
- **Outbox** (port).

## Domain Events Produced

- `ui.generated`
- `ui.generation_failed`

## Persistence

- `ui_documents` (planned table, not in the current schema).
- The `workflows.ui_url` and `workflows.ui_components` columns are
  legacy projections that will be replaced by joins to
  `ui_documents`.

## Risks and Pitfalls

- **Catalogue drift.** Component versions in flight may be different
  from the latest. Each generated document references the exact
  versions used; rendering uses those.
- **AI strategy non-determinism.** When AI-assisted, the same spec
  may yield slightly different layouts. We record the strategy and
  parameters so a user can request a regenerate if unhappy.
- **Cost.** AI strategies cost money; we cache by spec+context hash.

## Open Questions

- **Live preview** during template authoring: out of scope for v1
  but a clear next step.
- **i18n**: language is part of the generation context; catalogue
  components are responsible for localisation.
