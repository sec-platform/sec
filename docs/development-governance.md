---
title: 自主开发治理
status: stable
domain: development-governance
last-reviewed: 2026-08-04
---

# 自主开发治理

本文拥有 SEC 仓库开发的事实源、计划分层、Role/Operation/Skill 边界、Issue/Work Package/PR/Evidence 生命周期、A0/Worker/Reviewer/Auditor 权责、可验证续跑和收口规则。产品机制、验证算法和权限判断由各自代码 owner 实现；Skill 只保存不可完全机械化的短启发式方法。

## 自主治理责任

维护者必须持续对齐产品、架构、实现、测试、文档、CI、Review、分支和 `main`。每次任务先判断：

- 产品目标与实现是否偏离；
- 横切设施是否抢占产品主线；
- canonical owner 是否重复、缺失或被 Proposal/Evidence/Projection 竞争；
- 同类缺陷是否说明共享抽象、状态 owner、fixture、selector 或 Gate 缺失；
- `main` 是否已包含结果而旧 PR/branch/plan 仍声称未完成；
- 当前包、rolling plan、Issue、Skill 或文档是否已被新事实取代；
- 正确 candidate 是否只剩 Review、合并、归档或删除。

合法动作可以是实现、设计重算、合并、关闭、归档、删除临时结构或确认无需修改。不得为了表现“持续开发”制造无证据变化。

## 当前能力与目标边界

当前可强制：`main` authority、一个 formal writer、frozen manifest、exact candidate Evidence、独立 Review、merge readback、branch hygiene 和 generated-state settlement。

已存在但不自动授权：并行 Work Package resolver 的部分合同、候选 Skill/path coverage、未来 Run Kernel/Integration Queue 设计。没有真实 consumer 和物理 Evidence 时，目标设计不得由文档、Issue、Skill prose 或模拟对象升格为现有能力。

## 事实、授权与适用性顺序

```text
latest main + live Git/GitHub facts
→ 用户最新 Goal / correction
→ docs/authority.json 与 canonical domain owner
→ product / system architecture / roadmap
→ trusted repository orientation or exact audit
→ Role + operation kind + frozen Work Package / Envelope
→ sec-skill-applicability-decision-v1
→ zero or one trusted Skill guidance
→ source / contracts / tests / deterministic services
→ exact-head Evidence + independent Review
→ merge → new-main readback → cleanup → replan
```

`main` 是唯一正式产品事实。Branch、Issue、PR body、聊天、计划、看板、报告、代码图、Completion Report、模型记忆和 Skill 只提供导航、候选、启发式或 Evidence，不能证明结果进入主干。

任何 default ref、target workspace、pointer、manifest、base/head、Review/CI、authority owner、Goal 或 Envelope 无法解析时 fail closed。

## Ignored 与 Generated State

`.gitignore` 只取消 Git tracking，不授予删除、保留、恢复或 settled 声明。Repository-local generated state 必须有唯一 owner、重建方式、cleanup profile、settlement effect 和 physical readback，并区分：

- rebuildable cache / toolchain state；
- owner/liveness 约束的临时 workspace；
- 有 retention/promotion 的 diagnostic；
- identity-bound control state；
- 必须位于仓库外的 durable recovery；
- 默认 fail closed 的 unknown。

`automatic` 只回收可证明 owner 已死亡的实例；`safe` 可再处理过期 legacy workspace 与 diagnostic；`all-rebuildable` 才能删除已登记 cache/toolchain。Active、cross-host、malformed owner、symlink/reparse、changed-after-plan、recovery、control 和 unknown 不进入普通删除集。

清理必须冻结 physical snapshot、同文件系统 quarantine、no-follow 删除，并以 ENOENT/readback 和 typed receipt 闭合。Evidence 与 durable recovery 不是 cache 子类。

## 计划与记录分层

- `docs/product.md`：产品问题、边界、用户结果和成功判据；
- `docs/system-architecture.md`：总体对象、authority flow、层次和单写者；
- `docs/roadmap.md`：唯一稳定 capability DAG；
- canonical domain docs/code：领域对象、公共合同和长期不变量；
- GitHub Issue：问题、证据、决策、依赖、验收和反证；
- rolling plan：当前包与二至五个条件候选；
- Work Package manifest：正式交付闭包；
- Operation/Task Envelope：一个角色、一个 operation、一个 seam 的授权；
- Pull Request：exact candidate diff；
- Checks/Artifacts/Evidence：绑定 exact input/environment 的物理证明；
- `main`：完成后的唯一产品结果。

动态 SHA、run 和 failure tail 不复制到 stable docs。Evidence 不拥有当前状态或长期路线。

## Role 与 Operation Envelope

Role 是职责和可申请权限上限，不是 workflow：

- Integrator/A0：事实重算、work selection、control plane、Gate custody、merge 与 closeout；
- Worker：在 frozen Envelope 内实现；
- Reviewer：独立只读 exact candidate；
- Auditor：对 exact revision 做事实和机制 Census；
- Maintainer：在文档、toolchain、provider 或 agent-system 的明确 Envelope 内维护。

一次 Envelope 至少绑定 repository、exact revisions、Role、operation、Goal digest、authority/path/resource/capability grant、inputs/outputs、Verification、stop/reload/reconcile 和 expiry。

最终权限始终是交集：

```text
Role maximum
∩ Operation Envelope grant
∩ repository/domain policy
∩ tool/provider capability
∩ current state transition
```

任何 Skill 都不能扩大该交集。

## Skill 适用性与隔离

### 零个或一个 Skill

一次 operation 允许：

- 一个 `applicable` Skill；或
- `none-required`，只按 Universal Policy 与完整 Envelope 执行。

不再强制“必须选一个最接近的 Skill”。`ambiguous | stale | conflict | not-applicable` 均停止写入并返回 Reconciliation Delta。

### 选择前只读元数据

完整 Skill 正文只能在 `sec-skill-applicability-decision-v1` 之后加载。决策至少绑定：

- repository、trusted revision 与 target revision；
- Role、operation、Goal digest、Envelope digest；
- write intent、candidate state、actor independence；
- candidate Skill IDs、required/granted capabilities；
- authority/scope conflicts；
- selected Skill ID 与 trusted Skill blob；
- expiry/reload conditions。

Path/Markdown coverage、行为 owner registry 和 test-impact 映射只用于影响分析、审计和测试选择，不是 runtime selector。

### Trusted guidance quarantine

候选如果修改 `AGENTS.md`、`.agents/skills/**`、Skill profile、selector 或相关 verifier，这些候选内容只作为 SUT/Review 数据。当前候选的实现、Review、Gate 和合并仍使用 trusted base/main 的 profile 与 Skill blob；candidate 不得通过修改 guidance 自我授权。

Goal、trusted/target revision、Role、operation、Envelope 或 candidate state 任一变化，旧 decision 立即 `stale`。

### Skill 内容边界

Skill 只保留独有的：适用场景、输入、分析方法、工具选择、输出、停止和专业禁忌。通用权限、Gate、状态机、Schema、平台矩阵和产品事实只存在于 canonical code/docs，不在 17 个 Skill 中重复。

Skill 不拥有：

- 产品/架构事实；
- authority、path、resource 或 capability grant；
- Gate 选择与结果真值；
- Work Package、Failure/Epoch、merge legality 或完成定义；
- 动态 current state。

## A0、Worker、Reviewer 与 Auditor

A0 独占事实重算、工作选择、控制面、冲突排序、Gate custody、merge/readback 和清理；不替 Worker 修改同一 owner seam，也不把 findings 合成巨型实现包。

Worker 只在完整 Envelope 内实现；root assumption、owner、scope 或 architecture 不成立时停止并返回 Reconciliation Delta。

Reviewer 只读 exact base/head/tree、authority、Evidence 和 diff；Head 变化立即使 Review stale。作者自评不构成独立 Review。

Auditor 对全部 tracked paths、owner、entry、state、dependency、verification 和 unknown 做 exact-revision Census；Audit 产生 Evidence 和聚焦 findings，不取得产品 authority。

## Work Package 与并行

Manifest 冻结 base、authority、paths、resources、dependencies、acceptance、tests、Evidence、migration、readback 和 cleanup。Pointer、branch、PR 或 candidate 存在都不是执行/合并授权。

当前默认一个 formal writer。只读 research/Census 可并行。只有两个真实正式候选已冻结，并由机器证明 authority/path/resource/worktree/Evidence 全部兼容时才允许同一 Integration Epoch 并行；`unresolved` 不解释为安全。

完整程序路线不得塞入一个 Work Package。一个包实现一个可独立验证、迁移、readback 和退役旧路径的纵向闭包。

## Branch 与 PR

- `feat/*`：正式产品能力；
- `fix/*`：正式缺陷修复；
- `refactor/*`：外部语义不变的结构重构；
- `docs/*` / `chore/*`：文档和工程维护；
- `spike/*`：未知探索，默认不合并；
- `validation/*` / `diagnostic/*`：验证和 Evidence，默认不合并；
- `integration/*`：仅用于两条真实大型并行产品线的临时总装。

Squash merge 后按最终 tree/contracts/行为判断内容是否进入 `main`，不按 ancestry、分支名或 ahead/behind 机械判断。

## Impact、Failure 与续跑

修改共享 contract、owner、pipeline、runtime 或 unknown 前，消费统一 Impact/test selector；能力不足时降级到 exact imports、consumer 和 test-impact Census，不临时安装工具改变 candidate 环境。

相同 Gate identity 的 PASS 复用；输入与 failure fingerprint 未变时不重复确定性失败。第二次同根因 frozen invalidation进入 proof reset；再次发生进入 redesign-required。

上下文压缩、进程退出、会话或 worktree 切换后，从 main、PR/Issue、manifest、dirty state、CI/Review、failure Evidence 和 Skill applicability 重新计算 next transition；不恢复隐藏思维。未外化的“已完成”视为 unknown。

## Merge 与收口

变化只有同时满足以下条件才进入 `main`：

1. 仍是有效产品能力、修复或必要维护；
2. `main` 尚未包含，且未被更新实现取代；
3. authority、公共合同、migration 和 architecture 一致；
4. exact identities 清楚；
5. required Evidence 与独立 Review 通过；
6. 无 unresolved thread、有效 REQUEST_CHANGES、probe、临时入口或 artifact drift；
7. consumer 切换、rollback 和 cleanup 已理解。

满足条件时及时合并，不继续制造修改。Merge 后 readback 新 `main`，关闭 absorbed/superseded/probe 结构，归档 manifest，清理安全可删除的 branch/worktree/workflow，并重新计算计划。工具做不到的物理动作必须准确说明，不能把“已审查”写成“已删除”。
