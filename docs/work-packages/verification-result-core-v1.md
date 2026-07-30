---
schema: codex-development-work-package-v1
id: verification-result-core-v1
tracking: none
base: ec0e6b53af183c820d798a039d9f6871770fd4f1
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: implement-result-core
    owner: result-core-worker
    ownedPaths:
      - platform/shared/verification-result-contract.ts
      - tests/unit/verification-result-core.test.ts
      - tests/contract/verification-result-contract.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/unit/testkit-workspace-cleanup.test.ts
forbiddenPaths:
  - bun.lock
  - scripts/codex/work-package-contract.ts
  - scripts/codex/parallel-work-package-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/
  - platform/shared/contract-freeze-contract.ts
  - platform/shared/ci-verification-revision.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/ci-evidence-composition-policy-registry.ts
  - platform/shared/ci-git-changed-files.ts
  - platform/shared/verification-types.ts
  - platform/shared/verification-artifact-contract.ts
  - platform/shared/semantic-mutation-types.ts
  - platform/shared/affected-test-inventory.ts
  - platform/compiler/verify/verify-project.ts
  - platform/compiler/verify/run-runtime-verification.ts
  - platform/orchestrator/verify-orchestrator.ts
  - platform/dev-runner/test-runner.ts
  - docs/work/active-work-package.md
  - docs/work/current-state.yaml
  - docs/work/rolling-plan.md
  - docs/work-packages/dev-loop-speed-v2.md
  - tests/e2e/
acceptance:
  - "platform/shared/verification-result-contract.ts exports VerificationResultStatus = 'passed' | 'failed' | 'not-run' | 'unsupported' | 'invalidated' (5 states, no skipped/blocked)."
  - "platform/shared/verification-result-contract.ts exports VerificationDisposition = 'executed' | 'reused' | 'not-executed' (3 dispositions)."
  - "platform/shared/verification-result-contract.ts exports VerificationApplicability = 'required' | 'optional' | 'not-applicable' | 'unresolved' (4 applicabilities)."
  - "platform/shared/verification-result-contract.ts exports VerificationReasonCode with exactly 17 stable reason codes matching the Issue #176 census v0.2 list."
  - "platform/shared/verification-result-contract.ts exports VerificationGateResultV1 interface with all fields from Issue #176 census v0.2 section five (gateId, gateRevision, owner, requirementKey, subjectRevision, inputDigest, applicability, status, disposition, reasonCode, requiredForClaims, supportedClaims, environment, execution, evidenceRefs, invalidationRules, diagnostic)."
  - "platform/shared/verification-result-contract.ts exports a validator that enforces all status/disposition/applicability/reasonCode combinations: passed cannot pair with not-executed; failed must pair with executed; not-run must pair with not-executed; reused must pair with passed and non-empty evidenceRefs; unresolved applicability must pair with invalidated; not-applicable must pair with not-run; unsupported must pair with capability-unsupported or platform-unsupported reasonCode."
  - "platform/shared/verification-result-contract.ts exports a claim-based aggregate function that implements the 6-step algorithm from Issue #176 census v0.2 section seven: per claim, resolve required gates and owning environments; any required gate failed -> claim failed; no failed but invalidated/unresolved -> claim invalidated; no above but owning required gate unsupported -> claim unsupported; no above but owning required gate not-run/missing -> claim not-run; all required gates passed/reused with coverage complete -> claim passed."
  - "platform/shared/verification-result-contract.ts exports legacy mapping helpers: mapProductVerificationStatus (skipped -> not-run/not-applicable or not-run/fail-fast-prerequisite-failed depending on context), mapCiEvidenceV2Status (not-run -> not-run, passed/failed -> executed), mapSemanticMutationBlocked (per reason mapping), mapEvidenceDisposition (executed/reused/delta -> execution plan disposition, not result status)."
  - "platform/shared/verification-result-contract.ts legacy mapping helpers expose lossy mappings as unresolved/invalidated rather than silently promoting to passed."
  - "tests/unit/verification-result-core.test.ts covers all 10 regression scenarios from Issue #176 census v0.2 section ten: all-lane fast-passed+runtime-skipped -> overall not passed; runtime requested + fast not-applicable + runtime passed -> runtime claim passed; fast failed -> runtime not-run; Windows required gate on Linux not-run -> claim not-run; optional Browser unsupported -> non-browser claim passed; empty affected source closure -> invalidated/non-zero; stale reused evidence -> invalidated; cleanup failure after assertions pass -> failed; not-applicable requires applicability revision; V2 evidence adapter cannot increase claims."
  - "tests/contract/verification-result-contract.test.ts validates the schema, builder, validator, aggregator, and legacy mapping contracts with positive and negative cases."
  - "All focused contracts, typecheck, docs doctor, repository audit pass on one single-parent candidate."
tests:
  - tests/unit/verification-result-core.test.ts
  - tests/contract/verification-result-contract.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/sandbox-architecture-contract.test.ts
---

# Verification Result Core v1

## 背景

Issue #176 census v0.2 揭示 SEC 仓库存在至少 5 套互不兼容的验证状态词汇：

1. 产品 `VerificationStatus = passed | failed | skipped`（`verification-types.ts:68`）
2. CI evidence `passed | failed | not-run`（`ci-evidence-contract.ts:33`）
3. 语义变异 `passed | failed | blocked` / `runnable | blocked` / `runnable | non-runnable`
4. Lock pass-state `succeeded | failed | pending`
5. Evidence disposition `executed | reused | delta`

决定性假绿：`summarizeReport()`（`verify-project.ts:221`）只把 `failed` lane 加入 `failedLanes`，`skipped` 不阻止 summary pass；`sourceChanged && selected tests = 0` 在 `test-runner.ts:438` 直接 `return 0`。

本 Work Package 是 Issue #176 Slice 1（首包），纯加法建立统一结果模型、聚合算法与 legacy 映射，不修改任何 runner/CI/Product 写入者。后续 Slice 由 #188（Semantic Test Impact）、#177 Phase A（pre-freeze）、#190 Phase B（Hermetic Runtime）消费。

## 实现

### 1. 统一结果状态

```ts
export type VerificationResultStatus =
  | 'passed'
  | 'failed'
  | 'not-run'
  | 'unsupported'
  | 'invalidated';
```

- `passed`：applicable gate 已执行成功或可信 Evidence exact 复用，input/environment/contract 未失效，claim 支持明确。
- `failed`：applicable gate 已物理执行得到失败；prepare/execute/terminate/cleanup/readback 任一 required phase 失败；timeout/output overflow/process-tree 未收口/cleanup 失败均是 failed。
- `not-run`：未物理执行且无复用 Evidence；原因可能是 not-applicable、fail-fast 前序失败、current-runner not-owning、未调度、缺少前置 artifact。
- `unsupported`：owning environment 或产品 support contract 明确无法提供 required capability。
- `invalidated`：原 result/selection 曾存在但 input/base/head/tree/manifest/contract/provider/environment/Impact revision/cleanup identity 已变化；selection/read/parse/ownership unresolved 也产生 invalidated。

### 2. 正交维度

```ts
export type VerificationDisposition = 'executed' | 'reused' | 'not-executed';
export type VerificationApplicability = 'required' | 'optional' | 'not-applicable' | 'unresolved';
```

`reused` 仍是 status `passed`，但必须绑定可信 Evidence；不是第六种 status。

### 3. Reason code

```ts
export type VerificationReasonCode =
  | 'executed-success'
  | 'executed-failure'
  | 'not-applicable'
  | 'fail-fast-prerequisite-failed'
  | 'current-runner-not-owning-environment'
  | 'not-dispatched'
  | 'required-artifact-missing'
  | 'capability-unsupported'
  | 'platform-unsupported'
  | 'selection-unresolved'
  | 'input-invalidated'
  | 'evidence-stale'
  | 'superseded-revision'
  | 'cancelled'
  | 'timeout'
  | 'cleanup-failed'
  | 'process-settlement-failed';
```

### 4. Gate Result schema

`VerificationGateResultV1` 完整接口按 Issue #176 census v0.2 section five 实现，包含 gateId/gateRevision/owner/requirementKey/subjectRevision/inputDigest/applicability/status/disposition/reasonCode/requiredForClaims/supportedClaims/environment/execution/evidenceRefs/invalidationRules/diagnostic。Timestamp/duration 属于 execution Evidence，不进入 result identity。

### 5. Validator

限定 status/disposition/applicability/reasonCode 组合：
- `passed` 不能配 `not-executed`
- `failed` 必须 `executed`
- `not-run` 必须 `not-executed`
- `reused` 必须 `passed` 且 `evidenceRefs` 非空
- `unresolved` applicability 只能 `invalidated`
- `not-applicable` 只能 `not-run`
- `unsupported` 必须有 owning capability/platform contract（reasonCode = `capability-unsupported` 或 `platform-unsupported`）

### 6. Aggregate 算法

针对 required claim set（不是简单状态优先级），6 步：
1. 解析 required Gates 和 owning environments
2. 任一 required Gate `failed` → claim `failed`
3. 无 `failed` 但有 `invalidated`/`unresolved` → claim `invalidated`
4. 无上述但 owning required Gate `unsupported` → claim `unsupported`
5. 无上述但 owning required Gate `not-run`/missing → claim `not-run`
6. 全部 required Gate `passed`/`reused` 且 coverage complete → claim `passed`

Overall candidate 只有所有 required claims `passed` 才 `passed`。

### 7. Legacy mapping helpers

- `mapProductVerificationStatus`：`skipped` → `not-run` + reasonCode 按 context（`not-applicable` / `fail-fast-prerequisite-failed` / `current-runner-not-owning-environment`）
- `mapCiEvidenceV2Status`：`not-run` → `not-run/not-executed`，`passed`/`failed` → `passed`/`failed` + `executed`
- `mapSemanticMutationBlocked`：逐 reason 映射（capability/owning platform 不支持 → `unsupported`；authorization/precondition 失败 → `failed`；未到执行/前序失败 → `not-run`；plan/input 已变化 → `invalidated`）
- `mapEvidenceDisposition`：`executed`/`reused`/`delta` → execution plan disposition（不是 result status）；`delta` 表示待执行精炼 Gate
- 所有 lossy 映射暴露为 `unresolved`/`invalidated`，不静默提升为 `passed`

## 退出

single-parent current-main candidate；focused/typecheck/docs/audit/imports/affected、Review 与 Full Evidence 闭合；merge 后从新 `main` readback。本包只建立结果/闭包边界，完整传播算法由 #188 实现。
