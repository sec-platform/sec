---
name: sec-audit-repository
description: 当用户要求全面审计、重大架构变化前或重复系统缺陷指向共享根因时，对 exact revision 的全部 tracked tree、authority、owner、入口、状态与验证面做证据化 census；不直接形成巨型修复。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: audit-repository
  sec-risk: read-only
---

# sec-audit-repository

## 目标

对一个 exact clean Git tree 建立可反驳的 repository model，证明哪些表面已检查、哪些 finding 有机制证据、哪些 unknown 仍阻断结论。审计是 Evidence 生产 operation，不拥有产品修复、Work Package选择或当前状态。

## 触发

- 用户明确要求全仓、全部、极致、系统性审计与优化。
- 重大 canonical architecture / public contract 变化前需要确认 owner、consumer 和迁移面。
- 同一失败类别重复出现，局部修复解释力不足。
- authority、代码、测试、CI、配置或实际产物互相冲突。

## 不触发

- 仅需建立当前任务最小事实：使用 `sec-orient-work`。
- 已由 machine closure 证明为单一叶节点缺陷。
- 只是 review 一个 exact candidate：使用 `sec-review-change`。

## 必需输入

- resolved context 与 exact clean head/tree；
- tracked tree/blob reader；
- authority registry、repository surface classifier、entry/consumer/ownership索引；
- live PR/Issue/CI/Review snapshot；
- 审计目标和允许读取的外部 Evidence。

任何 tracked path、submodule、generated authority或必要外部输入不可读取时必须登记 unknown。

## 权限边界

- 默认 `read-only`。
- 允许读取整个 exact tracked tree、Git/GitHub facts和已批准的外部只读 Evidence。
- 可输出独立 audit artifact/comment，但不得写 canonical authority、产品 source、控制面或当前 candidate。
- finding 不自动授予创建 branch/Issue/Work Package 的权限。

## 执行

1. 以 raw Git tree/blob冻结 exact输入；dirty checkout、index和ambient生成物不得混入。
2. 枚举全部 tracked paths，逐项分类为产品、验证、配置、authority/proposal/control、Skill/agent surface、Evidence/historical或普通内容；`unclassified` 保持显式。
3. 生成模块、入口、public contract、identity/revision、state/writer、lifecycle、dependency、error/recovery、publication和verification关系。
4. 对齐 canonical owner、实际实现、consumer、tests、workflow、PR/Issue和可观察产物。任何冲突追踪到唯一 owner，不预设文档或代码必然正确。
5. 主动搜索第二 writer/parser/selector/cache/state machine、隐式权限、循环依赖、孤儿入口、无消费者配置、动态事实泄漏、弱测试、错误成功投影和不可恢复边界。
6. 对每个候选 finding执行最强反证：反向因果、共同原因、测量缺口、历史路径和反例 corpus。
7. 产生 typed findings：exact path/symbol、owner、violated invariant、causal chain、sibling census、severity、Evidence、unknown、反转条件和推荐 next operation。
8. 用 machine transition router分流：启发式/Role/Skill问题→`govern-agent-system`；跨 owner机制→`design-change`；具体 failure→`diagnose-failure`；无问题→`no-change`。

## 输出合同

```yaml
schema: sec-repository-audit-evidence-v2
exactHead:
exactTree:
trackedPathCount:
coverage:
  classified:
  unclassified:
  unreadable:
owners: []
entries: []
stateWriters: []
findings:
  - id:
    severity:
    owner:
    invariant:
    evidenceRefs: []
    counterEvidence: []
    unknowns: []
    nextOperation:
unknownFrontier: []
recommendedTransitions: []
outcome: completed | unresolved | blocked | no-change
```

## 失败与转移

- exact tree 不可冻结或 tracked paths不完整 → `unresolved`，报告不能作为完成 Evidence。
- finding 缺 owner/invariant → `design-required` 或保持 unknown。
- 重复 failure有可复现对象 → `diagnose-failure`。
- 审计本身暴露工具/coverage缺陷 → `govern-agent-system` 或对应 deterministic owner。
- 审计不直接进入 `implement-change`，除非后续 design/selector 已签发独立 envelope。

## 示例

发现三个不同 runner均维护 Gate retry条件：finding owner是 failure/verification contract，推荐 `design-change`；不得在 audit branch 同时修改三个 runner。

发现一个未被任何入口引用的配置文件，但动态加载路径未知：标记 unknown，不直接删除。

## 资源

- `../../registry.yaml`
- `../../README.md`
- current repository audit contract and tracked-tree tools
- authority registry、test-impact、dependency/static-analysis Evidence

## 禁止

- 不以 `rg`、搜索摘要、README、单一代码图或抽样目录宣称全仓覆盖。
- 不把“未发现”自动解释为“不存在”。
- 不把所有 finding塞进一个实现包。
- 不将审计 artifact升格为 canonical architecture或current state。
- 不为了生成更多 finding而无限扩展到没有机制依据的臆测。
