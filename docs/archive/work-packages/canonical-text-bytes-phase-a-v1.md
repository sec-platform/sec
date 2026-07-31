---
schema: codex-development-work-package-v1
id: canonical-text-bytes-phase-a-v1
tracking: issue-209
base: 80b7fb9915b9420dd6202c038ea589f414dac52d
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: canonical-text-policy
    owner: text-policy-worker
    ownedPaths:
      - .gitattributes
      - .editorconfig
      - .prettierrc.json
      - package.json
      - platform/shared/text-byte-census-contract.ts
      - platform/shared/worktree-settlement-contract.ts
      - scripts/codex/text-byte-census.ts
      - scripts/codex/worktree-settlement.ts
      - platform/cli/register-commands.ts
      - tests/contract/text-byte-census.test.ts
      - tests/contract/worktree-settlement.test.ts
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/canonical-text-bytes-phase-a-v1.md
      - docs/archive/work-packages/work-readme-conditional-state-clarification-v1.md
forbiddenPaths:
  - bun.lock
  - platform/compiler/
  - platform/orchestrator/
  - platform/dev-runner.ts
  - platform/dev-runner/
  - scripts/codex/repository-audit.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/work-package-contract.ts
  - scripts/codex/parallel-work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/exact-git-blob.ts
  - scripts/codex/github-artifact-metadata.cjs
  - scripts/codex/ci-orchestration-core.ts
  - platform/shared/verification-artifact-contract.ts
  - platform/shared/verification-result-contract.ts
  - platform/shared/verification-types.ts
  - platform/shared/ci-artifact-contract.ts
  - platform/shared/ci-artifact-types.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-evidence-composition-policy-registry.ts
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/ci-execution-environment.ts
  - platform/shared/ci-git-changed-files.ts
  - platform/shared/ci-pr-risk-selection.ts
  - platform/shared/ci-verification-revision.ts
  - platform/shared/error-protocol.ts
  - platform/shared/error-protocol-contract.ts
  - .github/workflows/
  - docs/work/current-state.yaml
  - docs/authority.json
  - tsconfig.json
  - tests/e2e/
  - tests/contract/repository-audit.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
acceptance:
  - ".gitattributes is the unique authority covering SEC-owned text (scripts/ts/js/json/yaml/md/workflow/config) as text eol=lf, binary/archive/image/font/database as -text, Windows launcher/batch only when explicitly declared; unknown files not damaged by broad rules."
  - ".editorconfig fixes governed text end_of_line = lf and final newline; .prettierrc.json declares explicit endOfLine=lf; no duplicate conflicting rules."
  - "scripts/codex/text-byte-census.ts scans tracked Git blobs and classifies each as canonical-lf, explicit-crlf, binary, preserve-external, or unknown; detects CRLF/mixed endings, UTF-8 BOM, NUL, unknown encoding; unknown fail-closed."
  - "scripts/codex/worktree-settlement.ts is non-destructive: reads Git attributes/index/blob and worktree; clean worktree can be deterministically re-materialized to canonical bytes; dirty/untracked or unsafe cases block (no reset/stash/overwrite); emits settlement receipt."
  - "scripts/codex/worktree-settlement.ts when worktree materializes CRLF but blob is LF, detects and reports; same blob under LF and CRLF materialization yields identical source identity."
  - "package.json adds text:census and environment:settle CLI entrypoints; platform/cli/register-commands.ts registers `sec environment settle` and `sec text census` commands."
  - "tests/contract/text-byte-census.test.ts covers canonical-lf, explicit-crlf, binary, preserve-external, unknown classification; CRLF/mixed/BOM/NUL detection; unknown fail-closed."
  - "tests/contract/worktree-settlement.test.ts covers clean settle success, dirty block, untracked block, CRLF-materialization-but-LF-blob detection, same-blob-LF-CRLF identity consistency, binary preservation."
  - "One-shot renormalize migration audited to have zero semantic diff; no repository-wide line-ending noise mixed into product PR."
  - "docs:doctor reports 0 errors; test:fast passes; typecheck passes."
tests:
  - tests/contract/text-byte-census.test.ts
  - tests/contract/worktree-settlement.test.ts
---

# Work Package: canonical-text-bytes-phase-a-v1

Issue #209 Phase A. Canonical Text Bytes + Line-Ending Environment Settlement.

## Problem

SEC has repeatedly hit Windows worktree failures where Git blob/index has no semantic change but the worktree materializes CRLF; imports/formatter first run converts files to LF, then Git diff still shows zero, and the same exact head re-run passes. This is not a candidate product delta and cannot be handled by "run organizer once, then retry". The system lacks unified distinction between Git canonical blob bytes, worktree materialization bytes, editor/formatter projection, tool input authority, and external Brownfield original bytes.

## Phase A Scope

Per Issue #209 "顺序与并行": at minimum complete Phase A `attributes + census + preflight`. This package delivers:

1. **Repository attributes**: single `.gitattributes` policy covering SEC-owned text as `text eol=lf`, binary as `-text`, explicit CRLF only when truly needed, unknown not damaged by broad rules. No reliance on developer global `core.autocrlf`.
2. **Editor / formatter projection**: `.editorconfig` fixes `end_of_line = lf` and final newline; `.prettierrc.json` declares `endOfLine: lf`; generators write canonical LF.
3. **Text byte census**: machine scan of tracked Git blobs, classifying each as `canonical-lf`, `explicit-crlf`, `binary`, `preserve-external`, `unknown`. Detects CRLF/mixed endings, UTF-8 BOM, NUL, unknown encoding. Unknown fail-closed, no speculative batch rewrite.
4. **Worktree settlement preflight**: single non-destructive entrypoint that reads Git attributes/index/blob and worktree; clean worktree can be deterministically re-materialized to canonical bytes; dirty/untracked or unsafe cases block (no reset/stash/overwrite); emits settlement receipt with Git version, attributes digest, config observation, changed materializations, remaining unknowns.
5. **One-shot renormalize migration**: blob/worktree census first, renormalize only classified SEC-owned text, audit semantic diff as zero, isolate migration from product PR noise.

## Non-Goals (Phase B and later)

- Failure integration with #177 unified failure schema (`environment/worktree-line-ending-unsettled`).
- Tool input authority refactors (imports/formatter/pre-freeze reading index/blob instead of ambient worktree).
- Task Capsule integration (#205) — text-policy revision, attributes digest, settlement receipt in Capsule.
- Cross-platform Windows/WSL physical regression suite beyond basic settlement receipt.
- Generated artifact Target Profile line-ending contracts.

## Out of Scope

- Trust-root file modifications.
- Verification artifact contract, CI contract, workflow files.
- Merge-gate infrastructure.
- Product compiler code.
- Test impact, runtime, e2e tests.

## Trust Route

This package does NOT modify the repository audit trust root or any verifier trust-root file. It is a normal non-trust-root PR; hosted verification must complete normally (proving the trust-root restoration from PR #213/#214 persists).
