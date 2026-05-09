# 0023. Anti-Corruption Layer for External AI Providers

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Backend team, Architecture Review Board
- **Tags:** ddd, integration, ai

## Context

Workflows can invoke AI providers (LLMs, classifiers, vision models)
during automated steps. Provider SDKs differ wildly in:

- request/response shapes,
- streaming semantics,
- error taxonomies,
- rate-limit and quota handling,
- authentication.

If provider types leak into the domain, every provider change ripples
across the codebase, and our domain language is polluted with vendor
terminology.

## Decision

We will introduce an **Anti-Corruption Layer (ACL)** between the
domain and any external AI provider. The ACL lives in the
*UI Generation* and *Workflow Orchestration* contexts as appropriate,
exposed through a small, stable port:

```
interface AIProvider {
  generateUI(spec: UISpec, ctx: GenerationContext): Promise<UIDocument>;
  classify(input: ClassificationRequest): Promise<ClassificationResult>;
  // ...one method per domain capability
}
```

Each provider gets an adapter under `infrastructure/ai/<vendor>/` that
maps domain types ↔ vendor types and translates errors into a domain
error taxonomy (`AIProviderUnavailable`, `AIQuotaExceeded`,
`AIInvalidRequest`).

Cross-cutting concerns are added by composition:

- Retry with exponential backoff and jitter.
- Circuit breaker on consecutive failures.
- Telemetry (latency, token usage) emitted per call.
- PII scrubbing prior to leaving our network.

## Alternatives Considered

- **Direct SDK use in domain code** — quickest, worst long-term cost.
  Rejected.
- **Single thin abstraction over one vendor** — locks us in;
  rejected.
- **Use a third-party multi-provider router** — viable; we may adopt
  one *behind* our ACL when warranted.

## Consequences

### Positive

- Domain remains vendor-agnostic and testable.
- Switching providers, A/B-testing them, or using a fallback is a
  configuration change.
- Vendor-specific quirks are isolated to one file.

### Negative / Trade-offs

- More code than direct SDK use.
- The port may lag behind a new vendor capability until we decide
  whether it belongs in the domain language.

### Neutral

- The error taxonomy is part of the shared kernel and consumed by
  callers across contexts.

## Compliance and Verification

- Lint forbids vendor-SDK imports outside `infrastructure/ai/`.
- Contract tests run against a recorded fixture per provider.
- A weekly synthetic call validates each provider in production.

## References

- Vaughn Vernon, *Implementing DDD*, ch. 13 (Integrating Bounded
  Contexts)
- ADR 0004 — Hexagonal Architecture
