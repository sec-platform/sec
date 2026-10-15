# Project status

Gift is a **development preview**. This page describes available source entry points and their limits. The design specifications cover a broader target than the current implementation.

## What exists today

The repository contains:

- the current integrated design corpus on `main`, with product, authoring, compilation, runtime, assurance, evolution, information, and domain specifications;
- a TypeScript implementation organized around explicit contracts, workspace state, semantic interpretation, compilation, assurance, application coordination, execution, adapters, entry points, and composition;
- tests, repository audits, documentation checks, development-control machinery, and GitHub workflows;
- authoring examples and reference/demo entry points.

## Maturity boundary

Assess maturity for a specific capability, revision, environment, and requested result. The following dimensions require their own evidence:

| Dimension | What must be established |
|---|---|
| Proposal and acceptance | What was proposed, what was accepted, and by whose authority |
| Specification | The accepted behavior, interfaces, assumptions, and failure boundaries |
| Implementation | The code and actual consumers that provide that behavior |
| Verification | The claims checked, methods used, and exact inputs and environments covered |
| Enforcement | Where a required constraint is applied at the real boundary |
| Adoption | Where the result was actually installed, published, or used, when requested |
| Retirement | Which replaced paths and residual responsibilities were settled, when replacement occurred |

These are related evidence dimensions rather than a mandatory sequence for every task. A design task can finish with a complete specification; a pure query can finish with its returned result. Deployment, user-effect validation, and retirement apply when the accepted task includes those obligations. Evidence for one dimension does not establish the others. Keep these limitations explicit:

- documented designs, target languages, and environments may remain unimplemented;
- the CLI, package layout, TypeScript types, and internal protocols may change without compatibility guarantees;
- local test results cover their tested inputs and environment; production readiness requires separate evidence;
- generating source is separate from adopting and verifying it in a target project.

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

A runnable [closed input](examples/semantic-query/input.json) and [library consumer](examples/semantic-query/consume.ts) are retained under `examples/semantic-query/`. With the pinned dependencies already available, either consumer can run directly:

```console
bun src/bootstrap/cli/cli.ts semantic analyze --input examples/semantic-query/input.json --json
bun src/bootstrap/cli/cli.ts semantic generate --input examples/semantic-query/input.json --json --compact
bun examples/semantic-query/consume.ts
```

The JSON contains only `engineeringIRInput`, the existing captured IR-build profile, not a new general authoring language. Both the captured API and JSON reader reject unsupported top-level fields. Generator declarations are always derived from the captured manifests and selected blocks. Query `roots` selects generator identities: omission includes all generators, an explicit subset includes only those generators, and `[]` selects no generation. JSON provenance fields are input values, not new registry or write authority. Without `--input`, the CLI reads the existing workspace through its normal read adapter; neither query mode writes the workspace.

The current generator emits state-transition maps. The returned set is explicitly scoped to `semantic-tasks`; required native types/imports still belong to the supplied target implementation. This is not a complete native package, a build result, or proof of passed verification. Change the transition in the same input JSON and generate again to obtain a new semantic revision; previous query results remain detached from later author edits.

A runtime defaults to one in-flight query. The host may select a positive safe integer `maximumPendingQueries` when constructing it; excess requests fail with `RUNTIME-BUSY-001` before copying their inputs, rather than entering an unbounded queue. `close()` stops admission and drains accepted calls. Native cancellation stays live, but these boundaries are not heap hard limits or preemption of synchronous compiler work. The API remains a revision-pinned development preview.

The supported repository checks are listed in `package.json`; contribution work should follow the current development entry in [`AGENTS.md`](AGENTS.md) rather than treating one fixed command as sufficient for every change.

## Release and compatibility policy

The public repository is open for inspection and contributions. It has no declared stable API, production-readiness guarantee, long-term support policy, or versioned product release.

A future release must state its supported capabilities, targets, compatibility boundary, verification coverage, installation path, and known limitations. Until then, consumers should pin an exact revision and expect architecture and implementation interfaces to change.

Repository-owned software and executable engineering material are available under [MPL-2.0](LICENSE). Repository-owned documentation and specifications are available under [CC BY 4.0](LICENSES/CC-BY-4.0.txt). The exact boundary is recorded in [`LICENSES/README.md`](LICENSES/README.md) and [`REUSE.toml`](REUSE.toml); third-party dependencies and materials remain subject to their own licenses and notices.
