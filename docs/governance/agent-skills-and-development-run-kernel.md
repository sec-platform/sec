---
title: Agent Skills 与 Development Run Kernel
status: active
last-reviewed: 2026-07-27
---

# Agent Skills 与 Development Run Kernel

## 1. 目标与分界

SEC 把自主开发知识分成三类：

1. **确定性事实、算法、结构、身份、状态机与验证合同**：由代码、canonical docs、manifest、Evidence 和 Kernel 拥有。
2. **启发式行为**：Agent 需要判断何时触发、选择哪个 owner/Gate、怎样回退和何时停止的流程，由唯一 Agent Skill 投影。
3. **审计发现**：绑定 exact revision 的路径、冲突、未知和优化候选，只是 Evidence；进入产品或架构前必须由 canonical owner 裁决。

Skill 不是第二事实源。它把多个 canonical owner 组合成一个可执行 `AgentOperation`；冲突时以代码合同、active authority、exact evidence 和正式 Work Package 为准。产品字段、算法、版本、动态状态和 Gate 实现不得复制进 Skill。

## 2. AgentOperation 最小闭包

每个正式 Skill 必须按固定顺序定义：

```text
trigger
exclusions
required inputs
path / permission boundary
allowed tools / semantic operations
prerequisite gates
execution
completion evidence
stop / reload / recovery
prohibited shortcuts
canonical authority
```

Skill 名称、目录、描述、标准章节、行为 owner 和覆盖范围由 `platform/shared/agent-skill-contract.ts` 与 `tests/contract/agent-skills.test.ts` 机器验证。

## 3. 行为清单与启发式抽取

`SEC_REPOSITORY_BEHAVIOR_IDS` 是当前仓库开发行为闭包的机器清单；`SEC_REPOSITORY_BEHAVIOR_OWNERS` 要求每个行为只有一个 Skill owner，并要求每个 Skill 至少拥有一个真实行为。新增或修改以下任一内容时，必须触发 `sec-heuristic-governance`：

- 何时执行或不执行；
- 选择哪个 owner、工具、Provider、Gate 或验证范围；
- 怎样处理失败、证据失效、权限冲突和恢复；
- 何时停止、重载、归档、合并或回退。

启发式抽取严格执行：

```text
候选规则
→ 判断能否下沉为代码/Schema/validator/测试
→ 能下沉：交给确定性 owner
→ 不能下沉：与现有 Skill 语义去重
→ 扩展唯一 Skill 或建立新的独立 AgentOperation
→ 删除 Markdown、注释、角色配置和脚本中的重复操作说明
→ 更新行为 owner / path coverage / focused tests
```

禁止按文件机械生成 Skill；禁止把每个数据结构、类型字段、命令或文档章节都变成 Skill。一个规则只有在 trigger、权限、状态转移、完成证据或停止条件构成独立闭包时，才有资格成为独立 Skill。

## 4. 全仓库审计

用户明确要求全面分析、重大架构演进前、同类缺陷重复出现或 authority/code/test/CI 冲突时，必须使用 `sec-repository-audit`，而不是扩大 `sec-repository-orientation`。

两者边界：

- `sec-repository-orientation`：建立当前任务的最小充分 live fact snapshot，普通任务禁止默认全仓扫描。
- `sec-repository-audit`：对 exact revision 的**全部 tracked paths**执行 census、行为候选抽取、authority/owner/entry/state/verification 对齐和对抗审计。

机器入口是：

```text
bun run audit:repository
```

报告 schema 为 `sec-repository-audit-v1`，至少包含 exact head/default identity、tracked-path与表面分类计数、活动 Markdown、行为候选、17 个行为 owner、finding、unknown 和优化候选。搜索命中、抽样目录、README、PR body、单一代码图或外部 Provider 不能代替 tracked-path census。

全仓库审计输出不自动修改产品，也不成为 active authority：

- Agent启发式缺口交给 `sec-heuristic-governance`；
- 跨 owner 的架构/合同缺口交给 `sec-architecture-evolution`；
- 已冻结的局部产品缺口由 A0 拆为独立 Work Package 后交给 Worker；
- unknown 保持显式，不能因“未发现”直接断言不存在。

## 5. 全仓库覆盖

仓库表面分为：

```text
skill-definition
agent-projection
heuristic-runtime
active-authority
frozen-work-package
evidence
historical
product-implementation
verification-test
configuration
repository-content
```

以下表面是已登记的启发式运行面，必须解析到至少一个 Skill：

- `.agents/skills/**`
- `.codex/agents/**`
- `.github/workflows/**`
- `.githooks/**`
- `scripts/codex/**`
- `docs/scripts/**`
- `platform/dev-runner.ts` 与 `platform/dev-runner/**`
- CI、Work Package Gate、Git Hook、toolchain、test-impact 和外部能力 ledger 入口

“已登记路径有 owner”只证明 registry coverage，不证明语义上没有隐藏行为。因此 `tests/contract/agent-skills.test.ts` 验证确定性 registry，`tests/contract/repository-audit.test.ts` 与 `scripts/codex/repository-audit.ts` 再扫描全部 tracked text surface 中的行为候选。新增入口若改变 Agent 的触发、选择、回退或停止，必须同时登记 behavior owner；不能依赖 catch-all 或默认文档 owner 掩盖。

其他产品源码可以是确定性实现，不要求复制为 Skill；产品内 AI Runtime 仍以 `09` 为权威。

## 6. 全 Markdown 覆盖

每个 tracked Markdown 必须被分类为：

- Skill 本体；
- `AGENTS.md` 等短投影；
- 活动 canonical authority；
- frozen Work Package；
- Evidence；
- historical/archive/superpowers；
- verification fixture 或普通 repository content。

活动 Markdown 若包含 Agent 的执行选择、验证取舍、分派、恢复、外部能力或文档维护规则，必须映射相应 Skill。文档只保留稳定职责、机制和权威链接；详细操作闭包进入唯一 Skill，动态状态进入 `docs/work/**`，历史和 exact-revision 结果进入 archive/Evidence。

## 7. 架构演进

修改 canonical authority、公共合同、identity/revision、状态所有权、pipeline、错误恢复或跨 owner 边界时，使用 `sec-architecture-evolution`。该 Skill 的硬顺序是：

```text
Goal与不可约约束
→ 当前机制/owner/consumer
→ 竞争方案与最强反证
→ 唯一canonical owner
→ authority first
→ public contract / invariants / negative tests
→ migration / retirement / rollback
→ 最小Work Package
→ 实现与main readback
```

它不代替 Worker：authority 和 contract 冻结后，普通实现回到 `sec-worker-development`。Spike 只产生 Evidence；成立后必须提炼为正式 feat/refactor/fix，不能把实验分支或局部示例直接当成架构完成。

## 8. V19 可验证确定性续跑

V19 的正式目标是：

> 自动/手动压缩、进程退出、新会话或 worktree 切换后，新执行者只依赖外部权威状态，重新计算出同一个合法 `nextTransition`；绑定不一致时 fail closed。

它不承诺恢复模型未外化的隐藏思维。

### 8.1 稳定身份

```text
runId       稳定任务运行身份
sessionId   一次模型/界面绑定
worktree    一个文件系统视图
```

运行状态位于 Git common directory：

```text
<git-common-dir>/sec-codex/runs/<run-id>/
```

### 8.2 状态提交

- prompt 在 `open` 前进入 repository-level intake spool；
- 每个状态事件提交不可变 capsule/event generation；
- `PreCompact` 只设置 `recoveryRequired`，不是唯一 checkpoint；
- resume 无条件重算 repository fingerprint、authority、Skill、Hook和Evidence identity；
- phase 与 `recoveryRequired`、pending prompt、instruction fence、proof reset 等锁正交。

### 8.3 Hook 边界

Project Hook 是工作流控制面和受覆盖本地工具防线，不是对全部 Codex hosted tools 的完整安全沙箱。真正修改工程事实的操作仍必须经过 Kernel、Git precondition 和 publication readback。

## 9. 分阶段落地

```text
当前 Repository Audit / Skill Extraction trust epoch
→ merge / TASK_RESTART_REQUIRED
→ WP-A Development Run Kernel Shadow
→ merge / TASK_RESTART_REQUIRED
→ WP-B Project Hook Activation + manual/auto compact proof
→ merge / TASK_RESTART_REQUIRED
→ 首个真实产品纵切片
→ telemetry证明需要时才做 WP-C edit-feedback thin mode
```

在 WP-B 和真实产品纵切片完成前，不得宣称压缩恢复与开发吞吐已经现实闭环。当前审计/Skill 系统只建立行为治理和可重复发现，不代表 Development Run Kernel 已实现。
