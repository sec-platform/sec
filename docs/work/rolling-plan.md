---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-03
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@6cc3bf8a3b655bebf85dfca3f065c9842207c086`、当前正式候选 PR #227 / Issue #217、已关闭且未合并的 non-authority Spike PR #229、开放 Issues #206/#207/#208/#215/#216/#217、Review/CI 与 exact tree 重新计算。PR #229 只写 `docs/proposals/agent-skill-system-v2/**`，未选择 formal Work Package、未修改控制面，也不改变本窗口的串行交付顺序。

Active documentation corpus、test runtime performance、parallel work package contract、CI speed optimization、dev-loop-speed-v1、dev-loop-speed-v2、verification-result-core-v1、ci-verification-flow-fix-v1 与 verification-result-claim-migration-v1 已进入 `main`：`docs/authority.json` 机器化拥有 active document identity、lifecycle、domain、ownership、projection、consumer 与 update trigger；CI verification contract revision 为 v19；template lock 不再串行化并发 clone；`.shared-deps/` 不再泄漏 `bun.lock`；CI 缓存、merge bootstrap CLI 与 gate API 已优化；check:fast gate 并行化、docs:doctor 增量模式、preload marker 门控、动态并发与 resource-class registry 已落地；冷启动 stamp 短路、测试基础设施硬链接克隆与跨进程 test-impact 缓存、编译器管线共享 ts-morph Project 与并行 I/O、affected-tests reverse-import-map 已落地；sec-merge-bootstrap squash 已修复 single-parent invariant；统一验证结果模型 5 态/3 disposition/4 applicability/17 reasonCode/claim-based aggregate 已建立；CI PR validation 冗余 `git fetch` 已移除；`commandAll` 自动 squash 在 attestation/verification dispatch 之前执行；产品 verification summary 已迁移至 claim-based aggregation，`skipped` 不再静默产生 `passed`。

当前 `verification-artifact-claim-summary-v1`（Issue #217）已接管唯一 formal pointer。它先闭合 Verification Result 与 current artifact 的信任边界：canonical artifact 必须携带 `claimSummary`，legacy omission 只可诊断而不得 PASS，nested aggregate/claim/gate 矛盾由唯一 Result authority fail closed。最终 affected closure 在 live base 与 candidate 上先后暴露了 mutable workspace fixture 使用 hard-link alias，以及外层 process 与 Bun 内层并发各自解释 `availableParallelism()`、resource class 被扁平化、child failure receipt 丢失的既有基础设施缺陷；同一原包已最小重冻结，由同一代码 owner 顺序根除这些错误抽象，保持 Semantic Mutation 的 `nlink=1` 门禁、V19 Gate plan 与 timeout 不变。第一次 Runner contract proof reset 的独立 Review又证明裸 identifier 名字表、独立 loader/policy extractor 与完整读取后再限额仍可被 lexical shadow、import-equals、namespace和wrapper绕过；该失败 analyzer 已失效，原包改为 TypeScript Program identity 与 opened-handle limit+1 read，不保留 regex、名字表或 fixture-only fallback。首个 Program 实现因每个 scenario 重建完整 live inventory、Program 与图求解而发生第一次资源失效；改为一个 suite Program 后，正确的 shorthand lexical-value修复又接通了原本被假阴性遮住的 field-insensitive 对象流，使每个 value 上的全 Program callable/namespace 集合形成新的笛卡尔放大，Bun 在约 3.74 GiB 仍无结果。两次独立 Review确认根因是输入规模的 fact lattice，而非Program构造次数或运行预算；该 exact input不再重跑，状态进入 `STOP_PROOF_RESET`。当前同一原包重冻结为固定宽度敏感 bit 域、exact property/export slots、稀疏 callable/module SCC、冻结拓扑、一次 delta-only solve 和可由输入计数证明的复杂度上界；普通 callable/namespace不再成为 value fact，unknown executable flow稳定 fail closed。生产中的 authority-binding bounded executor同时改为文件私有，由模块边界而非当前consumer census保证不可暴露。该候选修改 verifier、test-fixture 与 dev-runner trust root，最终只能通过 trusted-base bootstrap、独立 exact-head Review、expected-head integration 与 new-main readback闭合。

```text
#217 Verification Artifact Trust Boundary
→ #215 Verification Claim Aggregate Correctness
→ #216 Release Validation Credential / Fetch Trust Root
→ #207 Parallel Resolver Correctness + Integration Epoch
```

长期 Verification 架构的迁移依赖仍保持 `Failure Epoch → Trusted Bootstrap → Evidence DAG`；这只记录有序退出，不把尚未进入 `main` 的 Evidence DAG 或自动化 Kernel 升格为当前能力。

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if` 与最终 reconciliation 更新本文件。

## 当前唯一 Work Package

### verification-artifact-claim-summary-v1

- Issue #217 / PR #227 是当前唯一 formal Work Package；schema 继续使用 `codex-development-work-package-v1`，profile 为 Quick，一个代码 Worker 与 A0 控制面 owner 串行工作。
- 阶段 0–5 执行路线已冻结于 `docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md`；`#234/#240/#242/#245/#250/#253/#254/#236/#243/#241/#260` 作为设计来源冻结，不推新 commit，直到替代 WP 从新 `main` 接管。
- 工程目标：shared product claim plan 是 current required claim/gate identity、binding、order 与 byte-equivalent normal/blocked report-to-gate projection 的唯一 authority，正常/blocked writer、gate producer 与 artifact validator共同消费；Result contract 以受信 plan 提供唯一 canonical aggregate assertion；artifact contract 只拥有 envelope、cross-artifact binding 与 legacy projection，canonical fast/runtime/policy gates必须与serialized lane/policy reports逐字段一致，不能用自洽aggregate掩盖跨投影矛盾；current canonical artifact 必须包含完整 `claimSummary`，legacy omission或删除 required claim都不能签发 PASS；`copyWorkspaceFixture` 为 mutable workspace 产生独立 physical file identity；fast runner 由一个 combined budget 限制完整 process graph，按 physical resource class 调度并在 batch 尾保留结构化失败收据。
- 冻结边界：同一代码 owner 顺序拥有 Result/artifact、mutable fixture、fast runner 三个已实现 seam；本次 proof reset 的新 delta只拥有 `tests/helpers/dev-runner-authority-proof.ts`、`tests/unit/dev-runner-authority-proof.test.ts`、`tests/contract/dev-runner-contract.test.ts`、`platform/dev-runner/test-runner.ts` 与 `tests/unit/test-runner.test.ts`。Runner proof 的唯一语义 authority 是一次读取的完整 bounded live inventory、一个同时包含全部唯一虚拟 scenario 的 suite-wide Program、一个 ProgramSymbolIndex、固定 Handle/ProtectedRole bits、属性敏感 typed topology、exact export slots、稀疏 callable/module SCC和一次delta solve；每个 value只有固定bit宽度，普通 callable/namespace identity从不传播，所有拓扑在 solve 前冻结。`inventoryReadCount/programBuildCount/typeCheckerBuildCount/topologyFreezeCount/graphSolveCount` 必须各为1，post-solve mutation、arbitrary callable/namespace facts和ambient cross seed必须为0，fact/edge/rule工作量不得超过input-derived bound。host source在allocation前由opened handle证明identity、size、limit+1与EOF。失败的名字表 analyzer、per-scenario Program、Program-sized callable/namespace lattice与validator侧第二遍closure整体退役；正确shorthand identity保留。authority-binding bounded executor改为file-local，任何导出的测试seam必须是无child authority的纯调度器；`runDevCommand`保持唯一reviewed dev-runner spawn dispatcher，但不声称仓库其他合法process owner不存在。不修改 Semantic Mutation产品门禁，不修改#215的owning environment、status lattice、policy applicability或runtime no-test语义，也不修改V19 Gate plan、workflow、package/lock、Evidence schema、Test Impact algorithm或parallel resolver。
- 退出顺序：两文件 finite-kernel proof-reset focused → imports freeze → Product/Runner双exact-tree Review零finding → 全十二文件manifest focused batch → new single-parent candidate → 一次affected/Risk/audit → independent Review + trusted-base bootstrap → expected-head integration → new-main readback → `TASK_RESTART_REQUIRED`。若重冻结后再次出现同类fact-domain资源放大，直接返回`BLOCKED_REDESIGN_REQUIRED`。

## 已完成 Work Package

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

### 1. verification-claim-aggregate-correctness-v1

- 在 #227 new-main readback 后的新任务重新 orientation 并冻结；不得预先复用当前 base、selector、Review 或 Evidence。
- 工程结果：canonical environment identity、顺序无关 status rank、真实 decisive reason、identity/closure fail-closed、policy applicability、runtime empty-selection truth 与 coverage consumer correctness。
- 退出：trust-root bootstrap、independent Review、manual integration、new-main readback，然后再次 `TASK_RESTART_REQUIRED`。

### 2. release-validation-credential-fetch-trust-root-v1

- 仅从 #215 的新 `main` 冻结独立小包；删除 release workflow 的无凭据 raw fetch，并同步唯一 CI step-order contract/test。
- 保持 `persist-credentials: false` 与 trusted `SEC_CHANGED_BASE`；完成 base-side bootstrap 与新-main release canary readback。

### 3. parallel-resolver-integration-epoch-v1

- 仍由当前串行 V1/V2 lifecycle bootstrap，不允许尚未可信的 V3 resolver 给自己授权并行。
- 完成 relation/scope/resource/authority 语义、exact-base Integration Epoch、global writer allocation、deterministic order、receipt invalidation 与 current lifecycle 真实接入。
- 只有它进入新 `main` 且首个正式 V3 successor 真实激活并产生 epoch/readback 后，才允许多个 formal writers。

## 并行 Spike

Runtime/Library physical matrix、dependency census、Impact census、Compiler Incremental Phase 0 benchmark与Hermetic/Property设计Census可继续在scratch/Issue Evidence中执行；不得修改产品分支、package/lock、docs/work或冒充正式结果。Compiler Incremental Phase 1在Phase 0 Evidence与parallel contract完成后由下一次rolling-plan重算选入。

## 重算触发

`main`、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现 supersede、parallel conflict结果或全仓审计的新决定性 finding，都会触发 live resolver 与本窗口整体重算。
