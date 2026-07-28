---
title: Agent Skills 与 Development Run Kernel
status: active
last-reviewed: 2026-07-28
---

# Agent Skills 与 Development Run Kernel

本文只拥有两件事：**Agent 行为治理模型**和**Development Run Kernel 的设计边界**。仓库执行协议见 `docs/04-AI自主实现执行蓝图.md`，具体行为见 `.agents/skills/**`。

## 1. 三种知识不得混写

1. **确定性合同**：事实、类型、算法、身份、状态机、权限和验证条件，只能由代码、Schema、parser、validator、tests、Hooks、CI 或 frozen manifest 拥有。
2. **启发式行为**：Agent 必须判断何时触发、选择哪个 owner/Gate、怎样回退和何时停止，由唯一 Skill 拥有。
3. **审计 Evidence**：绑定 exact revision 的 path、finding、unknown 和优化候选，不自动成为产品或架构 authority。

Skill 是可执行投影，不是第二事实源。产品字段、版本、动态状态、Gate 实现和当前计划不得复制进 Skill。

## 2. AgentOperation 合同

每个 Skill 使用统一闭包：

```text
trigger → exclusions → inputs → permissions
→ tools → prerequisite gates → execution
→ completion evidence → stop/reload/recovery
→ prohibited shortcuts → authority
```

`platform/shared/agent-skill-contract.ts` 登记 Skill ID、repository behavior owner 和受限路径分类；`tests/contract/agent-skills.test.ts` 验证 inventory、标准结构和 coverage。未登记的 `docs/**/*.md` 不得通过宽泛 fallback 获得虚假 coverage。

新增规则先做分界：

```text
能否被机器确定？
├─ 能：交给代码/Schema/validator/test owner
└─ 不能：与现有 Skill 语义去重
          ├─ 已有闭包：扩展唯一 Skill
          └─ 独立闭包：新增 behavior + Skill
```

禁止按文件生成 Skill，也禁止用“包含某个关键词”冒充行为正确。字符串断言只能验证必要标记存在，不能替代机制、权限和状态转移测试。

## 3. 全仓库审计

`sec-repository-orientation` 只建立普通任务的最小充分 live facts；`sec-repository-audit` 才对 exact revision 的全部 tracked paths 执行：

- tree/blob census 与内容覆盖 ledger；
- authority、owner、entry、state、dependency 和 verification 对齐；
- Agent 行为候选抽取；
- 冲突、unknown、反证和优化候选；
- current/default identity 与 Work Package pointer/digest 检查。

搜索命中、README、PR body、单一代码图或 Provider 结果不能代替 tracked-tree census。审计 finding 进入正式修改前必须由对应 canonical owner 裁决并冻结独立 Work Package。

## 4. Markdown coverage 的真实含义

- `skill-definition`：Skill 本体。
- `agent-projection`：仅负责启动/路由的短投影。
- `active-authority`：稳定产品、架构或治理 owner。
- `frozen-work-package`：一次不可变授权闭包。
- `evidence`：exact-revision 结果。
- `historical`：archive/superpowers。
- `verification-fixture`：测试材料。
- `repository-content`：不拥有当前工程事实的普通内容。

Coverage 只证明路径被分类并能找到行为 owner，不证明文档内容正确。内容正确性仍需 canonical owner、语义审查和适用合同测试。产品 authority 可以映射相关 Skill，但 Skill 不因此拥有产品事实。

## 5. Development Run Kernel

目标是：压缩、进程退出、新会话或 worktree 切换后，新执行者只依赖外部权威状态，重新计算同一个合法 `nextTransition`；绑定不一致时 fail closed。它不恢复隐藏思维。

稳定身份：

```text
runId      任务运行身份
sessionId  一次模型/界面绑定
worktree   一个文件系统视图
```

计划状态位于 `<git-common-dir>/sec-codex/runs/<run-id>/`，采用不可变 capsule/event generation、repository fingerprint、phase、locks、recoveryRequired 和 deterministic transition。Project Hook 只是本地工作流防线，不是所有 hosted tools 的安全沙箱。

落地阶段：

```text
Repository Audit / Skill governance
→ Kernel Shadow
→ Hook Activation + compact/restart proof
→ 首个真实产品纵切片
→ telemetry 证明需要时再优化 edit feedback
```

在 Kernel Shadow、Hook Activation 和真实续跑验证进入 `main` 前，只能声明 manual-shadow 恢复，不能宣称上下文压缩问题已解决。
