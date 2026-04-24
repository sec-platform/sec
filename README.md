# Engineering Compiler

This repository packages the engineering compiler, its CLI, and the reference project used by the pipeline tests.

## Start Here

- Install dependencies with `npm install`.
- Run the full verification pass with `npm run check`.
- Use the compiler CLI with `npm run platform -- <command>`.
- Refresh the reference workspace and governance artifacts with `npm run reference:refresh`.

## Repository Layout

- `platform/`: compiler pipeline, adapters, and the CLI entrypoint at `platform/cli/index.ts`
- `project/`: reference project inputs and generated artifacts that the compiler works against
- `tests/`: pipeline, registry, and repair coverage
- `docs/`: design notes, implementation specs, and rollout material

## Common Commands

- `npm run check`: TypeScript typecheck plus the main test suite
- `npm test`: run the Node test suite directly
- `npm run reference:refresh`: refresh `project/` in place through `resolve -> compose -> adapt -> verify --lane all -> lock -> explain`
- `npm run platform -- resolve`
- `npm run platform -- compose`
- `npm run platform -- adapt`
- `npm run platform -- verify`
- `npm run platform -- explain`

## Governance Artifacts

- `verify` writes governance artifacts under `project/generated/`, including `verification-report.json`, `runtime-report.json`, `policy-report.json`, and `acceptance-coverage.json`.
- `explain` writes `project/generated/explain-graph.json`, `project/generated/review-summary.json`, and the local HTML views under `project/generated/views/`.
- CI restores a complete governance view from exactly three stable paths: `project/generated/**`, `project/provenance.json`, and `project/graph.lock.json`.
- `.shared-deps/` is a local Bun/npm cache used to warm runtime dependencies; it is intentionally ignored and is not part of the shipped governance artifacts.
- `infra/postgres` currently ships a contract-only Postgres path. It emits `project/generated/postgres-contract.json` and keeps the local runtime on the in-memory store until a real Postgres verification lane is added.

When working in Codex web, start from the repo root. Most tasks either touch `platform/` or validate behavior through `tests/`.
