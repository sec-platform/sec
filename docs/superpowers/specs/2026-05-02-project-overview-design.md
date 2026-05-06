# Project Overview Contract and Workbench View Design

## Goal

Provide a single project overview entry point for developers and AI agents. The overview should summarize workspace navigation, app structure, AI handoff context, quality status, and review risks without forcing readers to inspect scattered JSON artifacts or Workbench pages one by one.

This feature adds a shared overview builder consumed by both:

- `bun run platform -- overview` for terminal and JSON contract inspection.
- `control/workbench/views/overview-view.html` for read-only Workbench navigation.

## Non-goals

- Do not make Graph-It-Live, MCP output, dependency-cruiser, jscpd, or discover output a canonical fact source.
- Do not replace `graph.lock.json`, `explain-graph.json`, `provenance.json`, `review-summary.json`, or verification reports.
- Do not add interactive editing or mutation behavior.
- Do not infer business semantics primarily from generated `project/**` files.
- Do not add a stable persisted overview JSON artifact in the first implementation.

## Current context

The platform already has these canonical governance artifacts:

- `control/state/graph.lock.json`
- `control/graph/explain-graph.json`
- `control/provenance/provenance.json`
- `control/evidence/review-summary.json`
- `control/evidence/verification-report.json`
- `control/evidence/policy-report.json`
- `control/evidence/acceptance-coverage.json`
- `control/ci/artifacts.json`
- optional workflow artifacts for repair, upgrade, upgrade diagnostics, and Workbench mutations

The existing emit flow is:

```text
lock / verify / explain inputs
  -> writeExplainGraph
  -> writeReviewSummary
  -> writeLocalViews
  -> source / slot-rule / graph / review Workbench pages
```

`platform/shared/tool-evidence-contract.ts` and `platform/shared/tool-evidence-adapters.ts` already define draft evidence reports for code quality, architecture boundary, and semantic pattern findings. These reports are optional evidence overlays, not stable governance artifacts.

## Architecture

Add a shared overview builder as the single calculation point:

```text
governance artifacts
  -> buildProjectOverview
    -> platform overview text/json
    -> overview-view.html
```

The builder reads existing artifact objects passed by callers. It does not read files directly unless a thin helper is needed for CLI inspection. This keeps calculation testable and prevents Workbench templates from duplicating business rules.

### Boundaries

The overview belongs to the Review/Workbench projection layer and CLI inspect surface.

It may read and summarize:

- source/project/control/local workspace roots
- graph lock
- explain graph
- provenance
- verification, policy, coverage, artifact, repair, upgrade, and review summaries
- optional draft tool evidence reports if they already exist

It must not:

- write `source/**`
- mutate governance artifacts
- introduce a second graph schema
- make draft evidence required for contract freeze
- make Workbench templates calculate review semantics independently

## Contract shape

The first implementation should expose a compact, high-signal structure:

```ts
interface ProjectOverview {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  generatedAt: string;
  workspace: ProjectOverviewWorkspace;
  status: ProjectOverviewStatus;
  navigation: ProjectOverviewNavigation;
  aiContext: ProjectOverviewAiContext;
  quality: ProjectOverviewQuality;
  risks: ProjectOverviewRisks;
}
```

### `workspace`

Summarizes the four-root workspace model:

- `sourceRoot`
- `projectRoot`
- `controlRoot`
- `localStateRoot`
- primary commands for refresh, verify, explain, overview, and Workbench generation

### `status`

Summarizes the current review chain:

- verification status
- policy status
- acceptance coverage status
- artifact status and missing count
- review chain status
- repair and upgrade status when present

### `navigation`

Lists stable paths and commands that humans and agents should open first:

- overview, source, slot-rule, graph, and review Workbench pages
- explain graph JSON / Mermaid / DOT
- provenance, review summary, verification report, artifact manifest
- inspect commands for overview, graph, review, verification, artifacts, and contract errors

### `aiContext`

Provides a handoff summary for AI agents:

- app id/name when available
- block count and block ids
- slot count and slot ids
- graph node and edge counts
- generated file count
- verified and unverified artifact counts
- acceptance and policy summary
- priority review files derived from failure points, missing artifacts, unverified provenance, repair targets, and upgrade impacts

### `quality`

Represents optional quality evidence without making it canonical:

- availability of code-quality, architecture-boundary, and semantic-pattern reports
- status, diagnostic count, affected file count, and raw report paths when available
- unavailable status when reports are absent

The first implementation can build this section from existing draft report files only if they exist. Absence must not fail overview generation.

### `risks`

Aggregates review risks already present in governance artifacts:

- failure points
- regression risks
- conflict hints
- repair blockers
- upgrade diagnostics
- missing artifact reasons
- policy blocker/error count

## CLI behavior

Add a top-level command:

```text
bun run platform -- overview
bun run platform -- overview --json --compact
```

Text output should be short and actionable:

```text
Project overview passed
Workspace: source/project/control/.pjc ready
Verification: passed; policy: passed; coverage: passed; artifacts: passed
Graph: 58 nodes / 67 edges; blocks=13; slots=1
Risks: failures=0; regressions=0; conflicts=0; missingArtifacts=0
Views: control/workbench/views/overview-view.html
Next: bun run platform -- explain | bun run platform -- verify --json --compact
```

JSON output returns the full `ProjectOverview` object. Compact JSON should preserve the same fields but use existing compact formatting behavior.

If required governance artifacts are missing, the command should fail with a targeted compiler error that tells the user which command to run first, usually `bun run platform -- explain` or the refresh chain.

## Workbench behavior

Add `overview-view.html` as the first Workbench nav item. It should be a read-only dashboard with these sections:

1. Overall status and next action.
2. Workspace navigation.
3. AI handoff context.
4. Quality evidence availability.
5. Risk radar.
6. Links to graph, review, source, and slot-rule views.

The page should not render raw full JSON by default. It should display compact tables and only include raw snippets where they help debugging.

## Artifact policy

The Overview HTML page belongs to the existing Workbench view artifact group.

The first version should not write a persistent `control/evidence/project-overview.json` artifact. The CLI can produce JSON on demand from existing artifacts. If a future version persists overview JSON, it must update:

- docs 08 governance artifact list
- docs 05 CLI and contract notes
- docs 11 Workbench/view contract
- CI artifact contract
- contract freeze coverage if it becomes stable

## Documentation updates

Update:

- `README.md`: add overview command and Workbench overview entry.
- `docs/05-编译器核心实现规格.md`: add CLI contract and builder pattern reference.
- `docs/08-Verification、Provenance与Graph规范.md`: add overview view path under Workbench views, not stable governance JSON.
- `docs/11-Workbench与可视化规范.md`: add Overview View as the entry dashboard and clarify quality evidence overlay boundaries.

## Testing

Add focused tests for:

1. `buildProjectOverview` produces stable summaries from representative governance inputs.
2. `platform overview --json --compact` emits the expected compact contract.
3. `writeLocalViews` writes `overview-view.html` and includes navigation to other views.
4. Missing required artifacts produce a clear error.
5. Optional draft quality evidence absence does not fail overview generation.

Run at minimum:

```text
bun run typecheck
bun run test:affected
```

If artifact paths or Workbench view groups change, also run the relevant contract or reference checks.

## Risks and mitigations

- Schema drift between CLI and Workbench: both consume `buildProjectOverview`.
- Overloaded overview object: only include fields displayed by CLI, Workbench, or AI context.
- Workbench template logic growth: keep calculations in the builder.
- Draft evidence becoming accidental contract: mark quality evidence as optional and unavailable when absent.
- Graph-It-Live boundary confusion: keep MCP outputs as optional evidence/AI exploration only.
- View artifact drift: add overview to the existing view path group and tests.
