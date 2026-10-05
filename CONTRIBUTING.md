# Contributing to the Engineering Workspace Compiler

SEC is in development preview. Its interfaces and contribution workflow may change before a stable release.

## Before contributing

Read these entry points first:

1. [`README.md`](README.md) — public project overview.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — public architecture projection.
3. [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — current public maturity boundary.
4. [`AGENTS.md`](AGENTS.md) — repository development and authority rules.
5. [`docs/README.md`](docs/README.md) — canonical design-document index.

The public summaries are not a second architecture authority. When they conflict with the canonical owners under `docs/**`, the canonical owner wins and the public projection must be corrected.

## Development environment

The current implementation uses Bun and TypeScript. Use the repository-pinned runtime/toolchain declarations rather than copying version numbers from documentation:

- `.bun-version`
- `package.json`
- `bun.lock`

Install dependencies from the repository root with the package manager declared in `package.json`.

Before making a change, follow the development entry point in [`AGENTS.md`](AGENTS.md). It resolves the current work state and the scope of the operation.

## Change principles

A contribution should preserve the project's core engineering boundaries:

- one canonical owner for each piece of engineering truth;
- explicit identity, revision, authority, effect, failure, recovery, and evidence boundaries where they matter;
- AI output is proposal or bounded execution input, not self-authenticating engineering truth;
- unknown or unsupported states fail honestly rather than being converted into success;
- planning and observation do not silently mutate the target workspace;
- existing programming languages and external tools are reusable providers/targets, not concepts to duplicate without a real semantic need;
- a new abstraction needs a real producer, consumer, distinct invariant, and lifecycle rather than only a new name.

## Keep changes focused

Group changes around a concrete behavior or defect, including its affected callers and checks. Keep unrelated architecture, dependency, workflow, documentation, and product changes separate.

Describe the problem, resulting behavior, and validation in the pull request. Update the same PR as the change develops; when a replacement is necessary, link the predecessor and successor and explain what carries over. Keep temporary diagnostic workflows and exploratory output out of the final product change. The branch lifecycle and publication rules are in [`AGENTS.md`](AGENTS.md).

Do not introduce a second parser, resolver, state store, verification truth, source-of-truth document, or compatibility path when an existing owner can be extended. If a temporary migration path is necessary, give it an explicit retirement condition.

## Verification

Use the repository's current machine-selected verification closure rather than assuming that a fixed list of commands is always sufficient. For local development, the scripts in `package.json` expose the supported check/test entry points, while [`docs/运行/保证/README.md`](docs/运行/保证/README.md) leads to the canonical verification and evidence semantics.

Report which checks ran, their results, the revision they cover, and any material gaps. Distinguish failed, blocked, and unrun checks. Link detailed logs when needed rather than copying repeated progress reports into the PR description. Local checks and source review alone do not establish release readiness.

## Documentation

When a change alters a canonical product or architecture decision, update the owning canonical document rather than creating duplicate prose elsewhere. Public documentation should project that decision for readers and link back to its canonical owner.

Stable documentation should avoid embedding transient branch names, pull-request numbers, current commit SHAs, or temporary provider state unless the document is explicitly an historical record.

## Public API and compatibility

The project has not yet declared a stable public API. Do not infer compatibility guarantees from the current package version, file layout, CLI command shape, or internal TypeScript types. Any future compatibility guarantee must be explicitly versioned and released.

## Licensing

By submitting a contribution, you represent that you have the right to provide it under the license assigned to its destination files. Software and executable engineering material are contributed under MPL-2.0; documentation and specifications are contributed under CC BY 4.0. The exact repository classification is in [`LICENSES/README.md`](LICENSES/README.md) and [`REUSE.toml`](REUSE.toml).

Do not submit material whose license is incompatible with that destination. Third-party material must retain its copyright, license, provenance, and any required notices; identify it explicitly in the pull request.
