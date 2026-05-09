# 0010. React Single-Page Application for the Frontend

- **Status:** Accepted
- **Date:** 2025-10-26
- **Deciders:** Frontend team
- **Tags:** frontend, react, spa

## Context

The frontend is the primary UI for designing, monitoring, and
responding to workflows. It must:

- Render rich, interactive views (dashboards, dynamic forms generated
  from workflow templates).
- React in real time to server-pushed events.
- Support deep-linking to workflows for collaboration.
- Be testable end-to-end.

## Decision

We will build the frontend as a Single-Page Application using React
18 with React Router DOM 7. Tooling: react-scripts for the dev/build
pipeline (replaceable with Vite when bundle pressure justifies the
migration). Testing: React Testing Library for components, Playwright
for end-to-end flows.

State management:

- Local component state for view concerns.
- A small global store (React Context + reducers, or Zustand) for
  cross-cutting state (auth, current workflow).
- Server state through a query layer (e.g. TanStack Query) — no ad
  hoc `useEffect(fetch)` outside the API client.

The API client and WebSocket client are isolated in `src/frontend/src/services/`
so they remain the only modules that know about transports.

## Alternatives Considered

- **Server-rendered (Next.js, Remix)** — better SEO but unnecessary
  for an authenticated, app-like product. Rejected for now; revisit
  if a public-facing portion appears.
- **Angular / Vue** — viable, but the team and existing code are React.
- **Native mobile app** — out of scope; the SPA is responsive.

## Consequences

### Positive

- Fast iteration with hot module replacement.
- Strong WebSocket support, easy real-time UX.
- Large ecosystem for component libraries and accessibility tooling.

### Negative / Trade-offs

- Initial bundle size can grow; mitigated with route-level code
  splitting and a bundle-size budget enforced in CI.
- SEO is limited; not a current concern.
- We carry our own auth state in the client; mitigated by the
  centralised API client and access/refresh token flow (ADR 0008).

### Neutral

- A future migration to a meta-framework (Next.js, Remix) is possible
  because routing and data fetching are already abstracted.

## Compliance and Verification

- Bundle-size budget in `webpack.config.js` (or successor) fails CI
  on regression.
- Playwright suite under `src/frontend/tests/e2e/` covers the
  critical workflow flows.
- Accessibility checks via axe-core run as part of E2E.

## References

- React 18 docs
- ADR 0017 — API Versioning
- ADR 0019 — Testing Strategy
