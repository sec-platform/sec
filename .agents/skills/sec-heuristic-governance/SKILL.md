---
name: sec-heuristic-governance
description: 用于任何 active authority、脚本、配置、Workflow、Agent投影或审计 finding 中出现新的 Agent 启发式行为时，区分确定性合同与行为选择，去重并编译到唯一 Skill；不用于把产品事实、算法或字段表复制成提示词。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-heuristic-governance

## 触发
- 新增或修改“何时触发、选择哪个 owner/工具/Gate、怎样回退、何时停止”的 Agent 行为。
- `sec-repository-audit` 发现未覆盖、重复、冲突、宽泛 catch-all 或藏在注释/测试/脚本中的启发式约束。
- active 文档、AGENTS、Codex角色、Workflow、Hook、控制面或工具入口改变 Agent 的执行决策。

## 不触发
- 可由代码、Schema、类型、状态机、validator或测试完全确定的产品/验证合同。
- 只改文档排版、链接或历史/Evidence，不改变任何执行选择。

## 输入
- exact source path/section/line、行为语句、触发与排除条件、canonical authority、现有 Skill inventory、调用者/消费者和冲突证据。

## 权限与路径
- 只修改 `.agents/skills/**`、`platform/shared/agent-skill-contract.ts`、Agent治理合同测试、必要的AGENTS/治理短投影和manifest声明路径。
- 不修改产品实现以迁就提示词，不把 Skill 变成第二产品事实源。

## 允许工具与操作
- repository audit行为候选、tracked-path/Markdown分类器、Skill inventory、authority graph、docs doctor、focused contract tests和精确文本去重。

## 前置门禁
- 行为来源、当前 authority、消费者和 exact revision已知。
- 已先判断该规则能否下沉为确定性代码合同；能下沉时必须交回对应产品/验证 owner，而不是新增 Skill。

## 执行
1. 将候选规则分类为确定性事实/算法/状态/验证，或需要 Agent 判断的启发式行为；两者不得混合。
2. 对启发式行为建立 trigger、exclusions、inputs、authority、owner、permissions、tools、prerequisite gates、execution、completion evidence、stop/reload/recovery与prohibited shortcuts。
3. 与现有 Skill 做语义去重：同一行为只能有一个 canonical Skill owner；其他文档和角色只保留窄链接/投影。
4. 现有 Skill 自然容纳时扩展该 Skill；只有触发、权限、状态机、完成证据或停止条件形成独立闭包时才新增 Skill。
5. 更新 `SEC_AGENT_SKILL_IDS`、行为 owner registry、全部受影响 path coverage和focused test ownership；未知或仅靠默认 catch-all 的行为 fail closed。
6. 删除或改写测试注释、PR模板、脚本说明和active文档中的重复操作指令，使其引用 canonical authority/Skill，而不是保留错综第二套规则。
7. 运行 Skill合同、repository audit、docs doctor、test-impact和适用trust-root验证；trust-root candidate不得自证。

## 完成证据
- 每个候选行为的分类、唯一 owner Skill、authority refs、消费者、删除/收窄的重复表面、coverage与focused tests。
- 全部活动启发式候选要么解析到唯一 Skill，要么被证明并迁移为确定性合同；无 orphan/catch-all-only行为。

## 停止与恢复
- 行为图无重复 owner、无冲突投影、无未覆盖候选，Skill与authority/代码合同一致。
- 新证据证明分类错误时回退到确定性/启发式分界重新裁决，不在旧 Skill 末尾追加例外。

## 禁止捷径
- 不按“一个文件一个 Skill”机械切分，不创建万能 Skill，不把所有文档全文搬入 Skill。
- 不让 Skill拥有产品字段、版本、算法、Gate实现或动态状态；这些仍由canonical代码/文档/manifest/Evidence拥有。
- 不用路径已有任意 Skill 映射来掩盖文件内新的独立行为。

## 权威
- `docs/00-文档索引与一致性规则.md`
- `docs/governance/agent-skills-and-development-run-kernel.md`
- `platform/shared/agent-skill-contract.ts`
- `tests/contract/agent-skills.test.ts`
- `tests/contract/repository-audit.test.ts`
