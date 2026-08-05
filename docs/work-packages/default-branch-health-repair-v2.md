---
schema: codex-development-work-package-v1
id: default-branch-health-repair-v2
tracking: issue-280
base: b1220ae333679ac6bf4a181b0242a31ad3d6975f
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: root-cause-closure
    owner: issue-280-closure
    ownedPaths:
      - platform/shared/ci-evidence-composition-policy-registry.ts
      - platform/shared/ci-evidence-contract.ts
      - platform/shared/ci-evidence-reuse-contract.ts
      - platform/shared/default-branch-revision-health.ts
      - platform/shared/windows-appcontainer-executor.ts
      - platform/compiler/semantic-plan.ts
      - platform/compiler/ir/validate-engineering-ir.ts
      - platform/compiler/projection/semantic-view-utils.ts
      - platform/compiler/semantic-impact/build-impact-propagation.ts
      - platform/compiler/semantic-impact/propagation-rules.ts
      - platform/compiler/semantic-mutation/canonical.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts
      - platform/orchestrator/pipeline-orchestrator.ts
      - scripts/codex/default-branch-revision-health-evidence.ts
      - scripts/codex/repository-audit.ts
      - tests/contract/default-branch-revision-health.test.ts
      - tests/contract/repository-audit-active-pointer.test.ts
      - tests/contract/repository-audit.test.ts
      - docs/archive/work-packages/default-branch-health-repair-v1.md
      - docs/work-packages/default-branch-health-repair-v2.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .github/
  - .agents/
  - package.json
  - bun.lock
  - bunfig.toml
  - tsconfig.json
  - AGENTS.md
  - README.md
  - docs/authority.json
  - docs/product.md
  - docs/system-architecture.md
  - docs/roadmap.md
  - docs/development-governance.md
  - docs/verification-governance.md
  - docs/evidence/
  - docs/superpowers/
  - scripts/codex/merge-gate.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/sec-merge-bootstrap-contract.ts
  - scripts/codex/sec-merge-bootstrap-runtime.ts
  - scripts/codex/work-package-contract.ts
  - scripts/codex/document-control-plane.ts
  - scripts/codex/document-control-plane-contract.ts
  - platform/shared/tcb-closure-lock.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/tcb-closure-lock.test.ts
acceptance:
  - "The three originally reported imports:check failures are individually classified as real canonical import-organization defects owned by their files and the canonical import organizer; none is excluded from the required quick profile."
  - "A full-tree check closes the complete 14-file defect set rather than preserving the other 11 failures as pre-existing or non-blocking."
  - "repository-audit is the sole erroneous owner of control-plane-selected-manifest-already-on-default; the active pointer and lifecycle resolver remain unchanged."
  - "Positive retained-manifest behavior and negative digest-drift and missing-manifest behavior are covered by executable tests."
  - "default-branch-revision-health.ts exports only a validator/projector; it contains no live receipt, command result, dynamic SHA, execution time, or self-authored Evidence."
  - "The revision-health executor consumes an external canonical CI Evidence artifact, binds one exact subject revision/tree, captures real UTC, argv, exit code, start/end, OS, arch, runtime/toolchain, workspace before/after, raw-output digests, artifact digest, and producer/recorder identities."
  - "Evidence for one subject revision cannot authorize any successor revision."
  - "The required-check lattice yields verification-failed for any required deterministic failure, verification-partial for missing/environment/unsupported coverage, and verification-passed only when every applicable required check passes in a clean exact workspace."
  - "The candidate can derive only repair-only or trust-transition-required; it cannot declare itself trusted."
  - "No merge occurs without an exact-head COMMENT review, exact scope attestation, frozen verification artifact, applicable trust bootstrap, successful sec/merge-gate, and expected-head squash merge."
tests:
  - tests/contract/default-branch-revision-health.test.ts
  - tests/contract/repository-audit-active-pointer.test.ts
  - tests/contract/repository-audit.test.ts
---

# default-branch-health-repair-v2

Issue #280 的第二次闭包不再追加一个“结论正确”的源码 receipt，而是修复产生错误结论的 owner、执行链和授权链。

## imports:check 根因

最初 receipt 只记录三个失败：

- `platform/shared/ci-evidence-contract.ts`
- `platform/shared/ci-evidence-reuse-contract.ts`
- `platform/shared/windows-appcontainer-executor.ts`

三者都是 TypeScript language-service organize-imports 所识别的真实缺陷；canonical owner 是对应源码文件，canonical enforcement owner 是 `platform/dev-runner/import-organizer.ts`。quick profile 对本候选的 TypeScript 变化要求 imports gate，不存在允许排除它们的 canonical policy。

全树重验又发现 11 个同类缺陷，其中包括遗漏的 trust-root 文件 `platform/shared/ci-evidence-composition-policy-registry.ts`。因此本包修复完整 14 文件，不把其余失败降级为“旧问题”。

反复出现的系统根因不是排序规则不稳定，而是 hosted verification 固定使用 changed-only import scope；direct-to-main 或 admin bypass 可以把未整理文件送入 default branch，而后续全树检查才重新发现。#280 清除当前存量；防止再次绕过的长期 transaction/ruleset owner 仍是 #279，本包不启动或修改 #279。

## repository-audit 与 active pointer

active pointer 明确采用 `matchingDefaultBlob: none`：当前 selected manifest 与 default branch blob 相同，表示该候选不再 active，但物理 manifest 仍保留到 successor 原子接管。`document-control-plane-contract.ts` 已按此返回 `state=none, reason=matching-default-blob`。

`repository-audit.ts` 另行把相同状态报告为 high finding，形成两个 owner 对同一状态给出相反结论。错误 owner 是 audit 中的 `control-plane-selected-manifest-already-on-default` 分支；本包删除该分支，同时保留并验证 digest drift、missing manifest、rolling drift 和 live-manifest census 的 fail-closed 行为。

## revision-health Evidence

`platform/shared/default-branch-revision-health.ts` 只定义外部 physical-Evidence schema、严格验证和 receipt projection。源码不再导出当前或历史 live receipt，也不保存命令结果。

`scripts/codex/default-branch-revision-health-evidence.ts` 的执行路径为：

1. 读取并验证 canonical `.tmp/ci-verification-evidence.json`；
2. 重新读取当前 exact `HEAD`、tree 和 workspace clean state；
3. 从真实 gate artifact 投影 argv、exit code、start/end 和 output digest；
4. 从执行进程捕获真实 UTC、OS、arch、Bun/TypeScript toolchain 和 producer identity；
5. 写出 external physical Evidence；
6. 对该原始字节计算 artifact digest，再生成 exact-subject receipt。

缺少 required check、environment/unsupported、未分类失败、workspace dirty、subject/tree mismatch、artifact 或 producer metadata时均不能得到 `verification-passed`。`verification-passed` 也只产生 `trust-transition-required`，不能产生 `trusted`。

## Trust-root 边界

本候选涉及五个 trust-root 路径：

1. `platform/shared/ci-evidence-composition-policy-registry.ts`：仅 import organization；
2. `platform/shared/ci-evidence-contract.ts`：仅 import organization；
3. `platform/shared/ci-evidence-reuse-contract.ts`：仅 import organization；
4. `scripts/codex/repository-audit.ts`：修复错误 audit owner；
5. `scripts/codex/default-branch-revision-health-evidence.ts`：新增物理 Evidence producer。

候选不能用自身新增的 producer 或规则授权自身。适用 bootstrap 方式只能由最终 exact-head Gate 与 trusted-main bootstrap 合同裁决；在实际运行前不得预写 `manual-bootstrap-required`、`trusted` 或任何成功结论。

## 集成边界

Writer 只能冻结候选代码和测试。Review、scope、verification、trust bootstrap、Gate 和 merge authority 必须在 Writer 停止后分别绑定最终 exact head。任何安全能力缺失时，PR 保持 Draft、Issue #280 保持 open，不使用 admin merge，不触碰 #273、#274、#276。
