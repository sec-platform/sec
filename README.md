# Engineering Compiler

This repository packages the engineering compiler, its CLI, and the reference project used by the pipeline tests.

## Start Here

- Install dependencies with `bun install`.
- Run the fast local verification pass with `bun run check`.
- Run the full test regression explicitly with `bun run check:full`.
- Use the compiler CLI with `bun run platform -- <command>`.
- Run the quickstart demo with `bun run demo:quickstart`.
- Run the full product closed loop with `bun run demo:closed-loop`.
- Dogfood the reference workspace with `bun run dogfood:reference`.
- Refresh the reference workspace and governance artifacts with `bun run reference:refresh`.
- Test feedback, CI lane, contract-freeze, and package script rules are documented in `docs/test-feedback-and-ci-lanes.md`.
- Slow suite registry, suite IDs, and full lane sharding are documented in `docs/slow-suite-registry.md`.

## Developer Entry Model

The platform is a software tool, not the normal editing surface for product developers. Product developers should work through the external workspace contract and platform commands instead of entering platform source folders.

Default workspace contract:

- `source/app.yaml`: product plan, selected blocks, registry sources, slots, and acceptance intent
- `source/code/slots/**`: project-owned slot source; compiler passes materialize v0.1 runtime targets under `project/custom/**`
- `source/code/{app,server,ui,shared,integrations}/**`: user-owned application code that the platform can model through explicit contracts
- `source/code/opaque/**`: user-owned modules whose internals are not rewritten, while exports, effects, permissions, provenance, and verification remain governed
- `source/code/lab/**`: temporary experiments that must be promoted into slots, app code, patches, or private blocks before shipping
- `source/model/**`: product model inputs, including policies, acceptance, capabilities, entities, flows, and permissions
- `source/patches/**`: governed overrides, rules, patches, and override manifests
- `source/assets/**`, `source/views/**`, `source/env/**`: workspace assets, Workbench view specs, and environment declarations
- `source/views/mutations/*.json`: structured Workbench/IDE edits that are applied back to `source/app.yaml`
- `source/blocks/private/**`: workspace-private block drafts; preferred before the compatibility private registry
- `project/**`: generated runnable target; inspectable and debuggable, but not the default authoring surface
- `control/**`: control plane for state, evidence, graph, provenance, workflow, Workbench projections, audit, and CI upload manifests
- `.pjc/**`: local cache, temporary indexes, previews, and AI session state; safe to recreate
- Compatibility inputs: `project/custom/**`, `project/overrides/**`, `project/policies/**`, and `platform/registry/private/**`

Internal implementation surface:

- `platform/compiler/**`
- `platform/shared/**`
- `platform/registry/official/**`
- generated runtime scaffold files under `project/`

If a product change appears to require editing internal platform source, first express it as one of these external inputs:

- a plan/spec change in `source/app.yaml`
- a private block under `source/blocks/private/**`
- a slot or adapter rule under `source/code/slots/**`
- a rule-backed patch or override manifest under `source/patches/**`
- a policy update under `source/model/policies/**`

Use these entry commands for normal development:

- `bun run platform -- doctor`: inspect local developer environment, four-root workspace readiness, and dependency health, including readiness check count
- `bun run platform -- deps status`: inspect dependency cache/link status
- `bun run platform -- deps status --json --compact`: emit a machine-readable dependency environment contract
- `bun run platform -- deps warmup`: prepare shared runtime dependencies
- `bun run platform -- deps relink`: make `project/node_modules` point back to shared dependencies
- `bun run platform -- artifacts --paths --json --compact --kind governance`: emit compact upload-path contracts with upload group counts
- `bun run platform -- artifacts manifest --json --compact`: inspect the latest compact artifact manifest without regenerating it
- `bun run platform -- workbench mutations apply`: apply structured Workbench edits from `source/views/mutations/*.json` back to `source/app.yaml`
- `bun run platform -- workbench mutations apply --json --compact`: emit the compact Workbench mutation report contract
- `bun run platform -- demo checklist`: inspect the local demo readiness checklist from existing governance artifacts
- `bun run platform -- demo checklist --json --compact`: emit the compact demo readiness checklist contract
- `bun run platform -- contract freeze --json --compact`: emit the compact contract-freeze target list, including inspect command, runner command, and target commands
- `bun run platform -- contract errors`: inspect the error protocol contract
- `bun run platform -- contract errors --json --compact`: emit the compact error protocol contract, including issue type count and diagnostic artifact paths
- `bun run platform -- contract ci --json --compact`: emit the compact team CI command contract, including top-level verify, typecheck, quality, contract freeze, reference drift, review matrix, review diagnostics, demo checklist, diagnostic, artifact upload commands, command counts, per-step produced artifact counts, and produced artifact paths
- `bun run platform -- test budget`: inspect the fast/runtime/all slow-test budget
- `bun run platform -- test budget --json --compact`: emit the compact slow-test budget contract, including inspect command, runner command, lane count, slow lane count, and slow lane IDs
- `bun run platform -- policy report`: inspect the latest policy governance report
- `bun run platform -- policy report --json --compact`: emit the compact policy governance report
- `bun run platform -- policy sources`: inspect the latest policy source map without running verify
- `bun run platform -- policy sources --json --compact`: emit the compact policy source contract
- `bun run platform -- acceptance coverage`: inspect the latest acceptance coverage report
- `bun run platform -- acceptance coverage --json --compact`: emit the compact acceptance coverage report
- `bun run platform -- acceptance blocks --json --compact`: emit the compact acceptance block coverage contract
- `bun run platform -- acceptance slots --json --compact`: emit the compact acceptance slot coverage contract
- `bun run platform -- install manifest`: inspect the latest install manifest without running compose
- `bun run platform -- install manifest --json --compact`: emit the compact install manifest contract
- `bun run platform -- blocks usage`: inspect the latest block usage map without running compose
- `bun run platform -- blocks usage --json --compact`: emit the compact block usage map contract
- `bun run platform -- postgres contract`: inspect the latest Postgres contract without running compose
- `bun run platform -- postgres contract --json --compact`: emit the compact Postgres contract
- `bun run platform -- lock inspect`: inspect the latest graph lock without running lock
- `bun run platform -- lock inspect --json --compact`: emit the compact graph lock contract without regenerating it
- `bun run platform -- runtime report`: inspect the latest runtime verification report
- `bun run platform -- runtime report --json --compact`: emit the compact runtime verification report
- `bun run platform -- verification report`: inspect the latest verification report
- `bun run platform -- verification report --json --compact`: emit the compact verification report
- `bun run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `bun run platform -- provenance registry`: inspect the latest provenance registry
- `bun run platform -- provenance registry --json --compact`: emit the compact provenance registry contract
- `bun run platform -- review summary`: inspect the latest review summary, including top-level activity counts, provenance generated artifact count and summary counts, artifact upload group, and missing reason type counts
- `bun run platform -- review summary --json --compact`: emit the compact review summary contract, including top-level activity counts
- `bun run platform -- review matrix`: inspect the latest E2E matrix without regenerating explain outputs
- `bun run platform -- review matrix --json --compact`: emit the compact E2E matrix contract
- `bun run platform -- review diagnostics`: inspect failure, regression risk, and conflict diagnostics from the latest review summary
- `bun run platform -- review diagnostics --json --compact`: emit the compact review diagnostics contract
- `bun run platform -- explain graph`: inspect the latest explain graph without regenerating it
- `bun run platform -- explain graph --json --compact`: emit the compact explain graph contract without regenerating it
- `bun run platform -- repair --dry-run --json --compact`: emit the compact repair plan contract, including repair target file count
- `bun run platform -- repair plan --json --compact`: inspect the latest compact repair plan contract without rerunning repair
- `bun run platform -- upgrade <block-id> <target-version> --dry-run --json --compact`: emit the compact upgrade plan contract, including source migration count, slot migration count, and migration operation count
- `bun run platform -- upgrade plan --json --compact`: inspect the latest compact upgrade plan contract without rerunning upgrade
- `bun run platform -- upgrade diagnostics --json --compact`: inspect the latest compact upgrade diagnostics contract without rerunning upgrade
- `bun run platform -- reference check`: refresh the checked-in reference workspace and fail on drift
- `bun run platform -- reference check --json --compact`: emit a machine-readable reference drift contract with inspect command, runner command, refresh command, and diff command
- `bun run platform -- benchmark suite`: inspect the benchmark/task-suite contract
- `bun run platform -- benchmark suite --json --compact`: emit the compact benchmark/task-suite contract, including inspect command, runner command, aggregated artifact paths, per-task artifact path count, score focus count, score dimension count, and score dimensions
- `bun run platform -- deps clean --project|--shared|--bun-cache`: clean one dependency layer through a controlled tool entry
- `bun run platform -- deps clean --all --force`: remove project, shared, and Bun cache dependency state; this intentionally causes the next runtime verification to warm dependencies again
- `bun run platform -- add <block-id>`: add official or private blocks
- `bun run platform -- resolve && bun run platform -- compose && bun run platform -- adapt`: refresh compiled project artifacts
- `bun run platform -- verify`: run the default fast lane with generated runtime service tests
- `bun run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `bun run platform -- verify --lane fast|runtime|all`: choose a specific verification lane; full Playwright runtime acceptance only runs in all
- `bun run platform -- repair`: create or apply bounded repairs from verification failures
- `bun run platform -- upgrade <block-id> <target-version> --dry-run`: review upgrade impact before applying it
- `bun run platform -- upgrade plan`: inspect the latest upgrade plan without rerunning upgrade
- `bun run platform -- upgrade diagnostics`: inspect the latest upgrade diagnostics without rerunning upgrade
- `bun run platform -- lock && bun run platform -- explain`: freeze and inspect governance outputs

For the final product shape, the expected external developer environment is a CLI plus optional Workbench or IDE plugin over the same contract. The Workbench may provide forms, graph views, slot editors, policy editors, and verification dashboards, but it must call the same platform commands and write the same external workspace inputs rather than requiring developers to edit platform source.

Workbench and IDE integrations must preserve this boundary:

- Allowed reads: `source/**`, generated runtime summaries under `project/**`, and governance/control artifacts under `control/**`
- Allowed writes: `source/app.yaml`, `source/code/**`, `source/model/**`, `source/patches/**`, `source/assets/**`, `source/views/**`, `source/env/**`, `source/blocks/private/**`, plus compatibility inputs under `project/custom/**`, `project/overrides/**`, `project/policies/**`, and `platform/registry/private/**`
- Required command surface: `doctor`, `deps status`, `add`, `resolve`, `compose`, `adapt`, `verify`, `repair`, `upgrade --dry-run`, `lock`, `explain`, and `workbench mutations apply`
- Structured view edits must be written as mutation files under `source/views/mutations/*.json`; the compiler applies them to `source/app.yaml` and writes `control/workflow/view-mutation-report.json`
- Forbidden writes: compiler internals, shared platform utilities, official registry blocks, generated runtime scaffold, control-plane artifacts outside their owning pass, and dependency directories outside the controlled `deps` commands

## Repository Layout

- `platform/`: compiler pipeline, adapters, registries, and the CLI entrypoint at `platform/cli/index.ts`
- `source/`: checked-in developer authoring source and project intent
- `project/`: generated runnable reference target and runtime-compatible materialized files
- `control/`: checked-in control-plane state, evidence, provenance, graph, workflow, Workbench views, audit, and CI artifact manifests
- `.pjc/`: local cache, previews, indexes, test workspaces, and AI session state
- `tests/`: pipeline, registry, and repair coverage
- `docs/`: design notes, implementation specs, and rollout material

## Command Entry Taxonomy

- `bun run platform -- <command>`: raw compiler CLI entry for targeted operations.
- `bun run reference:*`: refresh the checked-in `source/` -> `project/` -> `control/` workspace without resetting it.
- `bun run demo:*`: reset or package a user-facing demo path from the reference workspace.
- `bun run dogfood:*`: exercise the checked-in reference workspace as the product dogfood surface.
- `bun run test:*`: run development verification or print verification budget contracts.

## Common Commands

- `bun run check`: alias for `bun run check:fast`
- `bun run check:fast`: TypeScript typecheck plus the fast local Bun test suite
- `bun run check:changed`: TypeScript typecheck plus changed/affected Bun tests for tight feedback
- `bun run check:full`: TypeScript typecheck plus the full Bun regression
- `bun run test`: run the fast local Bun test suite directly
- `bun run test:changed`: run changed/affected Bun tests without typecheck
- `bun run test:slow`: run slow e2e coverage explicitly
- `bun run test:all`: run the full Bun regression, including slow integration/runtime/E2E contract files
- `bun run test:budget`: print the formal fast/runtime/all lane slow-test JSON contract through `platform test budget`, including runner command, lane count, slow lane count, and slow lane IDs
- `bun run test:contract-freeze`: run the CLI/script/governance contract freeze suite through the runner command declared by `platform contract freeze`
- `bun run test:benchmark-contract`: print the formal benchmark/task-suite JSON contract through `platform benchmark suite`
- `bun run demo:quickstart`: reset the reference project, then run the full governance refresh
- `bun run demo:governance`: run quickstart and print governance artifact upload paths
- `bun run demo:closed-loop`: run the primary product closed loop of quickstart, full verification, governance artifact paths, and compact explain JSON
- `bun run platform -- demo checklist`: inspect whether existing governance artifacts satisfy local demo readiness
- `bun run dogfood:reference`: refresh the checked-in reference workspace without resetting it
- `bun run dogfood:governance`: refresh dogfood outputs and print the structured artifact path contract
- `bun run reference:refresh`: refresh `source/` into `project/` and `control/` through `resolve -> compose -> adapt -> verify --lane all -> lock -> explain`
- `bun run reference:check`: run the formal reference drift gate through the runner command exposed by `platform reference check`
- `bun run platform -- contract freeze --json --compact`: emit the compact contract-freeze target list, including inspect command, runner command, and target commands
- `bun run platform -- contract errors --json --compact`: emit the compact error protocol contract, including issue type count and diagnostic artifact paths
- `bun run platform -- contract ci --json --compact`: emit the compact team CI command contract, including top-level verify, typecheck, quality, contract freeze, reference drift, review matrix, review diagnostics, demo checklist, diagnostic, artifact upload commands, command counts, per-step produced artifact counts, and produced artifact paths
- `bun run platform -- artifacts manifest --json --compact`: inspect the latest compact artifact manifest without regenerating it
- `bun run platform -- test budget --json --compact`: emit the compact slow-test budget contract, including inspect command, runner command, lane count, slow lane count, and slow lane IDs
- `bun run platform -- policy report --json --compact`: emit the compact policy governance report
- `bun run platform -- policy sources --json --compact`: emit the compact policy source contract
- `bun run platform -- acceptance coverage --json --compact`: emit the compact acceptance coverage report
- `bun run platform -- acceptance blocks --json --compact`: emit the compact acceptance block coverage contract
- `bun run platform -- acceptance slots --json --compact`: emit the compact acceptance slot coverage contract
- `bun run platform -- install manifest --json --compact`: emit the compact install manifest contract
- `bun run platform -- blocks usage --json --compact`: emit the compact block usage map contract
- `bun run platform -- postgres contract --json --compact`: emit the compact Postgres contract
- `bun run platform -- lock inspect --json --compact`: emit the compact graph lock contract without regenerating it
- `bun run platform -- runtime report --json --compact`: emit the compact runtime verification report
- `bun run platform -- verification report --json --compact`: emit the compact verification report
- `bun run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `bun run platform -- provenance registry --json --compact`: emit the compact provenance registry contract
- `bun run platform -- review summary --json --compact`: emit the compact review summary contract, including top-level activity counts
- `bun run platform -- review matrix --json --compact`: emit the compact E2E matrix contract
- `bun run platform -- review diagnostics --json --compact`: emit the compact review diagnostics contract
- `bun run platform -- explain graph --json --compact`: emit the compact explain graph contract without regenerating it
- `bun run platform -- workbench mutations apply --json --compact`: emit the compact Workbench mutation report after applying `source/views/mutations/*.json` to `source/app.yaml`
- `bun run platform -- repair --dry-run --json --compact`: emit the compact repair plan contract, including repair target file count
- `bun run platform -- repair plan --json --compact`: inspect the latest compact repair plan contract without rerunning repair
- `bun run platform -- upgrade <block-id> <target-version> --dry-run --json --compact`: emit the compact upgrade plan contract, including source migration count, slot migration count, and migration operation count
- `bun run platform -- upgrade plan --json --compact`: inspect the latest compact upgrade plan contract without rerunning upgrade
- `bun run platform -- upgrade diagnostics --json --compact`: inspect the latest compact upgrade diagnostics contract without rerunning upgrade
- `bun run platform -- reference check --json --compact`: emit the compact reference drift contract, including inspect command, runner command, refresh command, and diff command
- `bun run platform -- benchmark suite --json --compact`: emit the compact benchmark/task-suite contract, including inspect command, runner command, aggregated artifact paths, per-task artifact path count, score focus count, score dimension count, and score dimensions
- `bun run platform -- resolve`
- `bun run platform -- compose`
- `bun run platform -- adapt`
- `bun run platform -- verify`
- `bun run platform -- verify --lane all`
- `bun run platform -- explain`

## Governance Artifacts

- `resolve` writes graph state to `control/state/graph.lock.json`; `compose` writes install/block usage evidence to `control/evidence/**` and runtime routes to `project/generated/routes.ts`.
- `verify` writes governance evidence under `control/evidence/`, including `verification-report.json`, `runtime-report.json`, `policy-report.json`, and `acceptance-coverage.json`.
- `lock` writes provenance to `control/provenance/provenance.json`; `explain` writes `control/graph/explain-graph.json`, `control/evidence/review-summary.json`, and local HTML Workbench projections including `source-view.html`, `slot-rule-view.html`, `graph-view.html`, and `review-view.html` under `control/workbench/views/`; Graph View includes node/edge/type coverage plus issue overlays from review evidence, while Review View aggregates CI, chain, coverage, policy, provenance, repair, upgrade, and artifact readiness for human review.
- `workbench mutations apply` writes `control/workflow/view-mutation-report.json` after applying structured edits from `source/views/mutations/*.json` to `source/app.yaml`.
- Governance contract freeze currently covers: `control/state/graph.lock.json`, `control/provenance/provenance.json`, `control/evidence/verification-report.json`, `control/evidence/runtime-report.json`, `control/evidence/policy-report.json`, `control/evidence/acceptance-coverage.json`, `control/graph/explain-graph.json`, and `control/evidence/review-summary.json`.
- CI restores a complete governance view from stable `control/**` paths plus runtime contract artifacts that remain under `project/generated/**`; artifact manifests expose upload group counts and missing reason type counts for upload planning.
- `.shared-deps/` and `.pjc/**` are local caches used to warm dependencies and hold temporary compiler/Workbench/AI state; they are intentionally not shipped governance artifacts.
- `infra/postgres` currently ships a contract-only Postgres path. It emits `project/generated/postgres-contract.json` because that file is a generated runtime contract consumed by the target project, not a control-plane evidence artifact.

When working in Codex web, start from the repo root. Most tasks either touch `platform/` or validate behavior through `tests/`.
