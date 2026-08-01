---
name: sec-govern-agent-system
description: 对 SEC universal instructions、Agent Roles、operation envelopes、Skills、permissions、routing、hooks和行为覆盖进行分层治理，决定规则下沉、Skill合并/拆分/退役与trust migration；不拥有产品算法或动态运行状态。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: govern-agent-system
  sec-risk: trust-root-write
---

# sec-govern-agent-system

## 目标

保持 Agent 系统中每项责任只有一个正确层级和owner：universal policy、Role、operation、Skill、deterministic contract、tool/provider或dynamic state。该Skill不以“增加更多提示词”为目标，而是持续消除重复prose owner并把可机器判断规则下沉。

## 触发

- 新增/修改Agent的触发、排除、路由、权限、工具、失败升级、停止、恢复或合并行为。
- AGENTS、Role profile、Skill、Hook、Workflow、agent config、control script或审计finding包含新的执行选择。
- 多个Skill竞争同一operation，或一个Skill混合角色、状态机和领域流程。
- 当前Skill inventory、coverage、routing或permission tests发生变化。

## 不触发

- 可完全由现有type/schema/validator/test执行的产品或验证规则，且不改变Agent选择。
- 只修改普通Skill正文的措辞/链接，不改变任何行为。
- 产品架构、dependency或external capability本身需要治理：转对应Skill。

## 必需输入

- operation envelope与trust-root write grant；
- exact Agent surfaces census：AGENTS、roles、Skills、contracts、Hooks、workflows、scripts、tests；
- 候选行为的path/line/text、trigger、consumer和现有owner；
- historical task replay与routing/permission failures；
- current role/operation/skill/transition registry；
- Host对Skill/agent/tool权限的真实能力边界。

## 权限边界

- 读取研究可用`read-only`；正式变化属于`trust-root-write`。
- 只写envelope授权的Agent system registry、Role/Skill definitions、routing/permission contracts、tests和窄投影。
- 不修改产品实现来迁就提示词，不修改current run state，不自行授予Shell/MCP/GitHub/network权限。
- 候选不能用新registry/validator自证，最终必须走`integrate-trust-migration`。

## 执行

1. 对每条候选规则先分类：universal invariant、role responsibility、operation workflow、reusable heuristic Skill、deterministic contract、tool/provider capability或dynamic run state。
2. 机器可判断的path、state、permission、transition、retry、Gate selection、Evidence reuse和identity规则下沉到type/schema/validator/Hook/CI；不得保留prose副本作为第二控制流。
3. Role只定义职责、信任关系和可申请权限上限；不复制工作流。Skill只定义一个operation的启发式闭包；不复制Role权限或dynamic phase。
4. 执行语义去重：同一operation只能有一个Primary Skill；共享约束通过typed inputs/services连接，不用多Skill overlay。
5. 评估Skill是否独立：trigger、required inputs、permission class、outputs、legal transitions和failure escalation是否形成自然闭包。不能则合并为mode或下沉为service。
6. 更新registry、Role/operation/Skill映射、transition table、permission intersections、surface coverage和negative tests。未知behavior不得靠catch-all获得owner。
7. Skill正文采用渐进披露：frontmatter精确发现，主文件保持工作流闭包，详细schema/examples/scripts按需加载；不复制canonical code和易变版本。
8. 对subagent显式绑定Role、Primary Skill、Envelope和capabilities；不假定继承父Agent上下文、Skill或权限。
9. 运行historical replay：orientation、failure、design、worker、Review、trust migration、merge closeout、docs/toolchain/provider治理；验证route唯一和非法transition fail closed。
10. 生成旧→新migration、compat projection、deprecation和removal顺序。trust epoch切换后要求restart/readback。

## 输出合同

```yaml
schema: sec-agent-system-governance-delta-v2
classifiedRules:
  - source:
    text:
    classification: universal | role | skill | deterministic | tool | state
    owner:
roleChanges: []
operationChanges: []
skillChanges: []
deterministicContractChanges: []
permissionChanges: []
transitionChanges: []
removedDuplicateSurfaces: []
coverageChanges: []
historicalReplayResults: []
negativeTestResults: []
compatibilityMigration:
trustRootChanged: true
nextOperation: review-change | integrate-trust-migration | design-change | no-change
outcome: completed | blocked | design-required | no-change
```

## 失败与转移

- 规则实际是产品/验证算法 →交回对应deterministic owner，不新增Skill。
- 无法唯一定位层级/owner → `design-change`。
- route冲突或permission扩大 → blocked，必须先修registry/contract。
- candidate通过独立Review和base-side tests → `integrate-trust-migration`。
- trust迁移成功 → `restart-required`，新session从orientation重新加载。

## 示例

“输入与failure tail不变不得重跑”应由failure/retry contract拥有；diagnose Skill只解释classifier结果，worker/CI不再复制同一句规则。

“A0负责merge、Worker不得merge”首先是Role/permission policy；integrate Skill定义merge workflow，但不能给Worker禁权或给自己授权。

## 资源

- `../../registry.yaml`
- `../../README.md`
- Agent surfaces census、historical replay、permission evaluator、transition validator
- current `platform/shared/agent-skill-contract.ts` and contract tests as migration evidence

## 禁止

- 不按文件、角色或每条命令机械创建Skill。
- 不创建万能Skill或多个Primary Skill组合。
- 不让Skill拥有产品字段、动态状态、Gate算法、版本或权限grant。
- 不用path coverage掩盖文件内部语义重复。
- 不由候选自身新增的Agent规则授权或验证候选。
