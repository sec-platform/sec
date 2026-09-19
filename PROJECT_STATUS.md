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

### Pure semantic queries in the source preview

The source library factory at `src/bootstrap/create-runtime.ts` exposes `handle()` and `close()` for the current pure semantic profile. It accepts captured semantic values; it does not require a writable workspace, acquire a workspace write lease, or publish a Lock. `analyze` returns the existing validated IR, generator plan and semantic views. `generate` uses the same compiler and TypeScript renderer as the fenced workspace publisher, but returns artifact source in memory.

A runnable closed input and library consumer are retained under [`examples/semantic-query/`](examples/semantic-query/). With the pinned dependencies already available, either consumer can run directly:

```console
bun src/bootstrap/cli/cli.ts semantic analyze --input examples/semantic-query/input.json --json
bun src/bootstrap/cli/cli.ts semantic generate --input examples/semantic-query/input.json --json --compact
bun examples/semantic-query/consume.ts
```

The JSON contains `engineeringIRInput`, the existing captured IR-build profile, not a new general authoring language. Generator declarations are derived from its manifests and selected blocks unless explicitly supplied by an existing adapter. JSON provenance fields are input values, not new registry or write authority. Without `--input`, the CLI reads the existing workspace through its normal read adapter; neither query mode writes the workspace.

The current generator emits state-transition maps. The returned set is explicitly scoped to `semantic-tasks`; required native types/imports still belong to the supplied target implementation. This is not a complete native package, a build result, or proof of passed verification. Change the transition in the same input JSON and generate again to obtain a new semantic revision; previous query results remain detached from later author edits.

A runtime defaults to one in-flight query. The host may select a positive finite `maximumPendingQueries` when constructing it; excess requests fail with `RUNTIME-BUSY-001` before copying their inputs, rather than entering an unbounded queue. `close()` stops admission and drains accepted calls. Native cancellation stays live, but these boundaries are not heap hard limits or preemption of synchronous compiler work. The API remains a revision-pinned development preview.

The supported repository checks are listed in `package.json`; contribution work should follow the current development entry in [`AGENTS.md`](AGENTS.md) rather than treating one fixed command as sufficient for every change.

## Release and compatibility policy

Public repository visibility means that the project can be inspected and contributed to. It does not declare a stable API, production readiness, long-term support, or a versioned product release.

A future release must state its supported capabilities, targets, compatibility boundary, verification coverage, installation path, and known limitations. Until then, consumers should pin an exact revision and expect architecture and implementation interfaces to change.

Repository-owned software and executable engineering material are available under [MPL-2.0](LICENSE). Repository-owned documentation and specifications are available under [CC BY 4.0](LICENSES/CC-BY-4.0.txt). The exact boundary is recorded in [`LICENSES/README.md`](LICENSES/README.md) and [`REUSE.toml`](REUSE.toml); third-party dependencies and materials remain subject to their own licenses and notices.
