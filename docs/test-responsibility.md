---
title: 测试责任、证明经济与可验证退役
status: stable
domain: verification-governance
last-reviewed: 2026-08-21
---

# 测试责任、证明经济与可验证退役

本文只拥有一个长期问题：**一个 Test Case 为什么有资格存在、证明什么、失败意味着什么、与其他证明相比新增什么、何时可以退役。**

它不拥有：

- change/source → `required | not-applicable | unresolved` 的 Test Impact；
- Verification Result、Evidence、Failure fingerprint 或 Gate；
- physical fixture/resource 分配与 cleanup；
- runner/provider 调度、并发或性能数字；
- repository structural deletion authority；
- 产品、协议、架构 invariant 本身。

因此 Test Responsibility 是 proof responsibility，不是第二 Test Impact、第二 runner inventory、第二 Result truth 或第二 repository audit。

## 一、第一性约束

测试不是工程目标，**proof obligation 才是目标**。长期测试必须能回答：

```text
canonical Requirement / invariant
→ testId
→ proof owner
→ obligation + Failure Meaning
→ 覆盖的 failure space / independence
→ lifecycle / retirement
```

回答不了时，只能是：

```text
observed-but-unresolved
或 bounded diagnostic
```

不能因为测试历史久、coverage高、名字叫contract/E2E/sentinel、当前Gate依赖它，自动取得永久存在资格。

## 二、TestCase identity 与唯一写入位置

### 2.1 稳定 identity

`testId` 是稳定逻辑 proof identity。以下都不是 identity：

- source path；
- suite/title prose；
- 行号；
- branch / PR；
- runner shard；
- wall-clock；
- 临时 workspace。

文件移动、suite重组、标题改写不能无理由创造新的 proof identity。

### 2.2 Responsibility 必须与 executable case 同处单写

长期终态禁止维护一张人工同步的中央 TestCase registry。

语义责任直接写在 case 定义旁，概念形态为：

```ts
secTest({
  testId: '...',
  owner: '...',
  obligations: [...],
  layer: 'contract',
  role: 'primary',
  lifecycle: 'active',
  retirementCondition: { kind: 'persistent-invariant' }
}, 'human readable title', () => {
  // assertion
});
```

`secTest` 只是薄 metadata + runner adapter，不拥有执行调度。

物理 locator：

```text
sourcePath
suitePath[]
title
```

由 current source AST/census **确定性观察生成**，不能在 responsibility metadata 中再手填一份。

因此唯一写入链是：

```text
source case + inline semantic metadata
→ deterministic census
→ current locator / inventory projection
```

生成 census 可删除、可重建、不可人工共同维护，不是第二 authority。

## 三、全量 Census 与迁移

所有 executable test cases 必须进入 census。至少覆盖：

- `test()` / `it()`；
- nested `describe`；
- `.each` / parameterized family；
- dynamic title / dynamic suite；
- skip/todo/only 等执行状态；
- helper-generated family 的显式边界。

迁移期允许 legacy raw Bun tests：

```text
observed-but-unresolved
reason = raw-bun-test-without-responsibility
```

但绝不允许“没有 metadata = census 看不见”。

动态 family 只有满足：

```text
stable TestFamily identity
+ bounded stable instance key
```

才可成为长期 resolved proof；任意 runtime-generated title 不能冒充稳定 identity。

最终 adopted 条件：

```text
executable case census coverage = 100%
long-term required responsibility unresolved = 0
orphan case = 0
duplicate locator = 0
stale generated projection = 0
```

这不是要求一次性手填全仓表。正确迁移是按 canonical owner 分批把 legacy unresolved 降到零，同时从机制进入 main 后禁止新增无责任的长期测试。

## 四、Proof obligation 与 Failure Meaning

每个长期 case 至少绑定一个 obligation：

```text
kind
id
owner
failureMeaningCode
```

当前 kind：

```text
architecture-owner
contract
verification-requirement
regression-obligation
verifier-calibration
```

obligation 必须指向真实 canonical owner；测试文件不能靠自造名称创造产品 authority。

Failure Meaning 与 obligation 同一对象绑定：

```text
assertion / execution failure
→ obligation.failureMeaningCode
→ canonical owner
→ 哪项现实性质没有被证明
→ #177 Failure / repair / Review
```

stack、expected/actual、环境和 fingerprint 仍由 Result/Failure owner保存。

### Assertion 不得扩大 Contract

Requirement 若只要求：

```text
external provider version = exact pin
```

那么 `0.7.10` 与 `17.3.10` 都可以满足。测试若额外要求 `major >= 1`，但 owning contract没有该条件，就是伪 contract。

同理：

- 没有规定顺序时，不冻结偶然枚举顺序；
- 没有公开语义要求时，不冻结内部函数/文件形状；
- 类型系统已完整证明的同一事实，不重复写没有新增 runtime failure space 的测试。

测试失败时先裁决 Requirement 与 assertion，而不是默认修改产品迎合测试。

## 五、Layer、Role 与真实不确定性

### Layer

```text
unit
property
contract
integration
physical
recovery
mutation
```

Layer 不是强弱全序。它描述 proof mechanism 与现实不确定性：

- unit：纯算法、normalizer、state transition；
- property：排列、round-trip、幂等、单调、fixed-point；
- contract：schema、CLI、package、protocol、identity、inter-owner shape；
- integration：跨 owner composition / transaction / artifact flow；
- physical：filesystem/process/browser/provider/OS/package/network；
- recovery：crash/partial/rollback/cleanup/resume/TOCTOU；
- mutation：校准 verifier 是否真正检测目标 defect。

目录名不决定 layer。`tests/e2e/**` 不能自动等价“慢/更强/必须browser”。

### Role

```text
primary
supporting
calibration
diagnostic
```

- primary：直接承担 Requirement 的正式证明；
- supporting：提供局部/前置证据，不能单独推进 Requirement PASS；
- calibration：证明 selector/validator/oracle/authorization 有 detection power；
- diagnostic：故障隔离或一次性观察，必须 bounded + retirement。

`mutation` 只能是 calibration 或 diagnostic，不冒充普通产品 primary proof。

## 六、Proof Economy：最小充分证明集

目标不是测试越多越安全，也不是测试越少越快，而是：

```text
对每个 required invariant
保留覆盖真实 failure space 的最小充分 proof closure
```

Duplicate-proof 至少比较七个独立轴：

```text
Requirement identity
input / behavior domain
environment / capability
oracle independence
failure class
state / recovery boundary
platform / provider boundary
```

只有全部没有新增信息，才能成为 duplicate candidate。

不能机械去重：

```text
unit + physical
reference oracle + candidate implementation
Windows + Linux
clean + crash/recovery
static proof + dynamic effect
single-thread + concurrency/TOCTOU
provider-neutral contract + provider conformance
```

高层测试不会自动 supersede 低层测试。

### Static proof 优先，但 coverage 必须闭合

类型系统、schema、architecture fitness、compiler invariant checker等低成本 proof 可以替代 runtime proof，前提至少是：

```text
same Requirement
+ analyzer coverage完整
+ unknown frontier闭合
+ 没有额外 dynamic/environment failure
+ parity / Review成立
```

未知时 runtime proof不能因为“理论上可静态证明”被删除。

## 七、Independence 与自证边界

需要保留的独立维度包括：

```text
oracle
environment
failure-class
state-boundary
platform
provider
```

`independence` 未声明只表示未观察/未解决，绝不能解释为“没有独立价值”。

候选实现不能只由同一实现自证。独立 reference、不同 provider、physical observation、candidate-as-SUT、mutation calibration、cross-platform owning cell 都可能是必要的非重复 proof。

## 八、Supersedence 与 Retirement

### 唯一 supersedence writer

正式替代只由旧 test 的：

```text
retirementCondition.kind = replacement-proof
```

表达。禁止再维护一份反向 `supersedes[]`。

replacement 至少要求：

- old lifecycle = `retiring`；
- replacement 真实存在且为 `active`；
- 非 self / 非 unknown；
- replacement union 覆盖 old 的全部 exact obligation identity；
- `coverageRef` 指向外部 Evidence；pure contract不靠一个字符串授权删除；
- input/environment/oracle/failure/recovery/platform/provider独立维度没有丢失。

### Retirement condition

只保留：

```text
persistent-invariant
owner-retirement
replacement-proof
diagnostic-completion
```

`owner-retirement` 不能顺带丢掉其他 owner 的 obligations。

Regression test保护 invariant，不保护历史实现；Issue关闭或实现替换都不自动删除它。

## 九、Coverage、Mutation、Diagnostic 的位置

Coverage 只负责发现“可能没验证”，不能创造测试存在资格：

```text
uncovered line
≠
authorized new long-term test
```

必须先找到 Requirement / failure space。

Mutation/property/model/fault 用于校准 detection power；不建立第二责任 registry。

Probe/debug/logging-only/benchmark实验默认 diagnostic：

```text
发现长期 invariant
→ 升格 formal responsibility
否则
→ diagnostic-completion
→ Evidence 按 owner 保存
→ probe 本体退役
```

“sentinel”只是名称。保护真实 trust/selection invariant 的 sentinel 可以是正式 proof；纯故意失败探针没有 obligation 就不能留在 normal health profile。

## 十、与 Test Impact / Resource / Provider 的组合

唯一职责链：

```text
Test Responsibility
  为什么存在
        ↓
#188 Test Impact
  本次 change 是否 required / N-A / unresolved
        ↓
#311 Verification profile
        ↓
#190 resource requirements / settlement
        ↓
Bun / Playwright / other exact Provider
        ↓
#179 Action / #176 Result / #177 Failure
```

因此：

- Bun/Playwright/Vitest等 runner不能决定 test existence；
- `fast/slow/suite/shard/parallelSafe/timeout` 不是 Test Responsibility；
- browser只有 Requirement 真正要求 DOM/navigation/cookie/hydration/focus/browser-event等性质时才进入 required closure；
- request/service/API-only proof 不得因目录叫 acceptance 自动启动 browser；
- provider unavailable 不等于 not-applicable；required capability unavailable由 Verification Result表达。

## 十一、新测试准入与删除最低证据

### 新增长期 test

至少需要：

```text
stable testId
canonical owner
>=1 obligation
Failure Meaning
layer / role
必要 independence/capability refs
retirement condition
```

否则只能 unresolved 或 diagnostic。

### 删除 test

不能因为：

- 当前失败；
- 很慢；
- coverage高；
- 已有E2E；
- 代码重构；
- Issue关闭；
- AI认为重复。

最低删除链：

```text
exact testId
→ obligations
→ replacement / owner-retirement /可信 not-applicable
→ independence/failure-space无丢失
→ #188 clean/full parity
→ dynamic/external consumer无未知
→ #327 structural disposition
→ required physical Verification
→ independent Review
→ new-main readback
```

任何 unknown 都阻断自动删除。

## 十二、Anti-overengineering 与成熟度

禁止：

- 每个 assertion 建 ontology；
- 中央手填全仓 TestCase registry；
- 第二 Test Impact / runner inventory / Result truth；
- 用 title/path 作为 semantic identity；
- fixed LOC/test-count/duration 阈值决定删除；
- higher-layer-automatically-stronger；
- 为复用 helper 破坏 independent oracle；
- diagnostic/probe永久进入 required profile；
- 为目录美观先 mass rename 再理解 owner。

本文定义稳定语义，不声明当前仓库已经完成迁移。

真实成熟度只能按：

```text
specified
→ implemented
→ verified
→ enforced
→ adopted
→ legacy retired
```

逐层由 current `main` 的 machine contract、census、consumer、physical Evidence、Review 和 old-path readback证明。文档/Issue/PR/测试数量变化都不能单独代表完成。
