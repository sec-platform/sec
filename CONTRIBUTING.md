# Contributing to the Engineering Workspace Compiler

This repository retains the historical name `sec`; that name is not the current project definition or acronym. The Engineering Workspace Compiler is under active architecture and implementation convergence. Interfaces and contribution workflows may still change before the first stable public release.

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

Before making a change, use the repository's canonical development entry point described in [`AGENTS.md`](AGENTS.md). It resolves the current development state and the applicable authority/scope rather than treating an Issue, branch name, PR description, or stale document as execution authority.

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

Prefer the smallest complete vertical change that closes one real responsibility or defect. Avoid combining unrelated architecture, dependency, workflow, documentation, and product changes into one pull request.

Do not introduce a second parser, resolver, state store, verification truth, source-of-truth document, or compatibility path when an existing owner can be extended. If a temporary migration path is necessary, give it an explicit retirement condition.

## Verification

Use the repository's current machine-selected verification closure rather than assuming that a fixed list of commands is always sufficient. For local development, the scripts in `package.json` expose the supported check/test entry points, while [`docs/运行/保证/README.md`](docs/运行/保证/README.md) leads to the canonical verification and evidence semantics.

A green test, command exit code, generated file, or AI review does not by itself prove that a product capability is complete or safe to release. Verification claims must remain bound to the exact subject, input, environment, and evidence they actually cover.

## Documentation

When a change alters a canonical product or architecture decision, update the owning canonical document rather than creating duplicate prose elsewhere. Public documentation should project that decision for readers and link back to its canonical owner.

Stable documentation should avoid embedding transient branch names, pull-request numbers, current commit SHAs, or temporary provider state unless the document is explicitly an historical record.

## Public API and compatibility

The project has not yet declared a stable public API. Do not infer compatibility guarantees from the current package version, file layout, CLI command shape, or internal TypeScript types. Any future compatibility guarantee must be explicitly versioned and released.

## Licensing

By submitting a contribution, you represent that you have the right to provide it under the license assigned to its destination files. Software and executable engineering material are contributed under MPL-2.0; documentation and specifications are contributed under CC BY 4.0. The exact repository classification is in [`LICENSES/README.md`](LICENSES/README.md) and [`REUSE.toml`](REUSE.toml).

Do not submit material whose license is incompatible with that destination. Third-party material must retain its copyright, license, provenance, and any required notices; identify it explicitly in the pull request.
