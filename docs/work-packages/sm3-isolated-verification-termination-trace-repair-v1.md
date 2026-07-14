---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-termination-trace-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: add-isolated-child-termination-trace
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-termination-trace-repair-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-termination-trace-repair.json
      - platform/compiler/semantic-mutation/isolated-verification-child-progress.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
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
  - platform/shared/windows-appcontainer-native-helper.ts
  - platform/compiler/semantic-mutation/isolated-verification-child-outcome.ts
  - platform/compiler/verify/assert-isolated-staging-tree.ts
  - platform/compiler/verify/semantic-mutation-verification-adapter.ts
  - platform/orchestrator/semantic-mutation-orchestrator.ts
  - tests/integration/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v3-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-absent-receipt-diagnosis.json
  - docs/work-packages/sm3-add-state-transition-vertical-v3.md
  - docs/work-packages/sm3-isolated-verification-absent-receipt-diagnosis-v1.md
acceptance:
  - "The consumed terminal diagnosis remains exact: docs/evidence/v0-4-semantic-mutation-isolated-verification-absent-receipt-diagnosis.json sha256:7840b46d01be9f1a6ddb11aa785c9d7a013bb48f44402e1027214f8f9f66625a."
  - "The predecessor runtime plan, runner, host and child-outcome inputs are exact: sha256:1dc9260b8db3eb7261a8a7a45e24bdc9756a0050eeef887dc203ef3d3fae250f, sha256:8baddc3bcbd59738639a342270fbce3ac444044b62ba0c0e96f90593f074eeb5, sha256:12167894b77f625d9ca2a39294ea44873c33173c8346709329421211da897a6a and sha256:1e9a650a84b5f20dac99eced505d79cd86cd7e6cf58031ed71fe0ba117e7aabc."
  - "A new mutation-specific internal module owns exact finite checkpoint paths, canonical bounded bytes, durable create-exclusive publication, trace parsing, fixed reserved child exit codes and coarse termination classification."
  - "The runtime plan materializes a tiny physical bootstrap and a separate heavyweight runner core. The bootstrap durably publishes bootstrap-entered before a relative dynamic import of the core; neither generated file contains a host absolute path."
  - "The generic AppContainer executor, native helper, generic WorkspacePaths and canonical Verification contracts do not change. Runtime destination manifest and process-local plan revision bind both bootstrap and core bytes."
  - "The only checkpoint names are bootstrap-entered, module-entered, catch-armed, verify-all, postcondition, failure-caught, catch-tree-validated and outcome-publish-started. Host validation accepts only source-valid success/failure transition traces and rejects gaps, forged order, duplicate final/pending state or noncanonical bytes."
  - "Each checkpoint uses its own same-directory pending/final pair: pending create-exclusive, canonical write, file sync, close, atomic rename, directory sync and owned pending cleanup. Host fenced-removes every known final/pending path before launch."
  - "Exit 0 maps to zero; fixed reserved exits 70..74 map only to runner-controlled-failure, runner-entry-failure, runner-catch-tree-failure, outcome-publication-failure and progress-publication-failure; every other safe nonzero maps to unclassified-nonzero. No raw exit code is public."
  - "Public blocked details expose only allowlisted stage, child stage, artifact, termination class, last valid checkpoint and optional pending checkpoint. No path, message, stdout, stderr, raw output, Error, timestamp, transaction id, pass id or extensible payload crosses the boundary."
  - "Progress and termination can only refine or block failure. PASS still requires exit zero, failure receipt absence, a valid success trace, complete canonical passed artifacts, semantic rebuild and the existing canonical artifact classifier. A checkpoint never substitutes for a report and never enters success rawDigests."
  - "Nonzero exit plus a complete canonical failed Verification artifact set remains status=failed when receipt/termination/trace coherence is valid. There is no retry, timeout change or stdout/stderr capture."
  - "The new source is already owned by the existing platform/compiler/semantic-mutation/ selector prefix. This package does not edit verifier/test-impact trust roots."
  - "Exactly one focused batch runs after two independent static reviews. It launches no production AppContainer, profile/registry query, real product vertical, old Gate, slow/full matrix or Actions."
  - "A focused PASS authorizes only a separately frozen real add-state-transition vertical-v4. It does not authorize typecheck, imports, affected, Contract Freeze, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/unit/semantic-mutation-verification-adapter.test.ts tests/contract/semantic-mutation-apply-contract.test.ts tests/contract/test-impact.test.ts --timeout 180000"
  - "git diff --check -- platform/compiler/semantic-mutation/isolated-verification-child-progress.ts platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts platform/compiler/verify/run-semantic-mutation-isolated-child.ts platform/orchestrator/semantic-mutation-isolated-verification-runner.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts docs/work-packages/sm3-isolated-verification-termination-trace-repair-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-termination-trace-repair.json"
---

# SM3 Isolated Verification Termination Trace Repair V1

Vertical-v3 已经证明默认 AppContainer supervisor 正常返回，但 failure receipt 与第一个 canonical report 同时不存在；当前 host 丢弃 child exit code，runner 又没有 pre-import checkpoint，因此 source 无法区分 module evaluation、entry、catch-tree、outcome publication 与 abnormal termination。

本包只修复这一个信息损失边界：mutation-specific bootstrap 在加载 heavyweight core 前发布第一个 durable checkpoint，runner 发布有限分支 trace，host 只映射固定 termination enum。Trace 不是 Verification evidence，不能创建 PASS、不能进入 `rawDigests`，也不授权重跑已 terminal 的 vertical-v3。
