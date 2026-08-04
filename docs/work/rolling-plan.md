---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-03
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@a74a45730db40128b7ddc3916e7caa31c9d12ff1`、当前正式候选 PR (1B-1) / Issue #215、已关闭且未合并的 non-authority Spike PR #229、开放 Issues #206/#207/#208/#215/#216、Review/CI 与 exact tree 重新计算。PR #229 只写 `docs/proposals/agent-skill-system-v2/**`，未选择 formal Work Package、未修改控制面，也不改变本窗口的串行交付顺序。

Active documentation corpus、test runtime performance、parallel work package contract、CI speed optimization、dev-loop-speed-v1、dev-loop-speed-v2、verification-result-core-v1、ci-verification-flow-fix-v1 与 verification-result-claim-migration-v1 已进入 `main`：`docs/authority.json` 机器化拥有 active document identity、lifecycle、domain、ownership、projection、consumer 与 update trigger；CI verification contract revision 为 v19；template lock 不再串行化并发 clone；`.shared-deps/` 不再泄漏 `bun.lock`；CI 缓存、merge bootstrap CLI 与 gate API 已优化；check:fast gate 并行化、docs:doctor 增量模式、preload marker 门控、动态并发与 resource-class registry 已落地；冷启动 stamp 短路、测试基础设施硬链接克隆与跨进程 test-impact 缓存、编译器管线共享 ts-morph Project 与并行 I/O、affected-tests reverse-import-map 已落地；sec-merge-bootstrap squash 已修复 single-parent invariant；统一验证结果模型 5 态/3 disposition/4 applicability/17 reasonCode/claim-based aggregate 已建立；CI PR validation 冗余 `git fetch` 已移除；`commandAll` 自动 squash 在 attestation/verification dispatch 之前执行；产品 verification summary 已迁移至 claim-based aggregation，`skipped` 不再静默产生 `passed`。

`verification-artifact-claim-summary-v1`（PR #227 / Issue #217）已通过 trusted-base bootstrap 进入 `main@a74a4573`，Issue #217 已关闭。该包闭合 Verification Result 与 current artifact 的信任边界：canonical artifact 必须携带 `claimSummary`，legacy omission 只可诊断而不得 PASS，nested aggregate/claim/gate 矛盾由唯一 Result authority fail closed；同时根除 mutable fixture hard-link alias、fast runner 双层并发预算/资源类扁平化/失败收据丢失，并以固定宽度 bit 域 + Program identity 的 proof kernel 完成一次正式 proof reset。trust-root epoch 已切换，hosted 验证重新受信。

当前 `verification-aggregate-lattice-v1`（Issue #215 slice 1B-1）已接管唯一 formal pointer。它把 aggregate 从输入顺序 authority 改为纯函数：固定 lattice `failed > invalidated > unsupported > not-run > passed`、owning-environment-aware 观察过滤、logical proof identity 绑定、重复 claim/observation fail-closed、空 claims/无测试真值不得 passed、reused 证据必须携带 environment identity，并保持当前 writer/artifact 字节投影不变。后续 1B-2/1B-3/1B-4 分别收口 Acceptance Coverage、writer profile 与 Semantic Mutation classification。

```text
#215 Slice 1B-1 Aggregate Lattice + Proof Identity
→ #215 Slice 1B-2 Acceptance Coverage
→ #215 Slice 1B-3 Writer Profile
→ #215 Slice 1B-4 Semantic Mutation Classification
→ #216 Release Validation Credential / Fetch Trust Root
→ #207 Parallel Resolver Correctness + Integration Epoch
```

长期 Verification 架构的迁移依赖仍保持 `Failure Epoch → Trusted Bootstrap → Evidence DAG`；这只记录有序退出，不把尚未进入 `main` 的 Evidence DAG 或自动化 Kernel 升格为当前能力。

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if` 与最终 reconciliation 更新本文件。

## 当前唯一 Work Package

### verification-aggregate-lattice-v1

- Issue #215 slice 1B-1 是当前唯一 formal Work Package；schema 继续使用 `codex-development-work-package-v1`，profile 为 Quick，一个代码 Worker 与 A0 控制面 owner 串行工作。
- 阶段 0–5 执行路线继续冻结于 `docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md`；`#234/#240/#242/#245/#250/#253/#254/#236/#243/#241/#260` 继续作为设计来源冻结，不推新 commit，直到替代 WP 从新 `main` 接管。旧 #234 已随其基分支删除自动关闭；替代 PR 合并后补链接。
- 工程目标：`CodexDevelopmentAggregateVerificationClaimsV1` 成为 claim plan + observation set 的纯函数——固定 lattice、owning-environment 过滤、logical proof identity（gate revision/owner/requirement/subject/input digest/claim bindings/invalidation rules）、duplicate claim/observation fail-closed、空 claims/空 required gates/零观察不得 passed、reused 证据必须绑定 environment identity、claimResults 按 claimId 确定序；serialized aggregate assertion 继续 exact-compare canonical writer output，当前产品 claim plan 的 writer/artifact 字节不变。
- 冻结边界：只改 `platform/shared/verification-result-contract.ts` 与三个测试文件；不触碰 writer/profile、Coverage、Semantic Mutation、dev-runner、workflow、package/lock、trust root、docs/authority.json 或 current-state.yaml。环境 identity 投影保持 `<os>-<arch>` 与当前产品 plan 字节兼容。
- 退出顺序：三文件 focused batch → 消费者回归 → typecheck → docs:doctor → repository audit → affected run → independent exact-head Review → hosted Quick → squash merge → new-main readback。

## 已完成 Work Package

### verification-artifact-claim-summary-v1 (PR #227)

- 已 squash merge 至 `main@a74a4573`（Issue #217 已关闭）；在 `verification-aggregate-lattice-v1` 原子接管 pointer 后，manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：shared product claim plan 成为 current required claim/gate identity、binding、order 与 byte-equivalent normal/blocked projection 的唯一 authority；canonical artifact 必须携带 `claimSummary`；strict data-only snapshot/equality 拒绝 getter/toJSON/proxy/symbol/稀疏数组；mutable fixture 独立 inode；fast runner 单一预算 + 资源类 + 失败收据 + Program-identity proof kernel；trusted-base bootstrap 完成 epoch 切换。
- 该归档只记录已进入 `main` 的实现结果，不是当前 authority。

### affected-selection-trust-boundary-v1 (PR #220)

- 已 squash merge 至 `main@782c07a`；在 `verification-artifact-claim-summary-v1` 原子接管 pointer 后，manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：根除 affected-selection 空选择假绿与陈旧 Test Impact 缓存。建立 `AffectedSelectionTrustBoundary`（7 种边界）并投影到 `VerificationGateResultV1`；持久 cache 使用 `TestImpactCacheEnvelope` + `sourceDigest` 身份；source read/stat failure 与 empty unresolved selection 均 fail closed；契约与单元测试覆盖。
- 该归档只记录已进入 `main` 的实现结果，不是当前 authority，也不提供 Issue #215/#216/#207 的验证证据。

### canonical-text-bytes-phase-a-v1 (PR #218)

- 已合并至 `main@597b42f`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：Issue #209 Phase A — 建立 Canonical Text Byte Contract 与 Line-Ending environment settlement：`.gitattributes` 唯一 policy 覆盖 SEC 自有文本（scripts/ts/js/json/yaml/md/workflow/config = text eol=lf）与二进制（image/font/archive/database = -text）；`.editorconfig` + `.prettierrc.json` 投影 LF；text-byte-census 工具按 .gitattributes 分类（canonical-lf/explicit-crlf/binary/preserve-external/unknown）并检测 CRLF/mixed/BOM/NUL/unknown-encoding，unknown fail-closed；worktree-settlement 非破坏性 preflight 输出 receipt，支持 `--fix` 重物化 governed text；CLI 注册 `sec text census` 与 `sec environment settle`；32 + 14 个测试覆盖。



### work-readme-conditional-state-clarification-v1 (PR #214)

- 已合并至 `main@80b7fb9`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：归档 `exact-default-base-identity-v1` manifest，激活新 pointer，并在 `docs/work/README.md` 中明确 conditional manifest state 与 trusted exact base 语义；首个 hosted verification 真实通过（quick profile SUCCESS），证明 PR #213 trust-root 修复生效。

### exact-default-base-identity-v1 (PR #213)

- 已合并至 `main@28b62b7`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：Issue #212 — 为 repository audit 建立显式 `--default-ref <exact-commit-or-ref>` 输入合同；hosted 路径传入 trusted exact base SHA（复用 `SEC_CHANGED_BASE`）；local 路径使用 live `refs/remotes/origin/main`；不恢复无凭据 fetch；`persist-credentials: false` 不变；6 个回归测试覆盖所有关键场景。

### verification-result-claim-migration-v1 (PR #211)

- 已合并至 `main@c38d249`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：Issue #176 Slice 2 — 将产品 verification summary 迁移至 `CodexDevelopmentAggregateVerificationClaimsV1` claim-based aggregation；`summarizeReport` 不再允许 `skipped` 静默产生 `passed`；policy `skipped` 显式 `not-applicable`；service-mode `passed` 映射为 `not-run` + `current-runner-not-owning-environment`；`writeBlockedVerificationSnapshot` 发出 not-run claims；11 个回归测试覆盖所有关键场景。

### ci-verification-flow-fix-v1 (PR #210)

- 已合并至 `main@c13a229`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：移除 `compiler-pr-validation.yml` 冗余 `git fetch` 步骤（与 `persist-credentials: false` 冲突导致自 PR #200 起所有 hosted 验证失败）；重排 `sec-merge-bootstrap.ts commandAll` 使 `ensureSingleParent` 在 attestation/verification dispatch 之前执行（消除手动 squash workaround）；`persist-credentials: false` 安全不变量不变；ordering 不变量有测试守护。

### verification-result-core-v1 (PR #204)

- 已合并至 `main@46f92e4`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：Issue #176 Slice 1 建立 5 态统一验证结果模型（passed/failed/not-run/unsupported/invalidated）、3 disposition（executed/reused/not-executed）、4 applicability、17 reasonCode、`VerificationGateResultV1` schema、claim-based 6 步 aggregate 算法、legacy mapping helpers（product/CI V2/semantic-mutation/evidence-disposition → 统一模型，lossy 暴露为 unresolved/invalidated）；10 个回归场景覆盖；同时修复 main 分支 documentation-authority 与 testkit-workspace-cleanup 测试 drift。

### dev-loop-speed-v2 (PR #203)

- 已合并至 `main@abc277e`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：5 个 Slice 系统性消除剩余高影响瓶颈——冷启动消除（stamp 短路、移除 reenter、git 调用合并、inline ConfigCache for TCB compliance）；测试基础设施加固（硬链接克隆、指数退避清理、preload 移除扫描、test-impact 跨进程缓存）；编译器管线并行化（共享 ts-morph Project、manifestCache 激活、Promise.all 并行 I/O、prettier config 单次解析）；check:fast 阶段并行化（docs:doctor || typecheck、per-namespace lease）；affected-tests 优化（reverse-import-map、复用 selection）。同时修复 sec-merge-bootstrap squash 的 single-parent invariant bug（`git commit --amend` → `git commit -F`，parent === base）。

### dev-loop-speed-v1 (PR #202)

- 已合并至 `main@7b46604`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：动态并发（os.availableParallelism）；resource-class-aware bounded-parallel 队列替代串行 exclusive；check:fast gate 并行化（imports:prepare || docs:doctor → typecheck → test:fast）；docs:doctor 增量模式（--since git-ref）；tsc cache key 改为内容 hash；architecture-tools 改用 ubuntu runner；preload stale cleanup marker-file 门控。

### ci-speed-optimization-v1 (PR #201)

- 已合并至 `main@7589886`；manifest blob 已在 default branch 上，pointer 返回 `none`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：为所有 CI 工作流添加 bun install cache 和 tsc incremental build info cache；为 merge-gate push 触发器添加 paths filter；创建 sec-merge-bootstrap.ts CLI 工具自动化合并流程；优化 merge-gate API 调用去重；同步 ci-contract.ts STEP_ORDER 常量；修复 rolling-plan.md 的 PR #199 replay provenance regression。

### parallel-work-package-contract-v1 (PR #200)

- 已合并至 `main@e2c079c`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：为 Work Package manifest 创建 V3 schema（codex-development-work-package-v3）parser/types/validator，包含 authority reads/writes、owned/permitted/forbidden paths、global exclusive resources、shared read-only resources、requires/orderedAfter/conflictsWith；实现 pairwise conflict resolver（7 步冲突算法）和 global exclusive resource registry（8 类全局单 writer）；V1/V2 输入返回 unresolved；默认仍单包。

### test-runtime-performance-v1 (PR #199)

- 已合并至 `main@e857ca5`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：移除 `cloneWorkspaceTemplate` 中冗余的 template creation lock；`afterAll` 清理从串行改为 bounded-concurrency 并行；修复 `.shared-deps/` 的 `bun install` 创建 `bun.lock` 的合同违反。

### active-documentation-corpus-v1 (PR #196)

- 已合并至 `main@95baca1`；Issue #173 已关闭；manifest 已归档至 `docs/archive/work-packages/`。

## 候选 Work Package

### 1. verification-acceptance-coverage-v1

- 1B-2，从 1B-1 的新 `main` 冻结；单一 machine contract 拥有物理测试路径 → 语义 acceptance ID 绑定；`build-acceptance-coverage` 缺失/重复/未知路径 fail-closed；plan ID 存在性与目标闭合；依赖环 fail-closed；artifact 读回重算 `acceptancePassed`。
- 退出：focused tests、typecheck、docs:doctor、repository audit、independent Review、hosted Quick、squash merge、new-main readback。

### 2. verification-writer-profile-v1

- 1B-3，从 1B-2 的新 `main` 冻结；同步 `product-verification-profile.ts`、`verify-project.ts`、`verify-orchestrator.ts` 与 artifact contract；no-policy 时 not-applicable Policy claim 从 aggregate 要求中移除；full-runtime PASS 要求非空执行清单与 command identity；blocked snapshot 与普通物理失败保持区分。
- 退出：与 1B-2 相同的完整门禁序列。

### 3. semantic-mutation-classification-v1

- 1B-4，从 1B-3 的新 `main` 冻结；isolated runner 拆成 core + thin verification/Coverage wrapper；nonzero exit + canonical `invalidated/unsupported/not-run` → `blocked`，仅 canonical `failed` + nonzero → `failed`，canonical `passed` 仍要求 zero exit 且 fast/runtime 物理通过。
- 完成后关闭旧 #234 的替代链接与 Issue #215。

### 4. release-validation-credential-fetch-trust-root-v1

- 从 1B-4 的新 `main` 冻结独立小包；删除 release workflow 的无凭据 raw fetch，并同步唯一 CI step-order contract/test。
- 保持 `persist-credentials: false` 与 trusted `SEC_CHANGED_BASE`；完成 base-side bootstrap 与新-main release canary readback。

### 5. parallel-resolver-integration-epoch-v1

- 仍由当前串行 V1/V2 lifecycle bootstrap，不允许尚未可信的 V3 resolver 给自己授权并行。
- 完成 relation/scope/resource/authority 语义、exact-base Integration Epoch、global writer allocation、deterministic order、receipt invalidation 与 current lifecycle 真实接入。
- 只有它进入新 `main` 且首个正式 V3 successor 真实激活并产生 epoch/readback 后，才允许多个 formal writers。

## 并行 Spike

Runtime/Library physical matrix、dependency census、Impact census、Compiler Incremental Phase 0 benchmark与Hermetic/Property设计Census可继续在scratch/Issue Evidence中执行；不得修改产品分支、package/lock、docs/work或冒充正式结果。Compiler Incremental Phase 1在Phase 0 Evidence与parallel contract完成后由下一次rolling-plan重算选入。

## 重算触发

`main`、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现 supersede、parallel conflict结果或全仓审计的新决定性 finding，都会触发 live resolver 与本窗口整体重算。
