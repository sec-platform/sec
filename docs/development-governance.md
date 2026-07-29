---
title: 自主开发治理
status: stable
domain: development-governance
last-reviewed: 2026-07-29
---

# 自主开发治理

本文拥有仓库开发的事实源、A0/Worker角色、Issue/Work Package/PR/Evidence分层、Skill和可验证续跑边界。具体启发式行为闭包只存在于`.agents/skills/**`；机器可判断的规则必须下沉到代码合同。

## 事实与授权

```text
latest main + GitHub facts
→ docs/authority.json
→ AGENTS.md router
→ trusted repository orientation
→ selected frozen Work Package
→ Task Envelope / owned seam
→ relevant code/tests
→ exact-head Evidence
→ merge + main readback
```

`main`是正式工程事实；branch、Issue、PR body、聊天、计划、审计报告和Project看板只提供线索、计划或Evidence。Resolver无法确定default ref、target workspace、pointer、manifest或GitHub facts时fail closed。

## 记录分层

- Canonical文档：长期Goal、产品/架构合同与稳定路线。
- GitHub Issue：真实问题、决策、依赖、验收与讨论。
- Work Package Manifest：被激活任务的机器执行合同。
- Pull Request：一个exact candidate diff。
- Checks/Artifact/Evidence：物理证明。
- Development Run Journal：高频epoch、failure、next action与恢复状态。
- GitHub Project：Issue/PR投影，不是事实源。
- `main`：完成后的唯一产品结果。

超过一个小PR范围的工作应有Issue；只有Ready且被选择的Issue生成Manifest。动态SHA/run/blocker不长期复制进Issue或稳定文档。

## 角色

A0拥有：

- 最新事实重算与rolling DAG；
- Work Package选择和authority/resource冲突；
- Gate custody、Review、integration与merge order；
- main readback、Issue/PR收口、branch/worktree hygiene。

Worker只在frozen seam内实现，不自授权跨owner、触发hosted Gate或merge。一个canonical type、state owner、public contract、writer和active package保持单写者。

## Work Package

Manifest冻结：

- base constraint；
- authority reads/writes；
- owned/permitted/forbidden paths；
- global exclusive resources；
- dependencies/conflicts；
- acceptance/tests/profile；
- completion/cleanup。

Pointer只保存manifest path与raw blob digest。Candidate不是授权。完成必须区分设计冻结、实现提交、exact-head验证、进入main、readback/清理和现实能力闭合。

## 多Work Package与Integration Queue

默认仍为一个formal active Work Package。只有机器resolver证明以下全部成立，才允许同一Integration Epoch内并行：

- authority write-set不重叠；
- owned/forbidden paths兼容；
- contract producer/consumer有明确顺序；
- state/artifact/global resource不冲突；
- package/lock、docs/work、AGENTS/Skill registry、workflow等全局表面有唯一writer；
- 每个包可独立验证、提交和回滚。

关系只能是parallel-safe、ordered、write-conflict、resource-conflict或unresolved；unresolved不解释为安全。

每个会话绑定一个Issue、Manifest、Worktree、branch、authority seam和Draft PR。Integration Queue按最新main构造virtual merge candidate；每次merge后重算剩余候选，只重跑被真实delta失效的验证。

## Branch生命周期

- `feat/*`：正式能力。
- `fix/*`：正式缺陷。
- `refactor/*`：不改变外部语义。
- `docs/*` / `chore/*`：文档和工程维护。
- `spike/*`：未知架构探索，默认不合并。
- `validation/*` / `diagnostic/*`：Evidence和故障隔离，默认不合并。
- `integration/*`：仅在两条真实大型产品线需要临时总装时使用。

Git branch承载代码演进；GitHub Actions承载测试参数和Evidence。禁止用大量远端分支代替matrix/workflow_dispatch/artifact。

## Skill

Skill是trigger、non-trigger、input、权限、工具、前置门禁、执行、完成Evidence、停止/恢复和禁止捷径的可执行投影。Skill不拥有产品字段、Gate实现、动态状态或第二事实源。

需要Agent判断的启发式行为必须由唯一Skill owner覆盖；可机器确定的规则进入类型、Schema、parser、validator、test、Hook或CI。新增Skill前先证明现有Skill无法自然拥有该行为。

## 影响与验证

修改共享类型、authority seam或未知影响前，优先使用capability ledger/Capsule已批准且可调用的impact能力；不可用时降级到exact imports、consumer与test-impact census，禁止临时安装工具。

开发中只运行focused sentinel；candidate稳定后才运行typecheck/docs/affected；Frozen后由A0触发required Quick/Risk/Full。相同未失效Gate identity复用；输入与failure tail未变时不重复确定性失败。

## Failure与Proof Reset

Failure首先分类root cause、owner、invariant、minimal reproduction、invalidated Evidence和unique next action。环境瞬态只有因果输入发生明确变化时可受限重试。

同一Work Package第二次同根因Frozen invalidation返回`STOP_PROOF_RESET`；再次出现进入`BLOCKED_REDESIGN_REQUIRED`。重复问题必须检查共享抽象、合同、状态所有权、fixture和CI门禁，禁止循环局部补丁。

## 可验证续跑

上下文压缩、进程退出或worktree切换后的目标是从外部权威状态重算同一合法next transition，不恢复隐藏思维。

Development Run Kernel未进入`main`前，只能声明manual-shadow恢复。未来Kernel只拥有run/capsule/event/transition；Epoch/Failure、Verification Result、Run Journal和Integration Queue分别由其唯一owner拥有，禁止第二状态机。

## Merge与收口

只有能力仍有效、main尚未包含、未被更新实现取代、架构一致、required CI/Review通过、无unresolved thread/REQUEST_CHANGES、base/head关系清楚且无probe/artifact drift时合并。

大型integration历史优先squash最终状态。合并后确认产品结果真实进入main，关闭废弃/镜像/probe PR，清理临时branch/worktree/workflow，复核开放PR/Issue/CI，并重算rolling plan。工具不能删除物理分支时准确报告边界，不把“已审查”说成“已删除”。
