---
schema: codex-development-work-package-v1
id: sm3-r3-actionable-runtime-gate-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: sm3-r3-terminal-carry-forward
    owner: a0
    ownedPaths:
      - platform/compiler/semantic-mutation/mutation-recovery-record.ts
      - platform/compiler/semantic-mutation/mutation-terminal-record.ts
      - tests/unit/semantic-mutation-apply.test.ts
  - id: sm3-r3-lease-carry-forward
    owner: a0
    ownedPaths:
      - platform/orchestrator/workspace-orchestrator.ts
      - platform/shared/workspace-write-lease.ts
      - tests/integration/pipeline-workspace-write-lease.test.ts
      - tests/unit/workspace-write-lease.test.ts
  - id: sm3-r3-runtime-carry-forward
    owner: a0
    ownedPaths:
      - platform/compiler/compose/template-engine.ts
      - platform/compiler/emit/write-local-views.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/semantic-mutation-runtime-materialization.test.ts
  - id: sm3-r3-appcontainer-carry-forward
    owner: a0
    ownedPaths:
      - platform/shared/observed-process.ts
      - platform/shared/windows-appcontainer-executor.ts
      - platform/shared/windows-appcontainer-native-helper.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/unit/windows-appcontainer-executor.test.ts
      - tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts
  - id: sm3-r3-actionable-gate
    owner: a0
    ownedPaths:
      - scripts/run-work-package-gate.ts
      - scripts/work-package-gate-contract.ts
      - tests/unit/work-package-gate-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
      - docs/test-feedback-and-ci-lanes.md
  - id: sm3-r3-evidence
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-r1-focused-blocker-repair-v1.md
      - docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md
      - docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json
      - docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json
      - docs/evidence/v0-4-semantic-mutation-apply-r3-verification.json
forbiddenPaths:
  - .agents/skills/sec-architecture-change/SKILL.md
  - .agents/skills/sec-ci-triage/SKILL.md
  - .agents/skills/sec-pr-closeout/SKILL.md
  - .agents/skills/sec-repo-audit/SKILL.md
  - .agents/skills/sec-verification-evidence/SKILL.md
  - .agents/skills/sec-work-package-plan/SKILL.md
  - .gitignore
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/scripts/docs-doctor.ts
  - docs/work-packages/_template.md
  - package.json
  - platform/cli/
  - platform/compiler/ir/
  - platform/compiler/projection/
  - platform/compiler/semantic-impact/
  - platform/compiler/workbench/
  - platform/orchestrator/pipeline-orchestrator.ts
  - platform/orchestrator/semantic-mutation-orchestrator.ts
  - platform/policies/
  - platform/registry/
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/process.ts
  - platform/shared/engineering-ir/
  - platform/shared/semantic-impact-types.ts
  - platform/shared/semantic-mutation-transaction-types.ts
  - platform/shared/semantic-mutation-types.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/
  - source/
  - tsconfig.json
acceptance:
  - "All SM3-R1 and SM3-R2 canonical Semantic Mutation, lease, runtime materialization, AppContainer, process-tree, durability, timeout, selection, and redaction clauses remain in force; R3 changes only the local supervisor evidence and cleanup decision boundary."
  - "The R2 execution snapshot, owner sidecar, retained terminal namespace, external recovery workspace, raw supervisor artifacts, and stop record remain byte-for-byte outside R3 recovery and cleanup authority."
  - "R3 uses a new run directory, namespace, owned execution snapshot, execution manifest digest, and checkpoint schema; it never resumes, rewrites, removes, or adopts the R2 checkpoint or namespace."
  - "The original 39-file selection and 600000 ms per-test timeout remain derived only from sm3-r1-focused-blocker-repair-v1 tests[0]; R3 does not add a reporter, split the child, reorder files, or change the child argv."
  - "Gate Evidence V2 retains a dedicated V1 validator for the frozen R2 bundle and adds an exact digest-bound diagnostic object without weakening stream digests, tree closure, repository stability, recovery, residue, or journal validation."
  - "The streaming diagnostic observer is bounded, chunk-boundary safe, ANSI-insensitive, and fail closed; it persists no raw line, test title, stack trace, absolute path, PID, SID, environment, command line, or Error object."
  - "A failure index contains only canonical unique indexes into the already frozen selection.testFiles array plus marker and truncation counts; unknown, oversized, malformed, or unmapped failure markers make the diagnostic non-actionable rather than leaking text."
  - "A nonzero child exit can be classified as failed only when the tree and streams are closed, the repository and owned snapshot are stable and removed, final residue is authoritative and empty, and the failure index is actionable; otherwise the status remains unknown."
  - "Profile and ACL probes expose only a typed bounded disposition plus identity count/digest; registry-key absence is authoritative zero, while deadline, lifecycle, output-limit, parse, identity, or root-identity failure remains unknown without raw host-tool output."
  - "Post-child recovery authority is derived only from canonical durable owner, pending owner, native result, and writer lease records after the child tree is proven closed; ACL presence is residue, not write authority, and cannot block owner-aware recovery."
  - "The supervisor may remove only its own sidecar-bound R3 namespace after durable authority is absent, owned recovery is complete, and the AppContainer profile set exactly matches the pre-run baseline; final ACL absence is then proved against the missing namespace."
  - "Any unknown profile set, profile drift, incomplete durable recovery, repository drift, unclosed tree, observer truncation, missing final census, or snapshot mismatch preserves the R3 namespace and snapshot and yields unknown."
  - "Deterministic tests cover split UTF-8/chunk markers, ANSI output, selected and unselected paths, duplicate markers, oversized lines, unmapped failures, V1/V2 cross-version rejection, registry-root absence, typed probe failures, owner recovery with ACL unknown, profile drift, namespace removal, and crash-checkpoint replay."
  - "After focused tests and concentrated static review, the original 39-file owner batch runs exactly once under R3. Passed permits the listed downstream delta Gates; actionable failed or any unknown/timed-out/incomplete result writes the R3 stop record and stops without a selected-test rerun."
tests:
  - "bun test tests/unit/work-package-gate-contract.test.ts tests/unit/work-package-gate-execution.test.ts --timeout 180000"
  - "bun scripts/run-work-package-gate.ts --manifest docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md --selection-manifest docs/work-packages/sm3-r1-focused-blocker-repair-v1.md --selection-index 0 --watchdog-ms 1800000 --cleanup-ms 120000 --run-dir .tmp/sm3-r3-work-package-gate"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run imports:check"
  - "SEC_AFFECTED_TESTS_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
  - "git diff --check"
---

# SM3-R3 Actionable Runtime Gate V1

R2 的唯一 supervised owner batch 已产生 digest-valid `unknown`：child exit 1、tree closed、streams drained，但 failure identity 未保留，post-run residue census 也不可判定。R3 不修改任何 Semantic Mutation 产品合同，也不把 R2 的 retained authority 当作可清理垃圾；它只修复 supervisor 的两个观察盲点，然后以新的 execution authority 运行一次原 owner batch。

## 固定 DAG

```text
R3-0 freeze this manifest and preserve every R2 authority asset
  ↓
R3-1 evidence-v2 + bounded failure-selection index
  ↓
R3-2 typed profile/ACL probes + owner-aware cleanup algebra
  ↓
R3-3 deterministic synthetic/fake-child contract tests
  ↓
R3-4 concentrated read-only architecture/evidence review
  ↓
R3-5 exactly one supervised original 39-file batch
  ├─ passed → typecheck → changed-only imports → affected → Contract Freeze → docs → patch
  ├─ actionable failed → write R3 stop record → freeze a separate focused repair package
  └─ timed-out/unknown/incomplete → preserve authority → write R3 stop record → stop
```

R3-1 与 R3-2 修改同一个 evidence/checkpoint contract，由 A0 串行实现。Review 只读并行，不能修改 schema、status algebra 或 cleanup authority。任何需要进入 `scripts/codex/`、hosted Evidence V2、`platform/shared/process.ts`、Semantic Mutation canonical type 或产品 runtime 的发现都必须停止并重新冻结。

## Failure index contract

Supervisor 仍对 stdout/stderr 全量计数并计算 SHA-256，但只向 bounded diagnostic observer 暴露有限字节。Observer 以流式 UTF-8 decoder 和有界 line buffer 去除 ANSI，只接受当前 frozen selection 中的 exact repo-relative file header，并只把严格 Bun failure marker 归属到最近的合法 header。最终 evidence 只保存 selection index、marker count、unmapped count 与 truncation flags；file path 由已存在的 `selection.testFiles[index]` 解释，不保存 failure text。

若 child exit 非零但不存在完整、无歧义、未截断的 index，Gate 仍为 `unknown`。R3 不根据 stdout/stderr digest 猜测试，不在同一包追跑单文件，也不把 test title 或 Error tail提交进仓库。

## Residue decision contract

Post-child 先证明 child tree closed，再执行 structure/profile ownership census。Registry mapping root 不存在表示 authoritative empty set；其余 host-tool异常只产生 typed unknown disposition。Durable owner/pending/native-result/lease 决定是否需要唯一一次 owned recovery；ACL 只表示 residue，不是 recovery authority。

只有 owned recovery完成、durable authority清零、profile set与pre-run baseline exact match时，supervisor才可删除自己 sidecar-bound的R3 namespace。删除成功后的final census对缺失namespace直接证明ACL empty；任何profile drift、owner不确定、recovery失败或删除失败都保留R3 namespace与snapshot。R2 snapshot、owner sidecar、retained namespace和external recovery workspace不属于本包。

## Stop rule

Focused tests只使用 synthetic child/probe vectors。集中静态复审无 blocker后，原39-file argv只能运行一次。结果为 actionable failed、timed-out、unknown、evidence不完整或authority未清零时立即写 `docs/evidence/v0-4-semantic-mutation-apply-r3-verification.json` 并停止；不得在R3下追跑选中测试、增加timeout、拆分batch、触发GitHub Actions或运行Full/all-slow/workspace/reference chain。
