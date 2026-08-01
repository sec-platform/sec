# Agent Skill System v2 正式迁移计划

## 一、迁移原则

本迁移改变 Agent governance trust root，不能由候选新增的 Role/Skill/router/permission/validator 自证。正式迁移必须从执行时最新 `main` 重建，不得直接合并本 Spike branch。

迁移单位不是“替换 17 个 Markdown 文件”，而是同时切换：

```text
universal instructions
+ role profiles
+ operation/Skill registry
+ envelope and outcome schemas
+ permission evaluator
+ transition validator
+ surface coverage
+ test-impact / Risk ownership
+ historical replay
+ trust bootstrap
```

任何只替换 Skill 文本而保留旧一对一行为合同的方案都不算 V2。

## 二、当前→目标对象映射

### 2.1 Universal instructions

当前 `AGENTS.md` 中保留：

- latest main/live facts优先；
- resolver/authority fail closed；
- envelope owned/forbidden boundary；
- Worker不自授权，Reviewer独立，Integrator保管Gate/merge；
- squash后按tree/behavior readback；
- failure先找owner/invariant；
- machine-observable rules下沉。

迁出：

- 具体 Skill 名称和调用细节；
- 角色完整工作流；
- resume、proof reset、Gate dispatch、merge步骤；
- 领域治理操作细节。

### 2.2 Roles

新增或重建 Agent profiles：

```text
sec-integrator
sec-worker
sec-reviewer
sec-auditor
sec-maintainer
```

每个profile明确：purpose、trust relationship、maximum permissions、可用Skills、禁止动作和independence要求。删除旧Skill中重复的“A0/Worker/Reviewer不得做什么”，改由Role/permission tests拒绝。

### 2.3 Operations and Skills

安装11个V2 Skills，operation→Primary Skill映射由`registry.yaml`派生。旧Skill先进入compatibility projection，再删除。

### 2.4 Deterministic services

正式cutover前至少建立以下V2最小合同：

- `SecAgentRoleV2`
- `SecAgentOperationEnvelopeV2`
- `SecAgentOperationOutcomeV2`
- `SecAgentSkillDescriptorV2`
- `SecAgentTransitionV2`
- `SecAgentPermissionDecisionV2`
- registry parser/validator
- exactly-one-primary-skill resolver
- transition validator
- Role ∩ Envelope ∩ repository policy ∩ provider permission evaluator

Impact、Verification、Failure和Integration仍引用其现有或后继owner，不复制新算法到Agent contract。

## 三、旧 Skill 逐项迁移

### sec-a0-integrator

- `latest facts / next transition` → `sec-orient-work`。
- `architecture and package decomposition` → `sec-design-change`。
- `Gate/merge/closeout` → `sec-integrate-change`。
- A0 identity/permission → `sec-integrator` Role。
- 删除Skill本体，不保留兼容转发超过一个trust epoch。

### sec-architecture-evolution

- 迁入`sec-design-change`。
- 保留authority-first、first principles、competition/counterevidence、migration/retirement和implementation split。
- 通用“repository orientation已完成”改为typed required input，不再重复步骤。

### sec-ci-and-merge

- 迁入`sec-integrate-change` normal mode。
- dispatch payload、merge preconditions、Gate identity由机器contract/reference拥有。
- Skill只解释integration order、blocker和closeout，不复制字段表。

### sec-context-resume

- 迁入`sec-orient-work` resume mode。
- runId/capsule/event/lock priority由Run Kernel/Journal owner拥有；Kernel未实现时只接受外部checkpoint并重算。
- 删除第二snapshot和phase prose owner。

### sec-documentation-governance

- 迁入`sec-govern-documentation`。
- 保留registry-first、single ownership、lifecycle、archive和docs doctor闭包。
- 产品机制变化必须输出design-required。

### sec-exact-head-review

- 迁入`sec-review-change`。
- Review state/thread identity继续由GitHub/Review contract拥有。
- Reviewer权限由Role policy拥有。

### sec-external-capability-governance

- 迁入`sec-govern-capability`。
- capability ledger、Provider boundary、permission/data/security、retirement保留。
- package/lock写动作转后继toolchain operation。

### sec-failure-recovery

- 根因、competition、sibling census和next operation迁入`sec-diagnose-failure`。
- fingerprint、occurrence、retry、proof reset、Evidence invalidation下沉到failure/epoch services。
- Skill不再硬编码“第二次/第三次”状态转换。

### sec-heuristic-governance

- 迁入`sec-govern-agent-system`。
- 扩展分类轴：universal、role、operation/skill、deterministic、tool、state。
- 取消“一行为一Skill、一Skill一行为”的数量等式；保留每个operation唯一Primary Skill。

### sec-impact-and-validation

- 退役Skill。
- changed records、owner、selection、applicability、Gate identity/reuse和Risk由Change Closure/Impact/Verification services拥有。
- implement/review/integrate只消费typed plan/result。

### sec-repository-audit

- 迁入`sec-audit-repository`。
- 保留exact raw tree、all tracked paths、unknown ledger、finding Evidence和不直接巨型修复。

### sec-repository-orientation

- 迁入`sec-orient-work`。
- trusted resolver和intended target分离保留。
- route由work selector/transition validator输出，不在Skill维护backlog规则。

### sec-task-delegation

- 退役Skill。
- Agent spawn/role/independence/skill list/permissions由orchestration和Role Profile拥有。
- 子Agent显式绑定Operation Envelope，不继承父Agent Skill/permissions。

### sec-toolchain-and-dependencies

- 迁入`sec-govern-toolchain`。
- 保留唯一package/lock writer、consumer census、physical compatibility、clean package和retirement。

### sec-trust-root-bootstrap

- 迁入`sec-integrate-change` trust-migration mode。
- old-trusted/base-side verification、manual bootstrap、new-main trust digest和restart保留。
- 删除平行integration状态机。

### sec-work-package-lifecycle

- 退役Skill。
- manifest schema/path/digest、pointer和integration epoch由deterministic services拥有。
- 新package设计/冻结由design output消费，归档/readback由integrate closeout执行。

### sec-worker-development

- 迁入`sec-implement-change`。
- 保留owned seam、focused-first、local closure、no hosted Gate/no merge和Reconciliation Delta。
- scope/Impact/permission由typed envelope和services决定。

## 四、建议正式文件布局

```text
AGENTS.md
.agents/
  roles/
    sec-integrator.md
    sec-worker.md
    sec-reviewer.md
    sec-auditor.md
    sec-maintainer.md
  skills/
    <11 skills>/SKILL.md
    <skill>/references/*.md
    <skill>/scripts/*       # 仅确定性、可独立测试的辅助脚本
platform/shared/
  agent-role-contract.ts
  agent-operation-contract.ts
  agent-skill-contract-v2.ts
  agent-permission-contract.ts
  agent-transition-contract.ts
scripts/codex/
  agent-operation-resolver.ts
tests/contract/
  agent-operation-contract.test.ts
  agent-skill-system-v2.test.ts
  agent-permission-contract.test.ts
  agent-transition-contract.test.ts
tests/fixtures/agent-skill-system-v2/
  historical-replay/*.yaml
```

是否使用`.agents/roles`或Host规定的custom agent目录，必须在正式WP启动时按实际Codex/GitHub Agent能力冻结；本Proposal不把路径选择当永久理论。

## 五、正式实施 Work Packages

### WP-A — V2 Pure Contracts

写集：新增V2 types/parsers/validators/tests，不修改现有Skill runtime。

退出：

- registry exact parse；
- role/operation/skill referential integrity；
- exactly-one-primary；
- transition legality；
- permission intersection；
- evaluation corpus纯函数通过；
- no current behavior cutover。

此包若只新增pure contract且不触及现有trust selection，可按真实impact裁决普通或trust-root；不能预设。

### WP-B — Role Profiles + Compatibility Projection

写集：Role profiles、V2 Skill prototypes、旧→新router projection、tests；旧17仍存在但不得获得V2双owner。

退出：

- historical tasks在旧/新route parity下结果一致或有明确改进裁决；
- subagent不继承权限；
- Role和Skill分离；
- current runtime可回退旧系统。

这是Agent governance trust-root变化，必须base-side Review/Gate。

### WP-C — Cutover and Retirement

写集：AGENTS、current Skill inventory、agent-skill contract、coverage、test-impact、docs governance、旧Skill删除。

退出：

- 11个正式Skill成为唯一runtime inventory；
- 旧17全部删除，无兼容转发；
-所有active heuristic surfaces解析到operation/Role/Skill或deterministic owner；
- route/permission/transition negative tests通过；
- exact-head independent Review、trusted bootstrap、new-main readback；
- `TASK_RESTART_REQUIRED`。

### WP-D — Run Kernel / Task Capsule Integration

前置：#205/#177/#179对应contracts准备好。

退出：

- operation envelope由trusted Kernel/selector签发；
- outcomes驱动合法next operation；
- resume由Journal重签orient operation；
- Skill不再读取/维护内部phase；
-同一exact external facts得到byte-stable next operation。

## 六、迁移验证

### Pure contract

- duplicate Skill/operation/Role IDs；
- missing references；
- multiple/no Primary Skill；
- illegal transition；
- Role/Envelope/Skill capability mismatch；
- trust-root operation缺base-side proof；
- subagent inheritance attempt；
- unknown fields/schema version。

### Historical replay

至少回放：

- active PR继续开发；
- PR合并后的manifest/Issue/branch收口；
- skipped→passed假绿；
- affected empty selection；
- Windows process/lease failure；
- repeated aggregate defect；
- docs authority migration；
- dependency/provider cleanup；
- Spike关闭不合并；
- trust-root manual bootstrap；
- squash ancestry与tree readback差异。

### Adversarial permission

- Worker请求merge/dispatch；
- Reviewer请求candidate write；
- Auditor将finding直接变成fix；
- Skill要求Host未授予的Shell/MCP/network；
- external provider尝试改authority；
- governance operation跨domain写；
- candidate使用自身permission evaluator自证。

### Context cost

记录普通orient、leaf implement、review、integration和governance operation实际加载：

- frontmatter tokens；
- Primary Skill正文tokens；
- references按需tokens；
-重复状态/权限/Gate prose tokens。

V2必须减少重复加载，但正确性优先；不能以删除必要边界换取数字。

## 七、Rollback

正式cutover前保留一个release-tagged旧runtime snapshot，但不长期双写。

- WP-A/B失败：删除V2 additive surfaces，旧runtime不受影响。
- WP-C合并前失败：候选不进入main。
- WP-C合并后发现P0：按new-main事实创建聚焦revert candidate，恢复旧inventory/contract的完整tree；不得只恢复部分Skill。
- rollback后所有V2 Evidence失效并`TASK_RESTART_REQUIRED`。

## 八、完成裁决

只有以下事实同时成立，才能宣称Skill System v2现实完成：

1. contracts和11个Skill进入main；
2. Role/permission/transition由机器合同拒绝；
3. 旧17和一对一behavior等式已退役；
4. historical replay和negative tests通过；
5. independent Review和trust migration完成；
6. new-main readback证明运行入口实际使用V2；
7. 旧session重启，不依赖聊天解释新规则。

Proposal、prototype、Issue、PR、branch或测试设计存在均不满足上述完成定义。
