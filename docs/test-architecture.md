# Test architecture

This repository uses a tiered test model designed for fast local feedback, stable CI gates, and explicit full-runtime validation.

## Lanes

- `unit`: pure logic and contract builders; no workspace pipeline.
- `integration`: cached or temporary workspace behavior; no full runtime/Playwright gate.
- `contract`: fast CLI/API/JSON/error/CI protocol freeze tests. Contract freeze must not include `tests/e2e/*`.
- `e2e.slow`: real pipeline, runtime, Next build, Playwright, or long filesystem flows.
- `full`: scheduled or release validation across fast and slow suites.

## Rules

1. Contract tests verify invariants derived from the contract object, not mirrored target lists or counts.
2. Use exact numbers only for stable protocol versions, command names, fixed IDs, and intentionally fixed example counts.
3. Prefer semantic assertions such as `arrayContaining`, `toBeGreaterThan(0)`, and key-field checks over full-object duplication.
4. `imports:check` is non-mutating. Use `imports:organize` to fix files locally.
5. CI installs use `bun install --frozen-lockfile`.
6. Slow e2e tests have explicit timeouts and are never part of `contract-freeze`.
7. `test:affected` uses `platform/shared/test-impact-contract.ts` to select affected fast/integration tests and only reports slow impact.
8. `test:slow` is the explicit slow runner; use `--suite <name>` for targeted full-runtime suites.
9. Golden helpers live in `tests/helpers/golden-helpers.ts` and should be used only for stable protocol JSON, not timestamps or raw stdout.
10. Scenario and semantic matcher helpers should reduce repeated workspace setup and hardcoded object assertions.
11. CI separates PR quick, PR risk, and scheduled/release full gates.

## Commands

- `bun run test`: fast lane.
- `bun run test:affected`: affected fast feedback.
- `bun run test:contract-freeze`: fast protocol freeze.
- `bun run test:slow`: slow e2e only.
- `bun run test:full`: fast + slow.
- `bun run check`: local PR gate.
- `bun run check:full`: release/full gate.

## Ownership map

`platform/shared/test-impact-contract.ts` is the source of truth for source-to-test ownership. Add new source domains there before adding broad fallback behavior to `test:affected`.
