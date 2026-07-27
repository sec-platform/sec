---
title: Agent Skills 与 Development Run Kernel
status: active
last-reviewed: 2026-07-27
---

# Agent Skills 与 Development Run Kernel

## 1. 目标

SEC 把自主开发中的知识分成两类：

1. **确定性事实、算法、结构、身份、状态机与验证合同**：由代码、canonical docs、manifest、Evidence 和 Kernel 拥有。
2. **启发式行为**：Agent 需要判断何时触发、选择哪个 owner/Gate、怎样回退和何时停止的流程，必须由唯一 Agent Skill 投影。

Skill 不是第二事实源。它把多个 canonical owner 组合成一个可执行 `AgentOperation`，冲突时以代码合同和 active authority 为准。

## 2. AgentOperation 最小闭包

每个正式 Skill 必须定义：

```text
trigger
exclusions
required inputs
authority refs
owner discovery
allowed tools / semantic operations
path and authorization boundary
external fact requirements
prerequisite gates
prohibited shortcuts
completion evidence
stop / reload / recovery conditions
```

Skill 名称、目录、描述、标准章节、引用权威和覆盖范围由 `platform/shared/agent-skill-contract.ts` 与 `tests/contract/agent-skills.test.ts` 机器验证。

## 3. 全仓库覆盖

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
```

以下表面被视为启发式运行面，必须解析到至少一个 Skill：

- `.agents/skills/**`
- `.codex/agents/**`
- `.github/workflows/**`
- `.githooks/**`
- `scripts/codex/**`
- `docs/scripts/**`
- `platform/dev-runner.ts` 与 `platform/dev-runner/**`
- CI、Work Package Gate、Git Hook、toolchain和test-impact authority入口

其他产品源码可以是确定性实现，不要求机械复制为 Skill；但只要新增“由 Agent选择何时执行”的入口，就必须同时登记 Skill owner。

## 4. 全 Markdown 覆盖

每个 tracked Markdown 必须被分类：

- Skill 本体；
- `AGENTS.md` 等短投影；
- 活动 canonical authority；
- frozen Work Package；
- Evidence；
- historical/archive/superpowers。

活动 Markdown 若包含 Agent 的执行选择、验证取舍、分派、恢复、外部能力或文档维护规则，必须映射至少一个 Skill。历史和 Evidence 不参与当前决策，不需要生成活跃 Skill。

## 5. V19 可验证确定性续跑

V19 的正式目标是：

> 自动/手动压缩、进程退出、新会话或 worktree 切换后，新执行者只依赖外部权威状态，重新计算出同一个合法 `nextTransition`；绑定不一致时 fail closed。

它不承诺恢复模型未外化的隐藏思维。

### 5.1 稳定身份

```text
runId       稳定任务运行身份
sessionId   一次模型/界面绑定
worktree    一个文件系统视图
```

运行状态位于 Git common directory：

```text
<git-common-dir>/sec-codex/runs/<run-id>/
```

### 5.2 状态提交

- prompt在 `open` 前进入 repository-level intake spool；
- 每个状态事件提交不可变 capsule/event generation；
- `PreCompact` 只设置 `recoveryRequired`，不是唯一 checkpoint；
- resume无条件重算 repository fingerprint、authority、Skill、Hook和Evidence identity；
- phase 与 `recoveryRequired`、pending prompt、instruction fence、proof reset等锁正交。

### 5.3 Hook 边界

Project Hook 是工作流控制面和受覆盖本地工具防线，不是对全部 Codex hosted tools 的完整安全沙箱。真正修改工程事实的操作仍必须经过 Kernel、Git precondition和publication readback。

## 6. 分阶段落地

```text
WP-A Development Run Kernel Shadow
→ merge / TASK_RESTART_REQUIRED
→ WP-B Project Hook Activation + manual/auto compact proof
→ merge / TASK_RESTART_REQUIRED
→ 首个真实产品纵切片
→ telemetry证明需要时才做 WP-C edit-feedback thin mode
```

在 WP-B 和真实产品纵切片完成前，不得宣称压缩恢复与开发吞吐已经现实闭环。
