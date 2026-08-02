---
title: Canonical Architecture Migration and Retirement
status: proposal
domain: proposal
tracking: issue-232
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
authority: none
---

# Canonical Architecture Migration and Retirement

## 1. 原则

本方案只解决一件事：让每项已裁决设计最终只存在于一个 canonical owner 中，并让旧 Spike、proposal、Issue 失去并列“最终设计”身份。

迁移不是复制整篇设计。每项 decision 必须经历：

```text
identify independent decision
→ verify current owner and current main
→ adopt | adapt | reject | defer | experimental
→ write focused canonical delta
→ add machine contract or explicit prose-only boundary
→ migrate consumers
→ invalidate superseded revisions
→ archive/delete old active proposal surface
→ new-main readback
```

任何 canonical delta 都不得顺便修改无关产品代码、workflow、package/lock、active control plane 或多个领域 owner。

## 2. 新 Assembly 的权威边界

正式 Phase B 只新增：

- `docs/architecture-assembly.md`：跨域地图、共享协议、依赖与裁决索引；
- `docs/governance/architecture-assembly.yaml`：机器关系与 decision target；
- `docs/authority.json` 注册；
- relationship / duplicate-owner / missing-target / circular-authority tests。

Assembly 不能复制：

- Verification 状态算法；
- Type/Effect具体字段；
- Mutation状态机；
- Agent transition；
-动态支持矩阵；
- 当前 SHA、PR、Gate或Work Package；
- 每个领域的完整 schema。

Assembly 只引用 canonical document ID、machine owner ID、input/output contract和decision ID。

## 3. PR #226 全球架构 Spike 的处理

### 吸收

- 产品定义和永久边界 → `docs/product.md`；
- 极小 Federation Kernel、四平面、跨域引用 → `docs/system-architecture.md` + shared machine contract；
- Source Program 分层 → 新 focused source-program authority / `docs/brownfield-import.md`；
- Responsibility → `docs/semantic-model.md` 或 focused authority；
- Type/Behavior/Query/translation validation → `docs/compiler-target-ir.md`；
- Effect/Resource/Capability → 新 focused shared algebra authority；
- Condition/Freshness → shared condition contract；
- Compatibility/Support Claim → `docs/change-management.md`、`docs/runtime-and-distribution.md`、`docs/verification-governance.md`；
- publication/durability → `docs/semantic-mutation.md` + runtime physical contract；
- Verification object decomposition → `docs/verification-governance.md` 和 Issue #215 successors；
- specialized platform pattern → Provider/Target authorities。

### 不吸收

- 原 proposal 的完整九文件结构；
- 110-source ledger 作为产品 authority；
- exact source数量或“全球覆盖完成”声明；
- 一个 machine assembly 直接重定义已有 authority；
- 推测性的 package布局、具体工具或未来域作为当前支持承诺。

### 保留方式

全球来源 ledger 可以归档为 research Evidence，并由来源 freshness策略维护；它只能支持 decision rationale，不能成为 runtime依赖或 canonical architecture owner。

### 退役条件

- 40项原始decision全部映射到本 ledger 或后继 canonical decision；
-被采纳部分进入唯一 owner；
- deferred/experimental具有trigger；
- closed PR #226与Issue #225被标记为 absorbed research；
- proposal文件若保留，只能在 archive/evidence classification下被检索。

## 4. PR #229 Agent Skill V2 Spike 的处理

### 采纳

- Role、Operation、Primary Skill 分层；
- typed Operation Envelope；
-最小权限交集；
- exactly one Primary Skill per operation；
- typed outcome与合法后继；
- deterministic service从Skill prose移出；
- trust-root change使用独立integration模式。

### 调整

- `11`个Skill不是architecture invariant，只是当前prototype；
- A0/Worker/Reviewer/Auditor/Maintainer名称不是永久公共API；
- Operation lifecycle不建立第二Development Run state machine；
- permission evaluator、transition registry和Run State必须消费各领域唯一owner；
- Skill frontmatter只负责发现和路由，不授予工具权限。

### 正式迁移顺序

```text
pure role / operation / permission / transition contracts
→ compatibility projection from current 17 Skills
→ historical routing and negative evaluation
→ trusted bootstrap candidate
→ switch router and consumers
→ remove duplicated lifecycle prose
→ retire old Skill files only after parity
```

### 退役条件

- 当前17个Skill的每项独立责任都有新owner；
-历史/负面场景通过；
-不存在两个Primary Skill匹配同一operation；
-权限无法由Skill扩大；
-旧Skill consumer、tests和文档一起迁移；
-#229 proposal转为archive/evidence，不保持“最终Skill设计”。

## 5. PR #231 Development Throughput Spike 的处理

### 采纳

- 先闭合candidate delivery，再优化测试毫秒；
- Candidate Closure只编排；
- read-only plan先于自动执行；
- Context Capsule为引用集合；
- Action Key先于CAS；
-确定性失败可复用但不构成PASS；
- Repository Semantic Index为derived cache；
- Work Package parallelism与Evidence node parallelism分离；
- publication使用typed action和receipt；
- ready-to-main-readback与first-pass yield优先于活动量。

### 调整

- Candidate Closure不成为新的大一统交付系统；它属于development-integration domain；
- GitHub service、CLI adapter和workflow只是执行/投影，不成为状态owner；
- automatic publication必须晚于read-only reconciler、权限和trusted dispatch；
- remote CAS/daemon/virtual merge只在正确Action Key、Evidence和Integration Epoch后进入；
-吞吐建设不能延迟产品自举纵切片。

### 退役条件

- 每个组合节点指向Issue #177/#178/#179/#188/#189/#190/#191/#194/#205/#207/#219/#221或新的唯一owner；
- Candidate Closure focused owner建立；
- proposal registry与metrics不再被当作当前control-plane；
-#231/Issue #230标记为absorbed synthesis。

## 6. Issue #222 Web Frontend 的处理

Issue #222 的架构决定被采纳，但拆到既有owner：

- HTML/CSS/TSX Source Program dialect → source-program domain；
- Web Target Profile → compiler/runtime target profile；
- DOM/component/event/accessibility bindings → semantic/source dialect；
- Browser physical behavior → Browser Verification Provider；
- web mutation → Semantic Mutation operation registry；
- support level → Provider/Support Claim协议。

不创建一个同时拥有HTML、CSS、DOM、Browser、Workbench和framework的“Web总域”。

激活条件：TypeScript self-observation、controlled mutation和Brownfield Adopt至少完成首个现实闭环。Native HTML/CSS可提前做只读corpus，但不得成为正式实现前置。

## 7. Issue #224 Responsibility 的处理

Issue #224 是产品核心，不长期停留在Issue正文。

迁入：

- stable Responsibility identity、facets、authority、source binding、reconcile → semantic responsibility owner；
- source candidate extraction → source-program provider；
- responsibility-level impact → delta-impact rule registry；
- responsibility mutation → operation registry；
- Block extraction → capability/block owner。

必须删除或拒绝：

- 一函数一责任；
- 调用图cluster自动成为业务owner；
- AI摘要成为identity；
- 为表达责任机械拆碎代码；
- 所有facet变成独立Block。

退役条件：canonical责任合同、self-observation corpus和至少一个责任级mutation进入main；Issue #224转为implemented/absorbed记录。

## 8. 现有 active proposals 的处理

`docs/authority.json` 中每个 proposal 都必须拥有以下之一：

- `activationTrigger`：何时生成正式Issue/Work Package；
- `canonicalTarget`：已被哪个authority吸收；
- `experimentalEvidence`：必须做什么benchmark/model/physical matrix；
- `rejectedReason` + `reversalCondition`；
- `retirementTarget`：何时移入archive或删除。

禁止无限保持`draft`且被其他文档反复引用。Proposal不得成为长期逃避决策的存储层。

## 9. Canonical owner 迁移批次

### Batch A — Cross-domain assembly

- architecture assembly人类/机器文件；
- authority registry和relationship tests；
-不修改领域正文算法。

### Batch B — Product slice prerequisites

- Source Program authority；
- Responsibility authority；
-最小Effect/Resource/Capability protocol；
-仅实现首个self-observation consumer需要的字段。

### Batch C — Integrity and development protocols

- Verification truth和Condition/freshness；
- Agent Role/Operation contract；
- Candidate Closure read-only model；
- Integration resolver修正。

### Batch D — Product implementation

- TypeScript SPM；
- Responsibility self-observation；
- Impact/Explain；
- Controlled Mutation；
- Target/Type/IR/Lowering；
- Workbench same facade。

### Batch E — Acceleration and expansion

- Evidence/Run、Query/Feedback、safe parallelism；
- Brownfield、Web、Release、Registry。

## 10. 每个迁移PR的退出清单

1. 读取latest main和当前canonical owner；
2. 只迁移一组不可分割decision；
3. 删除或标记被替代的并列表述；
4. machine owner/relation测试拒绝duplicate或missing target；
5. consumer迁移明确；
6. migration/compatibility/negative tests明确；
7. exact-head CI和独立Review；
8. squash merge；
9. new-main readback；
10. proposal/Issue/branch closeout。

只有写了新文档而旧设计仍作为active“最终方案”存在，迁移不算完成。

## 11. 最终归档结构

```text
docs/architecture-assembly.md                 canonical cross-domain map
docs/governance/architecture-assembly.yaml    machine relation/decision index
docs/<domain>.md                               one stable owner per domain
platform/shared/<domain-contract>/             machine canonical contracts
docs/evidence/research/...                     source/research evidence
docs/archive/proposals/...                     superseded proposal history
```

Issue和PR保留decision history，但不作为运行时或canonical design lookup入口。
