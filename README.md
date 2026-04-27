# Engineering Compiler

This repository packages the engineering compiler, its CLI, and the reference project used by the pipeline tests.

## Start Here

- Install dependencies with `npm install`.
- Run the full verification pass with `npm run check`.
- Use the compiler CLI with `npm run platform -- <command>`.
- Run the quickstart demo with `npm run demo:quickstart`.
- Run the full product closed loop with `npm run demo:closed-loop`.
- Dogfood the reference workspace with `npm run dogfood:reference`.
- Refresh the reference workspace and governance artifacts with `npm run reference:refresh`.

## Developer Entry Model

The platform is a software tool, not the normal editing surface for product developers. Product developers should work through the external workspace contract and platform commands instead of entering platform source folders.

Default developer surface:

- `project/app.plan.yaml`: product plan, selected blocks, registry sources, slots, and acceptance intent
- `project/custom/**`: project-owned custom implementation
- `project/overrides/**`: governed overrides, patches, rules, and override manifests
- `project/policies/**`: project policy input
- `platform/registry/private/**`: temporary MVP workspace-private blocks and manifests until they move to a separate private registry package or service

Internal implementation surface:

- `platform/compiler/**`
- `platform/shared/**`
- `platform/registry/official/**`
- generated runtime scaffold files under `project/`

If a product change appears to require editing internal platform source, first express it as one of these external inputs:

- a plan/spec change in `project/app.plan.yaml`
- a private block under `platform/registry/private/**`
- a slot or adapter rule
- a rule-backed override under `project/overrides/**`
- a policy update under `project/policies/**`

Use these entry commands for normal development:

- `npm run platform -- doctor`: inspect local developer environment and dependency health
- `npm run platform -- deps status`: inspect dependency cache/link status
- `npm run platform -- deps status --json --compact`: emit a machine-readable dependency environment contract
- `npm run platform -- deps warmup`: prepare shared runtime dependencies
- `npm run platform -- deps relink project`: make `project/node_modules` point back to shared dependencies
- `npm run platform -- artifacts --paths --json --compact --kind governance`: emit compact upload-path contracts
- `npm run platform -- contract freeze --json --compact`: emit the compact contract-freeze target list
- `npm run platform -- contract errors`: inspect the error protocol contract
- `npm run platform -- contract errors --json --compact`: emit the compact error protocol contract
- `npm run platform -- contract ci --json --compact`: emit the compact team CI command contract, including top-level verify, quality, diagnostic, and artifact upload commands
- `npm run platform -- test budget`: inspect the fast/runtime/all slow-test budget
- `npm run platform -- test budget --json --compact`: emit the compact slow-test budget contract
- `npm run platform -- policy report`: inspect the latest policy governance report
- `npm run platform -- policy report --json --compact`: emit the compact policy governance report
- `npm run platform -- acceptance coverage`: inspect the latest acceptance coverage report
- `npm run platform -- acceptance coverage --json --compact`: emit the compact acceptance coverage report
- `npm run platform -- runtime report`: inspect the latest runtime verification report
- `npm run platform -- runtime report --json --compact`: emit the compact runtime verification report
- `npm run platform -- verification report`: inspect the latest verification report
- `npm run platform -- verification report --json --compact`: emit the compact verification report
- `npm run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `npm run platform -- provenance registry`: inspect the latest provenance registry
- `npm run platform -- provenance registry --json --compact`: emit the compact provenance registry contract
- `npm run platform -- review summary`: inspect the latest review summary
- `npm run platform -- review summary --json --compact`: emit the compact review summary contract
- `npm run platform -- repair --dry-run --json --compact`: emit the compact repair plan contract
- `npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact`: emit the compact upgrade plan contract
- `npm run platform -- reference check`: refresh the checked-in reference workspace and fail on drift
- `npm run platform -- reference check --json --compact`: emit a machine-readable reference drift contract
- `npm run platform -- benchmark suite`: inspect the benchmark/task-suite contract
- `npm run platform -- benchmark suite --json --compact`: emit the compact benchmark/task-suite contract, including runner command, aggregated artifact paths, and score dimensions
- `npm run platform -- deps clean --project|--shared|--npm-cache`: clean one dependency layer through a controlled tool entry
- `npm run platform -- deps clean --all --force`: remove project, shared, and npm-cache dependency state; this intentionally causes the next runtime verification to warm dependencies again
- `npm run platform -- add <block-id>`: add official or private blocks
- `npm run platform -- resolve && npm run platform -- compose && npm run platform -- adapt`: refresh compiled project artifacts
- `npm run platform -- verify`: run the default fast lane with generated runtime service tests
- `npm run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `npm run platform -- verify --lane fast|runtime|all`: choose a specific verification lane; full Playwright runtime acceptance only runs in all
- `npm run platform -- repair`: create or apply bounded repairs from verification failures
- `npm run platform -- upgrade <block-id> <target-version> --dry-run`: review upgrade impact before applying it
- `npm run platform -- lock && npm run platform -- explain`: freeze and inspect governance outputs

For the final product shape, the expected external developer environment is a CLI plus optional Workbench or IDE plugin over the same contract. The Workbench may provide forms, graph views, slot editors, policy editors, and verification dashboards, but it must call the same platform commands and write the same external workspace inputs rather than requiring developers to edit platform source.

Workbench and IDE integrations must preserve this boundary:

- Allowed reads: workspace plan, private block manifests, overrides, policies, generated governance artifacts, provenance, and graph lock files
- Allowed writes: `project/app.plan.yaml`, `project/custom/**`, `project/overrides/**`, `project/policies/**`, and the temporary MVP private registry path
- Required command surface: `doctor`, `deps status`, `add`, `resolve`, `compose`, `adapt`, `verify`, `repair`, `upgrade --dry-run`, `lock`, and `explain`
- Forbidden writes: compiler internals, shared platform utilities, official registry blocks, generated runtime scaffold, and dependency directories outside the controlled `deps` commands

## Repository Layout

- `platform/`: compiler pipeline, adapters, and the CLI entrypoint at `platform/cli/index.ts`
- `project/`: reference project inputs and generated artifacts that the compiler works against
- `tests/`: pipeline, registry, and repair coverage
- `docs/`: design notes, implementation specs, and rollout material

## Command Entry Taxonomy

- `npm run platform -- <command>`: raw compiler CLI entry for targeted operations.
- `npm run reference:*`: refresh the checked-in `project/` workspace without resetting it.
- `npm run demo:*`: reset or package a user-facing demo path from the reference workspace.
- `npm run dogfood:*`: exercise the checked-in reference workspace as the product dogfood surface.
- `npm run test:*`: run development verification or print verification budget contracts.

## Common Commands

- `npm run check`: TypeScript typecheck plus the main test suite
- `npm test`: run the Node test suite directly
- `npm run test:budget`: print the formal fast/runtime/all lane slow-test JSON contract through `platform test budget`
- `npm run test:contract-freeze`: run the CLI/script/governance contract freeze suite declared by `platform contract freeze`
- `npm run test:benchmark-contract`: print the formal benchmark/task-suite JSON contract through `platform benchmark suite`
- `npm run demo:quickstart`: reset the reference project, then run the full governance refresh
- `npm run demo:governance`: run quickstart and print governance artifact upload paths
- `npm run demo:closed-loop`: run the primary product closed loop of quickstart, full verification, governance artifact paths, and compact explain JSON
- `npm run dogfood:reference`: refresh the checked-in reference workspace without resetting it
- `npm run dogfood:governance`: refresh dogfood outputs and print the structured artifact path contract
- `npm run reference:refresh`: refresh `project/` in place through `resolve -> compose -> adapt -> verify --lane all -> lock -> explain`
- `npm run reference:check`: run the formal reference drift gate through `platform reference check`
- `npm run platform -- contract freeze --json --compact`: emit the compact contract-freeze target list
- `npm run platform -- contract errors --json --compact`: emit the compact error protocol contract
- `npm run platform -- contract ci --json --compact`: emit the compact team CI command contract, including top-level verify, quality, diagnostic, and artifact upload commands
- `npm run platform -- test budget --json --compact`: emit the compact slow-test budget contract
- `npm run platform -- policy report --json --compact`: emit the compact policy governance report
- `npm run platform -- acceptance coverage --json --compact`: emit the compact acceptance coverage report
- `npm run platform -- runtime report --json --compact`: emit the compact runtime verification report
- `npm run platform -- verification report --json --compact`: emit the compact verification report
- `npm run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `npm run platform -- provenance registry --json --compact`: emit the compact provenance registry contract
- `npm run platform -- review summary --json --compact`: emit the compact review summary contract
- `npm run platform -- repair --dry-run --json --compact`: emit the compact repair plan contract
- `npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact`: emit the compact upgrade plan contract
- `npm run platform -- reference check --json --compact`: emit the compact reference drift contract
- `npm run platform -- benchmark suite --json --compact`: emit the compact benchmark/task-suite contract, including runner command, aggregated artifact paths, and score dimensions
- `npm run platform -- resolve`
- `npm run platform -- compose`
- `npm run platform -- adapt`
- `npm run platform -- verify`
- `npm run platform -- verify --lane all`
- `npm run platform -- explain`

## Governance Artifacts

- `verify` writes governance artifacts under `project/generated/`, including `verification-report.json`, `runtime-report.json`, `policy-report.json`, and `acceptance-coverage.json`.
- `explain` writes `project/generated/explain-graph.json`, `project/generated/review-summary.json`, and the local HTML views under `project/generated/views/`.
- Governance contract freeze currently covers: `project/graph.lock.json`, `project/provenance.json`, `project/generated/verification-report.json`, `project/generated/runtime-report.json`, `project/generated/policy-report.json`, `project/generated/acceptance-coverage.json`, `project/generated/explain-graph.json`, and `project/generated/review-summary.json`.
- CI restores a complete governance view from exactly three stable paths: `project/generated/**`, `project/provenance.json`, and `project/graph.lock.json`.
- `.shared-deps/` is a local Bun/npm cache used to warm runtime dependencies; it is intentionally ignored and is not part of the shipped governance artifacts.
- `infra/postgres` currently ships a contract-only Postgres path. It emits `project/generated/postgres-contract.json` and keeps the local runtime on the in-memory store until a real Postgres verification lane is added.

When working in Codex web, start from the repo root. Most tasks either touch `platform/` or validate behavior through `tests/`.
