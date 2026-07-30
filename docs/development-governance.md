---
title: 自主开发治理
status: stable
domain: development-governance
last-reviewed: 2026-07-30
---

# 自主开发治理

本文拥有 SEC 仓库开发的事实源、记录分层、A0/Worker 权责、Issue/Work Package/PR/Evidence 生命周期、Skill边界和可验证续跑目标。具体启发式闭包只存在于 `.agents/skills/**`；机器可判断的规则必须下沉到代码合同。

## 当前规则与目标机制

- **当前可强制规则**：`main` authority、唯一 formal active Work Package、single writer、frozen manifest、exact candidate Evidence、独立 Review、merge readback 和 branch hygiene。
- **已实现**：并行 Work Package resolver（V3 schema + pairwise conflict resolver + global exclusive resource registry，见 `scripts/codex/parallel-work-package-contract.ts`）。
- **已设计但需独立实现的目标**：Integration Queue、Development Run Kernel、统一 Run Journal 和自动 feedback service。

目标设计不能被文档、Issue 或模拟对象升格为当前能力。并行 Work Package resolver 已实现但尚未接入 CI/merge-gate；在 Integration Queue、Development Run Kernel、统一 Run Journal 和自动 feedback service 进入 `main` 前，默认继续使用一个 formal active Work Package 和可验证的 manual-shadow 续跑。

## 事实与授权顺序

```text
latest main + live GitHub/repository facts
→ docs/authority.json and canonical domain owners
→ AGENTS.md router
→ trusted repository orientation or full audit
→ selected frozen Work Package
→ Task Envelope / owned seam
→ relevant source, contracts and tests
→ exact-head Evidence and independent Review
→ merge → new-main readback → cleanup → replan
```

`main` 是唯一正式产品事实。Branch、Issue、PR body、聊天、计划、Project 看板、审计报告、代码图和 Completion Report只提供导航、候选、决策或 Evidence。它们不能证明结果已进入主干，也不能覆盖当前代码和真实 Gate。

Resolver 无法确定 default ref、target repository/workspace、active pointer、manifest bytes/digest、PR base/head、review/CI 或 authority owner时 fail closed。

## 记录分层

- **Canonical domain docs/code**：长期 Goal、稳定架构、公共合同和机器规则。
- **GitHub Issue**：真实问题、决策、依赖、验收、竞争方案和反证；不是运行日志。
- **Rolling plan**：当前包与接下来二至五个条件化候选；不是永久 backlog。
- **Work Package Manifest**：被激活任务的 frozen scope、authority、ownership、Gate 和退出合同。
- **Task Envelope**：一个执行者在 manifest 内的单角色、单 seam 授权。
- **Pull Request**：一个 exact candidate diff及其 Review 表面。
- **Checks/Artifacts/Evidence**：绑定 exact input/environment 的物理证明。
- **Development Run Journal（目标 owner）**：高频 epoch、failure、next transition 与恢复条件；未实现前由外部 Git/PR/manifest和明确 checkpoint重算。
- **GitHub Project**：Issue/PR的可视化投影。
- **`main`**：完成后的唯一产品结果。

动态 SHA、run、failure tail 和临时候选不复制进稳定 docs。超过一个小 PR 范围的工作应有 Issue；只有经过裁决且 Ready 的 Issue可以生成 formal manifest。

## A0 与 Worker

A0 独占：

- 最新事实、长期 Goal 和 rolling DAG 重算；
- active Work Package选择、候选失效与 proof reset；
- authority/resource/write-set 冲突裁决；
- Gate custody、independent Review、integration 和 merge order；
- new-main readback、Issue/PR收口、branch/worktree/workflow hygiene。

Worker 只在 frozen Task Envelope 和 owned seam内实现，不自授权跨 owner、扩大路径、降低 Verification、触发 hosted Gate或合并。Worker发现 root assumption、owner、scope或architecture不成立时停止并返回 Reconciliation Delta，不在局部代码继续堆例外。

一个 canonical type、state owner、public contract、writer、selector、active manifest和gate owner保持单写者。

## Work Package

Manifest 冻结：

- base/default-ref constraints；
- authority reads/writes 与 owner；
- owned/permitted/forbidden paths；
- global exclusive resources和physical capabilities；
- dependencies、conflicts、ordered relations；
- acceptance、tests、profile和Evidence；
- completion、migration、readback和cleanup。

Pointer 只保存 manifest path、raw blob digest和选择模式。Pointer、branch、PR或candidate存在都不是执行/合并授权。

完成必须区分：设计 authority冻结、实现提交、candidate frozen、exact-head验证、进入 `main`、new-main readback/清理、用户可观察能力现实闭合。

## 并行工作

当前默认：一个 formal active Work Package。只读 research、census和Evidence发现可以并行，但不能同时写 canonical owner、`docs/work/**`、package/lock、workflow、Skill registry或同一 state/artifact。

目标并行 resolver 只有机器证明以下全部成立后才允许同一 Integration Epoch 内多个正式包：

- authority write-set、canonical types和writer不重叠；
- owned/forbidden paths兼容；
- producer/consumer和migration顺序明确；
- state/artifact/global resource不冲突；
- package/lock、control plane、docs/work、AGENTS/Skill registry和workflow有唯一writer；
- 每包可独立验证、提交、回滚和失效；
- integration order和virtual-merge Evidence可确定重算。

关系只能是 `parallel-safe`、`ordered`、`write-conflict`、`resource-conflict` 或 `unresolved`；unknown/unresolved 不解释为安全。

在 resolver/Integration Queue真正进入 `main` 前，不得因为存在多个branch、Agent或Draft PR宣称并行合同已成立。并行产生的正式结果通过 ordered stacked successor或A0重建candidate收敛，不能机械合并所有分支。

## Branch 与 PR 生命周期

- `feat/*`：正式产品能力；
- `fix/*`：正式缺陷修复；
- `refactor/*`：不改变外部语义的结构重构；
- `docs/*` / `chore/*`：文档和工程维护；
- `spike/*`：大型未知探索，默认不合并；
- `validation/*` / `diagnostic/*`：验证、故障隔离和Evidence，默认不合并；
- `integration/*`：仅在两条真实、大型、并行产品线需要临时总装时使用。

Branch 是演进路线，不是等待机械合并的功能包。Squash merge 后按最终 tree、contracts和行为结果判断内容是否进入 `main`，不能仅用commit ancestry或ahead/behind判断遗漏。

Git branch承载代码演进；GitHub Actions/workflow_dispatch/matrix/job/artifact承载测试参数和Evidence。禁止长期创建一次性远端测试分支。

PR Ready只表示允许进入Review/Gate调度，不表示required Evidence已通过。Head/base/manifest/profile变化会使绑定旧identity的Review/Evidence失效。

## Skill 与确定性规则

Skill 是需要 Agent 判断的操作闭包：trigger、exclusions、inputs、authority、permission/path、tools、prerequisite gates、execution、completion Evidence、stop/reload/recovery和prohibited shortcuts。

Skill 不拥有产品字段、算法、schema、Gate实现、动态状态或第二事实源。可机器判断的规则进入 type、schema、parser、validator、test、Hook、runner或CI module。新增Skill前先证明现有Skill无法自然拥有该独立行为。

Repository orientation只建立当前任务的最小充分事实；用户要求全仓审计、重大架构变化或重复系统性缺陷时，使用 repository audit 对全部 tracked paths、authority、owner、entry、state和verification做 exact-revision census。

## Impact 与验证选择

修改公共contract、canonical authority、state owner、pipeline、runtime boundary或未知影响前，先使用已批准且可用的impact/consumer能力；不可用时降级到 exact imports、public API、runtime entry、owner和test-impact census。不得临时安装工具改变candidate环境。

开发中先运行当前 failing/focused sentinel；candidate稳定后运行最终 local closure；Frozen后由A0触发required hosted Gate。相同未失效 Gate identity复用；输入和failure fingerprint未变时不重复确定性失败。

验证选择必须从完整 changed scope、ownership、contract、physical capability和unknown frontier推导。无法证明不受影响不是“无需测试”。

## Failure、重试与 Proof Reset

Failure首先分类：root cause、owner、violated invariant、minimal reproduction、exact inputs、invalidated Evidence、cleanup state和unique next action。

环境瞬态只有在因果输入明确变化时受限重试。重复运行同一失败、扩大timeout、清缓存碰运气、删除断言或创建successor branch而不改变root input都不构成修复。

同一 Work Package重复出现同类 frozen invalidation时必须 proof reset：回到 reproduction、authority、state ownership、test architecture或scope重算。反复局部修复同类问题时检查共享抽象、协议、fixture、runner和CI门禁，而不是继续循环。

## 可验证续跑

上下文压缩、进程退出、会话/Agent/worktree切换后的目标是：只依赖外部权威状态，重新计算同一合法 next transition；不是恢复模型未外化的隐藏思维。

当前 Development Run Kernel 未实现时：

- 每次恢复重新读取 main、PR/Issue、manifest、branch/worktree、dirty state、CI/Review和failure Evidence；
- 未提交/未外化的“已经做过”视为未知；
- current task、last completed transition、next action和stop condition写入受控外部记录；
- identity或instruction fence不一致时停止，不猜测继续。

目标 Run Kernel 只拥有 run/capsule/event/transition和resume verification。Epoch/Failure、Verification Result、Evidence Journal和Integration Queue各由自己的domain owner拥有，禁止建立第二状态机。

## Merge 与收口

变化只有同时满足以下条件才进入 `main`：

1. 仍是有效产品能力、修复或必要维护；
2. `main`尚未包含其有效结果，且未被更新实现取代；
3. canonical authority、public contract、migration和architecture一致；
4. exact base/head/tree/manifest/profile清楚；
5. required CI/Evidence/independent Review通过；
6. 无unresolved thread、有效REQUEST_CHANGES、probe、临时日志入口或artifact drift；
7. merge order、conflict和consumer切换已理解。

满足时及时合并，不为表现“仍在开发”继续修改正确candidate。大型实验历史优先squash经过验证的最终状态。

Merge后确认产品结果真实进入新 `main`；关闭 absorbed、superseded、mirror、probe和diagnostic PR/Issue；归档 manifest；删除已完成使命且工具权限允许安全删除的branch/worktree/workflow；复核开放PR/Issue/CI，并重算rolling plan。工具不能物理删除时准确说明边界，不把“已审查/已关闭/内容已包含”说成“分支已删除”。
