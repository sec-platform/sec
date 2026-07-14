---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-child-outcome-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: publish-and-classify-isolated-child-failure-outcome
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-child-outcome-repair-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-repair.json
      - platform/compiler/semantic-mutation/isolated-verification-child-outcome.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/orchestrator/semantic-mutation-isolated-verification-runner.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - scripts/
  - platform/shared/paths.ts
  - platform/shared/workspace-types.ts
  - platform/shared/verification-artifact-contract.ts
  - platform/shared/verification-types.ts
  - platform/shared/test-impact-rules/
  - platform/shared/windows-appcontainer-executor.ts
  - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
  - platform/compiler/verify/assert-isolated-staging-tree.ts
  - platform/compiler/verify/semantic-mutation-verification-adapter.ts
  - platform/orchestrator/semantic-mutation-orchestrator.ts
  - tests/integration/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v2-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-artifact-read-diagnosis.json
  - docs/work-packages/sm3-add-state-transition-vertical-v2.md
  - docs/work-packages/sm3-isolated-verification-artifact-read-diagnosis-v1.md
acceptance:
  - "The consumed static diagnosis remains exact: docs/evidence/v0-4-semantic-mutation-isolated-verification-artifact-read-diagnosis.json sha256:96db18d804f2478fea37056322fbfc389a93f1490d01c562a2c1a412e1cf68f8."
  - "The predecessor runner and host inputs are exact: sha256:89163751a3c8137877741236eab555d3f0379ecbeaa5dc130ad999c2d784ca67 and sha256:62a5fcdc84d758151179a11d676da7e5a1a0d5d7515440ddf0983521521ccd98."
  - "One mutation-specific internal module owns the final/pending relative paths, exact failure-only schema, bounded fatal-UTF-8 parser, canonical bytes and atomic writer. Generic WorkspacePaths and canonical Verification artifacts do not change."
  - "The transient outcome has exactly formatVersion, status=failed and stage=preflight|verify-all|postcondition. It contains no success state, message, path, stdout, stderr, raw output, Error, timestamp or extensible payload."
  - "The path is under .isolated-process/child. Publication is same-directory pending create-exclusive, canonical write, file sync, close, atomic rename, directory sync and pending cleanup. The writer never accepts an unknown error."
  - "The host fenced-removes stale final/pending before launch, validates the optional outcome after supervisor completion and classifies each canonical report as missing, parse, read or ok in deterministic artifact order."
  - "A valid failure outcome can only refine a failure. PASS still requires exit 0, outcome absence, complete canonical artifacts, semantic rebuild and the existing canonical artifact classifier."
  - "Nonzero exit plus a complete canonical failed Verification artifact set remains status=failed; no early result.code shortcut is added."
  - "Public blocked details expose only allowlisted stage, child stage and artifact enum. Poisoned message/path/stdout/stderr/rawOutput/extra fields cannot cross the boundary."
  - "The new source is already owned by the existing platform/compiler/semantic-mutation/ selector prefix; this package does not modify verifier/test-impact trust roots."
  - "Exactly one focused batch runs after independent static review. It launches no production AppContainer, profile/registry query, real product vertical, old Gate, slow/full matrix or Actions."
  - "A focused PASS authorizes only a separately frozen real add-state-transition vertical. It does not authorize typecheck, imports, affected, Contract Freeze, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/unit/semantic-mutation-verification-adapter.test.ts tests/contract/semantic-mutation-apply-contract.test.ts tests/contract/test-impact.test.ts --timeout 180000"
  - "git diff --check -- platform/compiler/semantic-mutation/isolated-verification-child-outcome.ts platform/compiler/verify/run-semantic-mutation-isolated-child.ts platform/orchestrator/semantic-mutation-isolated-verification-runner.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts docs/work-packages/sm3-isolated-verification-child-outcome-repair-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-repair.json"
---

# SM3 Isolated Verification Child Outcome Repair V1

真实纵切面只证明 host 在 `artifact-read` 边界失去 child failure phase；它没有授权 profile cleanup、timeout 或 Verification artifact 重构。

本包新增一个 failure-only transient control receipt。Receipt 不能成为成功证据，也不改变四个 canonical reports；它只在 report set 不完整时把失败确定性收敛到 child `preflight|verify-all|postcondition` 与第一个受影响 artifact。Focused PASS 后仍必须另冻真实纵切面。
