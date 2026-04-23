# Engineering Compiler

This repository packages the engineering compiler, its CLI, and the reference project used by the pipeline tests.

## Start Here

- Install dependencies with `npm install`.
- Run the full verification pass with `npm run check`.
- Use the compiler CLI with `npm run platform -- <command>`.

## Repository Layout

- `platform/`: compiler pipeline, adapters, and the CLI entrypoint at `platform/cli/index.ts`
- `project/`: reference project inputs and generated artifacts that the compiler works against
- `tests/`: pipeline, registry, and repair coverage
- `docs/`: design notes, implementation specs, and rollout material

## Common Commands

- `npm run check`: TypeScript typecheck plus the main test suite
- `npm test`: run the Node test suite directly
- `npm run platform -- resolve`
- `npm run platform -- compose`
- `npm run platform -- adapt`
- `npm run platform -- verify`
- `npm run platform -- explain`

When working in Codex web, start from the repo root. Most tasks either touch `platform/` or validate behavior through `tests/`.
