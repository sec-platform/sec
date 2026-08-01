---
name: sec-design-change
description: 当 SEC 的 canonical owner、公共合同、identity/revision、state、pipeline、permission、failure/recovery或迁移边界需要改变时，重建机制、裁决方案并冻结可交付设计；不在设计过程中直接实现产品。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: design-change
  sec-risk: read-only
---

# sec-design-change

## 目标

从用户 Goal、live main 和不可绕过约束出发，确定唯一 canonical owner、公共不变量、迁移/退役和可执行验收，并输出可签发 implementation/governance envelope 的 `SecChangeDesignV2`。设计不是架构文档写作活动，而是产品责任和状态所有权裁决。

## 触发

- 新能力或修复跨越一个以上 owner/consumer。
- public type/schema、identity/revision、state writer、pipeline order、permission、publication/recovery或compatibility需要改变。
- audit、diagnosis或Review证明局部修复会建立第二 writer/parser/cache/state machine。
- 用户要求重新设计、全局优化、从第一性原理重算。

## 不触发

- owner、contract、scope和migration已由当前 envelope冻结，只需编码：转 `sec-implement-change`。
- 只修改文档生命周期、依赖或外部 Provider而不改变产品机制：转对应 governance Skill。
- 大型未知尚无可验证consumer：应形成 Spike/Evidence，而非直接冻结正式设计。

## 必需输入

- resolved context、exact main、用户 Goal和非目标；
- canonical authority registry与当前 owner；
- source/contracts/tests/consumers/Impact Evidence；
- failure/audit/review findings；
- resource、runtime、security、migration与backward compatibility约束；
- Change Closure compiler输出或明确 unknown frontier。

## 权限边界

- 默认 `read-only`；只有独立 authority-edit envelope 才可写 proposal/canonical docs。
- 不修改产品 implementation seam、不触发 hosted Gates、不合并。
- 不自行创建 package/lock、workflow、Skill registry或control-plane writer。
- 方案不能通过 Skill 获得权限；后续写权限由新的 operation envelope签发。

## 执行

1. 去除用户措辞和当前代码结构的锚定，定义对象、边界、状态、接口、主体、约束、失败和反事实。
2. 下探决定性约束：改变它是否会改变上层结果、是否可检验、是否存在绕过/失效条件、是否是真正瓶颈。
3. 重建当前因果链：inputs → owners/contracts → transitions/effects → consumers → observable result。
4. 产生至少两个实质竞争方案，并攻击反向因果、共同原因、局部最优、兼容破坏、极端输入、并发、崩溃、权限升级和不可逆迁移。
5. 选择唯一 canonical owner。若现有 owner足够，扩展它；只有职责、lifecycle和consumer独立时才新建 domain。禁止用新名词包装重复owner。
6. 定义 public contract/invariants、typed states/errors、negative/property/fault/compatibility tests、Impact和support boundaries。
7. 定义迁移：producer/consumer顺序、双读/双写是否允许、rollback/recovery、旧 adapter退役、不可逆点和main readback。
8. 调用 Change Closure compiler，补齐环境、trust、control-plane和post-merge闭包；unknown 不得由 prose掩盖。
9. 将设计拆成最小正式纵切片或 Evidence Spike。每个 slice 有 owner、write set、exit criteria和反转条件。
10. 输出下一 operation：implement、govern-domain、blocked或no-change。

## 输出合同

```yaml
schema: sec-change-design-v2
exactMain:
problem:
userVisibleOutcome:
nonGoals: []
canonicalOwner:
currentMechanism: []
constraints: []
alternatives:
  - id:
    benefits: []
    costs: []
    failureModes: []
selectedDesign:
  objects: []
  identities: []
  states: []
  interfaces: []
  invariants: []
  errorsAndRecovery: []
consumers: []
impact:
migration:
  order: []
  rollback:
  retirement: []
verification: []
unknownFrontier: []
reversalConditions: []
deliverySlices: []
nextOperation:
outcome: completed | blocked | unresolved | implementation-required | no-change
```

## 失败与转移

- canonical owner或不变量无法确定 → `unresolved`，列出决定性证据。
- 真实未知需要benchmark/formal/physical Evidence → 创建 Spike design，保持不实现。
- 设计冻结且存在合法slice → `implement-change`。
- 仅文档/工具链/能力/Agent系统责任 → 对应 governance Skill。
- 新 Evidence推翻根约束 → 重新进入 design operation，不在旧方案末尾追加例外。

## 示例

需要支持 HTML/CSS：设计分离 Source Template、CSS Program、runtime DOM和browser Evidence，不把所有内容塞进 Engineering IR；先输出 Native Web只读 slice，而非同时实现全部框架。

同一验证 aggregate又出现顺序错误：设计共享状态格/duplicate identity contract和property tests，不在每个runner复制if分支。

## 资源

- `../../registry.yaml`
- `../../README.md`
- `docs/authority.json`及目标domain唯一authority
- Change Closure、Impact、formal/benchmark/physical Evidence services

## 禁止

- 不从“当前最容易修改的文件”反推降低理论目标。
- 不先改代码再补authority。
- 不建立万能IR、万能graph、万能state或无consumer抽象。
- 不把Spike、局部示例、PR body或测试绿色写成能力完成。
- 不无限保留兼容层；每个旧路径必须有退役条件。
