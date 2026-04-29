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

- `npm run platform -- doctor`: inspect local developer environment and dependency health, including readiness check count
- `npm run platform -- deps status`: inspect dependency cache/link status
- `npm run platform -- deps status --json --compact`: emit a machine-readable dependency environment contract
- `npm run platform -- deps warmup`: prepare shared runtime dependencies
- `npm run platform -- deps relink project`: make `project/node_modules` point back to shared dependencies
- `npm run platform -- artifacts --paths --json --compact --kind governance`: emit compact upload-path contracts with upload group counts
- `npm run platform -- artifacts manifest --json --compact`: inspect the latest compact artifact manifest without regenerating it
- `npm run platform -- workbench mutations apply`: apply structured Workbench edits from `source/views/mutations/*.json` back to `source/app.yaml`
- `npm run platform -- workbench mutations apply --json --compact`: emit the compact Workbench mutation report contract
- `npm run platform -- demo checklist`: inspect the local demo readiness checklist from existing governance artifacts
- `npm run platform -- demo checklist --json --compact`: emit the compact demo readiness checklist contract
- `npm run platform -- contract freeze --json --compact`: emit the compact contract-freeze target list, including inspect command, runner command, and target commands
- `npm run platform -- contract errors`: inspect the error protocol contract
- `npm run platform -- contract errors --json --compact`: emit the compact error protocol contract, including issue type count and diagnostic artifact paths
- `npm run platform -- contract ci --json --compact`: emit the compact team CI command contract, including top-level verify, typecheck, quality, contract freeze, reference drift, review matrix, review diagnostics, demo checklist, diagnostic, artifact upload commands, command counts, per-step produced artifact counts, and produced artifact paths
- `npm run platform -- test budget`: inspect the fast/runtime/all slow-test budget
- `npm run platform -- test budget --json --compact`: emit the compact slow-test budget contract, including inspect command, runner command, lane count, slow lane count, and slow lane IDs
- `npm run platform -- policy report`: inspect the latest policy governance report
- `npm run platform -- policy report --json --compact`: emit the compact policy governance report
- `npm run platform -- policy sources`: inspect the latest policy source map without running verify
- `npm run platform -- policy sources --json --compact`: emit the compact policy source contract
- `npm run platform -- acceptance coverage`: inspect the latest acceptance coverage report
- `npm run platform -- acceptance coverage --json --compact`: emit the compact acceptance coverage report
- `npm run platform -- acceptance blocks --json --compact`: emit the compact acceptance block coverage contract
- `npm run platform -- acceptance slots --json --compact`: emit the compact acceptance slot coverage contract
- `npm run platform -- install manifest`: inspect the latest install manifest without running compose
- `npm run platform -- install manifest --json --compact`: emit the compact install manifest contract
- `npm run platform -- blocks usage`: inspect the latest block usage map without running compose
- `npm run platform -- blocks usage --json --compact`: emit the compact block usage map contract
- `npm run platform -- postgres contract`: inspect the latest Postgres contract without running compose
- `npm run platform -- postgres contract --json --compact`: emit the compact Postgres contract
- `npm run platform -- lock inspect`: inspect the latest graph lock without running lock
- `npm run platform -- lock inspect --json --compact`: emit the compact graph lock contract without regenerating it
- `npm run platform -- runtime report`: inspect the latest runtime verification report
- `npm run platform -- runtime report --json --compact`: emit the compact runtime verification report
- `npm run platform -- verification report`: inspect the latest verification report
- `npm run platform -- verification report --json --compact`: emit the compact verification report
- `npm run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `npm run platform -- provenance registry`: inspect the latest provenance registry
- `npm run platform -- provenance registry --json --compact`: emit the compact provenance registry contract
- `npm run platform -- review summary`: inspect the latest review summary, including top-level activity counts, provenance generated artifact count and summary counts, artifact upload group, and missing reason type counts
- `npm run platform -- review summary --json --compact`: emit the compact review summary contract, including top-level activity counts
- `npm run platform -- review matrix`: inspect the latest E2E matrix without regenerating explain outputs
- `npm run platform -- review matrix --json --compact`: emit the compact E2E matrix contract
- `npm run platform -- review diagnostics`: inspect failure, regression risk, and conflict diagnostics from the latest review summary
- `npm run platform -- review diagnostics --json --compact`: emit the compact review diagnostics contract
- `npm run platform -- explain graph`: inspect the latest explain graph without regenerating it
- `npm run platform -- explain graph --json --compact`: emit the compact explain graph contract without regenerating it
- `npm run platform -- repair --dry-run --json --compact`: emit the compact repair plan contract, including repair target file count
- `npm run platform -- repair plan --json --compact`: inspect the latest compact repair plan contract without rerunning repair
- `npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact`: emit the compact upgrade plan contract, including source migration count, slot migration count, and migration operation count
- `npm run platform -- upgrade plan --json --compact`: inspect the latest compact upgrade plan contract without rerunning upgrade
- `npm run platform -- upgrade diagnostics --json --compact`: inspect the latest compact upgrade diagnostics contract without rerunning upgrade
- `npm run platform -- reference check`: refresh the checked-in reference workspace and fail on drift
- `npm run platform -- reference check --json --compact`: emit a machine-readable reference drift contract with inspect command, runner command, refresh command, and diff command
- `npm run platform -- benchmark suite`: inspect the benchmark/task-suite contract
- `npm run platform -- benchmark suite --json --compact`: emit the compact benchmark/task-suite contract, including inspect command, runner command, aggregated artifact paths, per-task artifact path count, score focus count, score dimension count, and score dimensions
- `npm run platform -- deps clean --project|--shared|--npm-cache`: clean one dependency layer through a controlled tool entry
- `npm run platform -- deps clean --all --force`: remove project, shared, and npm-cache dependency state; this intentionally causes the next runtime verification to warm dependencies again
- `npm run platform -- add <block-id>`: add official or private blocks
- `npm run platform -- resolve && npm run platform -- compose && npm run platform -- adapt`: refresh compiled project artifacts
- `npm run platform -- verify`: run the default fast lane with generated runtime service tests
- `npm run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `npm run platform -- verify --lane fast|runtime|all`: choose a specific verification lane; full Playwright runtime acceptance only runs in all
- `npm run platform -- repair`: create or apply bounded repairs from verification failures
- `npm run platform -- upgrade <block-id> <target-version> --dry-run`: review upgrade impact before applying it
- `npm run platform -- upgrade plan`: inspect the latest upgrade plan without rerunning upgrade
- `npm run platform -- upgrade diagnostics`: inspect the latest upgrade diagnostics without rerunning upgrade
- `npm run platform -- lock && npm run platform -- explain`: freeze and inspect governance outputs

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

- `npm run platform -- <command>`: raw compiler CLI entry for targeted operations.
- `npm run reference:*`: refresh the checked-in `source/` -> `project/` -> `control/` workspace without resetting it.
- `npm run demo:*`: reset or package a user-facing demo path from the reference workspace.
- `npm run dogfood:*`: exercise the checked-in reference workspace as the product dogfood surface.
- `npm run test:*`: run development verification or print verification budget contracts.

## Common Commands

- `npm run check`: TypeScript typecheck plus the main test suite
- `npm test`: run the Node test suite directly
- `npm run test:budget`: print the formal fast/runtime/all lane slow-test JSON contract through `platform test budget`, including runner command, lane count, slow lane count, and slow lane IDs
- `npm run test:contract-freeze`: run the CLI/script/governance contract freeze suite through the runner command declared by `platform contract freeze`
- `npm run test:benchmark-contract`: print the formal benchmark/task-suite JSON contract through `platform benchmark suite`
- `npm run demo:quickstart`: reset the reference project, then run the full governance refresh
- `npm run demo:governance`: run quickstart and print governance artifact upload paths
- `npm run demo:closed-loop`: run the primary product closed loop of quickstart, full verification, governance artifact paths, and compact explain JSON
- `npm run platform -- demo checklist`: inspect whether existing governance artifacts satisfy local demo readiness
- `npm run dogfood:reference`: refresh the checked-in reference workspace without resetting it
- `npm run dogfood:governance`: refresh dogfood outputs and print the structured artifact path contract
- `npm run reference:refresh`: refresh `source/` into `project/` and `control/` through `resolve -> compose -> adapt -> verify --lane all -> lock -> explain`
- `npm run reference:check`: run the formal reference drift gate through the runner command exposed by `platform reference check`
- `npm run platform -- contract freeze --json --compact`: emit the compact contract-freeze target list, including inspect command, runner command, and target commands
- `npm run platform -- contract errors --json --compact`: emit the compact error protocol contract, including issue type count and diagnostic artifact paths
- `npm run platform -- contract ci --json --compact`: emit the compact team CI command contract, including top-level verify, typecheck, quality, contract freeze, reference drift, review matrix, review diagnostics, demo checklist, diagnostic, artifact upload commands, command counts, per-step produced artifact counts, and produced artifact paths
- `npm run platform -- artifacts manifest --json --compact`: inspect the latest compact artifact manifest without regenerating it
- `npm run platform -- test budget --json --compact`: emit the compact slow-test budget contract, including inspect command, runner command, lane count, slow lane count, and slow lane IDs
- `npm run platform -- policy report --json --compact`: emit the compact policy governance report
- `npm run platform -- policy sources --json --compact`: emit the compact policy source contract
- `npm run platform -- acceptance coverage --json --compact`: emit the compact acceptance coverage report
- `npm run platform -- acceptance blocks --json --compact`: emit the compact acceptance block coverage contract
- `npm run platform -- acceptance slots --json --compact`: emit the compact acceptance slot coverage contract
- `npm run platform -- install manifest --json --compact`: emit the compact install manifest contract
- `npm run platform -- blocks usage --json --compact`: emit the compact block usage map contract
- `npm run platform -- postgres contract --json --compact`: emit the compact Postgres contract
- `npm run platform -- lock inspect --json --compact`: emit the compact graph lock contract without regenerating it
- `npm run platform -- runtime report --json --compact`: emit the compact runtime verification report
- `npm run platform -- verification report --json --compact`: emit the compact verification report
- `npm run platform -- verify --json --compact`: run the default fast lane and emit the compact verification report
- `npm run platform -- provenance registry --json --compact`: emit the compact provenance registry contract
- `npm run platform -- review summary --json --compact`: emit the compact review summary contract, including top-level activity counts
- `npm run platform -- review matrix --json --compact`: emit the compact E2E matrix contract
- `npm run platform -- review diagnostics --json --compact`: emit the compact review diagnostics contract
- `npm run platform -- explain graph --json --compact`: emit the compact explain graph contract without regenerating it
- `npm run platform -- workbench mutations apply --json --compact`: emit the compact Workbench mutation report after applying `source/views/mutations/*.json` to `source/app.yaml`
- `npm run platform -- repair --dry-run --json --compact`: emit the compact repair plan contract, including repair target file count
- `npm run platform -- repair plan --json --compact`: inspect the latest compact repair plan contract without rerunning repair
- `npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact`: emit the compact upgrade plan contract, including source migration count, slot migration count, and migration operation count
- `npm run platform -- upgrade plan --json --compact`: inspect the latest compact upgrade plan contract without rerunning upgrade
- `npm run platform -- upgrade diagnostics --json --compact`: inspect the latest compact upgrade diagnostics contract without rerunning upgrade
- `npm run platform -- reference check --json --compact`: emit the compact reference drift contract, including inspect command, runner command, refresh command, and diff command
- `npm run platform -- benchmark suite --json --compact`: emit the compact benchmark/task-suite contract, including inspect command, runner command, aggregated artifact paths, per-task artifact path count, score focus count, score dimension count, and score dimensions
- `npm run platform -- resolve`
- `npm run platform -- compose`
- `npm run platform -- adapt`
- `npm run platform -- verify`
- `npm run platform -- verify --lane all`
- `npm run platform -- explain`

## Governance Artifacts

- `resolve` writes graph state to `control/state/graph.lock.json`; `compose` writes install/block usage evidence to `control/evidence/**` and runtime routes to `project/generated/routes.ts`.
- `verify` writes governance evidence under `control/evidence/`, including `verification-report.json`, `runtime-report.json`, `policy-report.json`, and `acceptance-coverage.json`.
- `lock` writes provenance to `control/provenance/provenance.json`; `explain` writes `control/graph/explain-graph.json`, `control/evidence/review-summary.json`, and local HTML Workbench projections under `control/workbench/views/`.
- `workbench mutations apply` writes `control/workflow/view-mutation-report.json` after applying structured edits from `source/views/mutations/*.json` to `source/app.yaml`.
- Governance contract freeze currently covers: `control/state/graph.lock.json`, `control/provenance/provenance.json`, `control/evidence/verification-report.json`, `control/evidence/runtime-report.json`, `control/evidence/policy-report.json`, `control/evidence/acceptance-coverage.json`, `control/graph/explain-graph.json`, and `control/evidence/review-summary.json`.
- CI restores a complete governance view from stable `control/**` paths plus runtime contract artifacts that remain under `project/generated/**`; artifact manifests expose upload group counts and missing reason type counts for upload planning.
- `.shared-deps/` and `.pjc/**` are local caches used to warm dependencies and hold temporary compiler/Workbench/AI state; they are intentionally not shipped governance artifacts.
- `infra/postgres` currently ships a contract-only Postgres path. It emits `project/generated/postgres-contract.json` because that file is a generated runtime contract consumed by the target project, not a control-plane evidence artifact.

When working in Codex web, start from the repo root. Most tasks either touch `platform/` or validate behavior through `tests/`.
