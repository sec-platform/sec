---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-04
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@a91ac030`（PR #268 已合并，Verification 1B-4 进入主干，resolver 返回 `matchingDefaultBlob: none`）、唯一 formal Work Package `canonical-architecture-convergence-v1`（Issue #265 / PR #266 从新主干重建）、已吸收的 W/N/S 三轨与全资产审计重算。

旧 Verification 自动队列已失效，本窗口不再保留任何自动合并链；`docs/work/**` 中失效的旧队列引用已删除。Issue、旧 stacked Draft 与 PR body 只提供设计来源和导航，不能证明完成或授权自动后继。

## 当前唯一 Work Package

### canonical-architecture-convergence-v1

- Issue #265 / PR #266；从 `main@a91ac030` 重建为单一父、单一意图明确的 squash commit，旧 17 个过程提交不进入主干。
- 同一候选内原子完成：冻结本 manifest → pointer 切换 → rolling plan 重算 → 1B-4 manifest 归档至 `docs/archive/work-packages/`。
- 顶层权威融合：`docs/product.md`、`docs/system-architecture.md`、`docs/roadmap.md` 与各领域 canonical 文档吸收 #243 owner 裁决（Compiler Target vs Runtime Host、Mutation rollback vs Migration recovery、Responsibility owner、Verification vs Compatibility vs Support、Role/Operation/Skill/Workbench）。
- 根路线补齐三轨：Workspace Domain（W0–W7）、Nexus Conformance（N0–N8）、Specialized Target / Provider（S0–S7），并加入基础设施饥饿保护。
- Evidence 生命周期：2026-08-03 阶段计划标记 historical；2026-08-04 裁决与全资产审计保留并更新，不拥有当前状态或长期路线。
- 门禁：parser/pointer → docs authority registry tests → ownership/cycle census → docs-doctor full → repository audit → typecheck → affected → README byte readback → 独立 exact-head Review → hosted Quick → squash merge → new-main readback。

## 候选 Work Package

### 1. public-publisher-network-removal-v1

- 删除 `scripts/publish-public.ts` 与 `package.json` 的 `publish` 脚本；确认无其他脚本间接调用；保留 Issue #247 未来 exact-tree read-only readiness preflight 需求。
- 不顺手实现 public repository migration、SBOM、signing、community templates 或 release platform；先物理删除 force-push/live-worktree 网络写入。

### 2. external-input-security-boundary-v1

- 最小 #245 Phase A/B：GitHub 外部自然语言不进入 prompt-bound current state，只保留 bounded metadata；外部文本永远是 `external-untrusted`；维护 maintainer adoption record；candidate Agent 文件不能配置审查自身的 Reviewer；修复 architecture reviewer 的失效文档路径。
- 明确不包含 #250 Agent Knowledge Closure、#253 Engineering Practice Corpus、#254 Review Finding Platform。

### 3. task-envelope-de-specialization-v1

- 删除 `customer-normalizer.test.ts`、`customer-flow.test.ts` 与 Ticket/Customer 名称分支；测试选择改由 Acceptance + Impact + test ownership + capability/slot binding 派生。
- 完成标准：三个无关模型不修改 Core。

### 4. physical-workspace-observation-v1

- 首个只读包：exact repository/workspace/package/file inventory；Git object/content/mode identity；generated/vendor/binary/opaque；config/test/workflow/resource；unknown/unreadable frontier；deterministic snapshot revision。
- Corpus：SEC 自身 + 三个无关 TypeScript fixture；不执行不受信项目代码，不提前实现 mutation。

### 5. typescript-source-program-model-skeleton-v1

- 第一个真实纵切片：file/module/symbol/declaration/span、import/export/definition/reference。
- 不是一次制造巨型 Source Snapshot；type/call 关系与 engineering candidates 切片由后续包按真实 consumer 进入。

## 条件候选

- #248 focused repository hygiene（immutable Action SHA、禁止裸 fetch、commit subject 门禁、staged-path 防探针）：除非发现现实 P1 供应链或写入风险，否则放在 Task Envelope 去特化与 Physical Observation 两个直接产品包之后。
- #260 formatter core（formatter core / changed-scope / index-safe contract）：按「完成两个产品包 → formatter core → 再完成产品包 → hooks integration → CI enforcement」交错执行，不得连续执行三个造成基础设施长队。
- #216 release lane correction：独立小包，删除 release workflow 的无凭据 raw fetch，并同步唯一 CI step-order contract/test。
- #207 parallel resolver：仍由串行 V1/V2 lifecycle bootstrap，不允许尚未可信的 V3 resolver 给自己授权并行；需完成 relation/scope/resource/authority 语义、exact-base Integration Epoch、global writer allocation、deterministic order、receipt invalidation 与 current lifecycle 真实接入。
- #240/#242 Verification successor contracts：Execution Ledger、Evidence DAG、Run Journal、Hermetic Runtime 按真实 R3–R9 consumer 激活，不形成无限元治理前置。

## 冻结设计来源

- #236/#243：owner 收敛与架构裁决设计来源，已吸收进当前包，不另行重建 stacked docs。
- #245 旧 branch：只作为最小 external-input security boundary 的设计来源。
- #250/#253/#254：Agent Knowledge Closure、Engineering Practice Corpus、Review Finding Platform，延后但保留目标。
- old #233 / Skill V2 Spike：只保留可提炼的 Role/Operation/Primary Skill/typed transition 结论，不合并 Spike 历史。
