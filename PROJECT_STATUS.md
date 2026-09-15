# Engineering Workspace Compiler — Project Status

This project is in an **active development preview**. The repository retains the historical name `sec`; that name is not the current project definition or acronym. This page describes the public maturity boundary and does not replace exact verification evidence or the canonical design corpus.

## What exists today

The repository contains:

- an integrated SEC-086 design corpus with product, authoring, compilation, runtime, assurance, evolution, information, and domain specifications;
- a TypeScript implementation organized around explicit contracts, workspace state, semantic interpretation, compilation, assurance, application coordination, execution, adapters, entry points, and composition;
- tests, repository audits, documentation checks, development-control machinery, and GitHub workflows;
- authoring examples and reference/demo entry points.

These are repository facts, not a claim that every documented capability has reached the same maturity.

## Maturity boundary

The project deliberately distinguishes stages that early systems often collapse:

```text
proposed
→ accepted
→ specified
→ implemented
→ verified
→ enforced
→ adopted
→ superseded path retired
```

A document, type, command, test, or implementation path can establish one of these stages without establishing the stages after it. In particular, do not assume that:

- every documented design is implemented;
- every target language or environment is supported;
- the current CLI, package layout, TypeScript types, or internal protocols are stable public APIs;
- a local passing test proves production readiness;
- generated source proves that the requested engineering outcome was adopted;
- compatibility will be preserved throughout the current development phase.

Known gaps and intentionally unresolved design scope are maintained in [`docs/状态/README.md`](docs/状态/README.md). Concrete claims should be checked against the exact implementation revision and the evidence that actually covers them.

## Reproducible starting points

Use the versions pinned by `.bun-version`, `package.json`, and `bun.lock`. After installing dependencies with the declared Bun package manager, the repository exposes these bounded entry points:

```console
bun run demo:quickstart
bun run demo:governance
bun run demo:closed-loop
```

The supported repository checks are listed in `package.json`; contribution work should follow the current development entry in [`AGENTS.md`](AGENTS.md) rather than treating one fixed command as sufficient for every change.

## Release and compatibility policy

Public repository visibility means that the project can be inspected and contributed to. It does not declare a stable API, production readiness, long-term support, or a versioned product release.

A future release must state its supported capabilities, targets, compatibility boundary, verification coverage, installation path, and known limitations. Until then, consumers should pin an exact revision and expect architecture and implementation interfaces to change.

Project-owned materials are available under the [MIT License](LICENSE). Third-party dependencies and materials remain subject to their own licenses and notices.
