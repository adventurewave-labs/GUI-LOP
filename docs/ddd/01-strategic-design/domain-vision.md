# Domain Vision Statement

## The Problem

Organisations want the speed of automation and the judgment of
people. Today they choose: a fully automated pipeline that surprises
them when reality deviates, or a fully manual process that does not
scale. The middle ground — automation that defers to humans at
clearly defined moments — is technically achievable but
operationally fragile.

Real workflows fail in subtle ways: a human approval is requested
but never delivered to the right person; a deadline passes silently;
two reviewers respond simultaneously and one is silently lost; an
audit later asks "who approved this?" and the trail is incomplete.

## The Vision

**GUI-LOP** is a platform for designing, executing, and observing
workflows that combine automated steps with human-in-the-loop
decisions, with first-class real-time UI, durable state, and
auditable history.

A *workflow* is a sequence of steps. Some steps are automated (call
a service, transform data, evaluate a rule). Some steps require a
human: a manager approving an expense, an analyst reviewing an AI
recommendation, an editor approving generated content. The platform
takes care of:

- Pausing the workflow when a human is required.
- Generating the right UI for that step.
- Notifying the right person, reliably.
- Validating the response.
- Resuming the workflow.
- Recording every decision.

## Who It Is For

- **Operations teams** who run business processes that mix system
  actions and human checks.
- **Product teams** building applications where AI handles the
  bulk and humans handle exceptions.
- **Compliance and audit functions** that need defensible records
  of what happened, who decided, and why.

## What "Done" Looks Like

A user opens a browser, picks a template, supplies a context, and
watches the workflow execute. When their input is needed, the right
UI appears at the right time and they respond with one click. When
the workflow completes, the result is stored and queryable; if it
fails or stalls, an operator sees it on a dashboard.

The platform is correct (no lost responses, no double counts),
fast (sub-second UI updates), durable (survives restarts), and
explainable (every act has a record).

## Non-Goals

- **General BPM**: we are not a BPMN engine. Our workflow model is
  intentionally narrower and template-driven.
- **Custom UI builder for end users**: UIs are generated from a
  spec, not edited freeform by end users.
- **Multi-tenant SaaS** (initial release): the architecture is
  multi-tenant-ready, but the first cut targets single-tenant
  deployments.

## The Core Differentiator

The product's value lives in **making human-in-the-loop simple,
durable, and observable**. That is the *core domain* and is where we
invest most of our modelling and engineering effort. Everything else
exists to serve it.
