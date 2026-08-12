---
name: sec-heuristic-governance
description: 用于任何 active authority、脚本、配置、Workflow、Agent投影或审计 finding 中出现新的 Agent 启发式行为时，区分确定性合同与行为选择，去重并编译到唯一 Skill；不用于把产品事实、算法或字段表复制成提示词。
---

# sec-heuristic-governance

## 触发
- 新增或修改“何时触发、选择哪个 owner/工具/Gate、怎样回退、何时停止”的 Agent 行为。
- `sec-repository-audit` 发现未覆盖、重复、冲突、宽泛 catch-all 或藏在注释/测试/脚本中的启发式约束。
- active 文档、AGENTS、Codex角色、Workflow、Hook、控制面或工具入口改变 Agent 的执行决策。
- 执行中发现可能重复的系统性缺陷、接受了新的计划裁决，或发现既有 Issue/current spec/rolling projection 相互漂移。

## 不触发
- 可由代码、Schema、类型、状态机、validator或测试完全确定的产品/验证合同。
- 只改文档排版、链接或历史/Evidence，不改变任何执行选择。

## 输入
- exact source path/section/line、行为语句、触发与排除条件、canonical authority、现有 Skill inventory、调用者/消费者和冲突证据。
- then-current main、已有 work identity/Issue/current spec、roadmap owner、active Work Package、rolling projection 与机器 lifecycle/readiness/conflict facts；聊天和模型记忆只能帮助定位，不能成为 durable input。

## 权限与路径
- 只修改 `.agents/skills/**`、`platform/shared/agent-skill-contract.ts`、Agent治理合同测试、必要的AGENTS/治理短投影和manifest声明路径。
- 不修改产品实现以迁就提示词，不把 Skill 变成第二产品事实源。

## 允许工具与操作
- repository audit行为候选、tracked-path/Markdown分类器、Skill inventory、authority registry、docs doctor、focused contract tests和精确文本去重。

## 前置门禁
- 行为来源、当前 authority、消费者和 exact revision已知。
- 已先判断该规则能否下沉为确定性代码合同；能下沉时必须交回对应产品/验证 owner，而不是新增 Skill。

## 执行
1. 以中英文显式指令和已登记 Agent surface 识别候选；测试名、断言样例和历史证据不作为新行为 authority。再将候选规则分类为确定性事实/算法/状态/验证，或需要 Agent 判断的启发式行为；两者不得混合。
2. 对任何准备长期保留的发现先做 identity/owner/current-spec census：查找已有 focused/Program Issue、roadmap capability、canonical domain owner、active/successor Work Package与superseding relation。命中已有 identity 时只更新或引用该 owner；只有确认没有现存 identity 且问题形成独立验收闭包时，才建立一个新的 focused work identity。
3. 区分“观察是否值得长期治理”的判断与“如何记录和选择”的机械动作。前者可由本 Skill 裁决；一旦接受为 durable finding，规范化 work identity、owner、current spec、dependency/disposition 和 next-work eligibility 必须交给对应 machine owner与 `WorkDecision`，不得继续留在提示词或聊天里。
4. GitHub comment/Review只是讨论或 Evidence。接受其中的执行裁决时，把它显式折叠进既有 Issue body或更强的canonical machine owner，并记录被替代来源；不读取所有评论后按最后时间猜 current spec。
5. 对启发式行为建立 trigger、exclusions、inputs、authority、owner、permissions、tools、prerequisite gates、execution、completion evidence、stop/reload/recovery与prohibited shortcuts。
6. 与现有 Skill 做语义去重：同一真正启发式行为只能有一个 Skill owner；确定性行为必须有 machine owner 且 Skill 为零，其他文档和角色只保留窄链接/投影。
7. 现有 Skill 自然容纳时扩展该 Skill；只有触发、权限、状态机、完成证据或停止条件形成独立闭包时才新增 Skill。
8. 更新 `SEC_AGENT_SKILL_IDS`、behavior route、受影响 candidate hints和focused test ownership；禁止恢复 behavior-to-Skill bijection，未知或仅靠默认 catch-all 的行为 fail closed。
9. 删除或改写测试注释、PR模板、脚本说明和active文档中的重复操作指令，使其引用 canonical authority/Skill，而不是保留错综第二套规则。
10. rolling plan只投影validated WorkDecision的当前包和二至五个候选。尚未切换machine projection时，A0必须把人工投影标成显式reconciliation并同步已有identity；发现冲突时返回reconcile，不能静默重排或新增第二backlog。
11. 消费 selector 给出的最小 Skill contract/audit/documentation closure；相同 ActionKey 不重复，trust-root candidate不得自证。

## 完成证据
- 每个候选行为的 path/line/text、deterministic-or-heuristic 分类、machine owner 或唯一 owner Skill、authority refs、消费者、删除/收窄的重复表面、coverage与focused tests。
- 每个被接受的系统性发现都有 durable workId、currentSpecRef、exact currentSpecRevision、canonical owner、dependency/disposition、验收/退出引用，以及同步后的selector/rolling投影或明确的reconcile/blocked receipt；聊天中没有唯一剩余副本。
- 全部活动启发式候选要么解析到唯一 Skill，要么被证明并迁移为确定性合同；无 orphan/catch-all-only行为。

## 停止与恢复
- 行为图无重复 owner、无冲突投影、无未覆盖候选，Skill与authority/代码合同一致。
- 新证据证明分类错误时回退到确定性/启发式分界重新裁决，不在旧 Skill 末尾追加例外。
- 当前 operation 没有 Issue、control projection或canonical owner写权限时，返回包含既有workId与目标owner的 Reconciliation Delta；不得声称已经同步，也不得借“自动固化”扩权外部写入。

## 禁止捷径
- 不按“一个文件一个 Skill”机械切分，不创建万能 Skill，不把所有文档全文搬入 Skill。
- 不让 Skill拥有产品字段、版本、算法、Gate实现或动态状态。
- 不用路径已有任意 Skill 映射来掩盖文件内新的独立行为。
- 不以新建 Issue/计划文档代替已有identity census，不把同一问题复制到roadmap、Issue、rolling plan和Work Package并让四者竞争authority。
- 不把“已在聊天分析”“已写rolling plan”或“已加入模型记忆”当成durable current-spec同步。

## 权威
- `docs/authority.json`
- `docs/development-governance.md`
- `platform/shared/agent-skill-contract.ts`
- `tests/contract/agent-skills.test.ts`
- `tests/contract/repository-audit.test.ts`
