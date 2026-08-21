---
title: 测试责任、证明经济与可验证退役
status: stable
domain: verification-governance
last-reviewed: 2026-08-21
---

# 测试责任、证明经济与可验证退役

本文只拥有 **Test Asset / Test Case 为什么有资格存在、证明什么、失败意味着什么、与其他证明如何重叠、何时可以退役** 的长期语义。

它不拥有：

- change/source → `required | not-applicable | unresolved` 的 Test Impact；
- Verification Result 五态、Aggregate、Evidence 或 Gate truth；
- failure fingerprint、retry 或 defect owner 归因；
- physical fixture/resource 生命周期；
- performance 数值；
- repository structural deletion authority；
- 产品、协议、架构 invariant 本身。

因此本文建立的是 **proof responsibility**，不是第二 Test Impact graph、第二 test inventory、第二 Verification Result 或第二 repository audit。

## 目标

测试不是工程目标，测试所承担的证明责任才是目标。

长期测试必须能够回答：

```text
它证明哪个 canonical invariant / Requirement
→ 哪个 owner 拥有该性质
→ 失败时具体哪项 proof obligation 未成立
→ 它覆盖哪个输入/环境/故障空间
→ 与其他 proof 相比新增了什么信息
→ 什么条件成立后它可以安全退役
```

如果这些问题无法回答，测试只能保持 `unresolved` 或 bounded diagnostic，不能因为已经存在很久、提高 coverage、名字像 contract、或当前 Gate 依赖它，就自动取得永久存在资格。

## 与 Test Impact 的严格分离

两个问题必须分开：

```text
Test Responsibility
  某个 test 为什么存在、证明什么

Test Impact
  某个 change 为什么需要运行哪些 test / Gate
```

`platform/shared/test-responsibility-contract.ts` 拥有前者的 pure machine contract；现有 `platform/shared/test-ownership-contract.ts` 和 Test Impact owner继续拥有 source/change ownership 与 supplemental selection输入。

Test Responsibility 可以成为 Test Impact 的输入，但不能自己选择当前 candidate 要跑什么，也不能把“登记了责任”投影成 PASS。

## Test Responsibility 对象

当前最小 machine declaration 表达：

```text
testId
sourcePath
owner
layer
role
lifecycle
obligations[]
regressionRefs[]?
independence[]?
supersedes[]?
retirementCondition
```

### Identity

`testId` 是稳定逻辑 identity；source path 和测试标题只是 locator / display。

禁止把以下内容作为唯一 test identity：

- 测试标题 prose；
- 行号；
- branch / PR；
- wall-clock；
- 临时 workspace；
- 当前 runner shard；
- source function 名。

重命名文件或调整测试标题不应无理由创造新的 proof identity。

### Proof obligation

每个长期登记 test 至少绑定一个 proof obligation：

```text
kind
id
owner
failureMeaningCode
```

当前 obligation kind 是一个有界 machine vocabulary：

```text
architecture-owner
contract
verification-requirement
regression-obligation
verifier-calibration
```

obligation identity 必须来自或最终指向真实 canonical owner。测试文件不能通过写一个漂亮名字自行发明新的产品/架构 authority。

`regression-obligation` 也不能只指“历史上有一个 bug”；它最终仍要说明哪个 invariant 需要继续被保护。

## Failure Meaning

Failure Meaning 是 test proof responsibility 的组成部分，不是失败以后再补的解释。

正确链条是：

```text
assertion / execution failure
→ obligation.failureMeaningCode
→ canonical obligation owner
→ 未证明的现实性质
→ 后续 failure classification / repair / Review
```

`failureMeaningCode` 是稳定 machine code；长 prose、stack、expected/actual、环境和 failure fingerprint 由对应 Result/Failure owner保存。

### Assertion 不得偷偷扩大 Contract

测试断言只能证明 owning Requirement 真正要求的性质。

例如 Requirement 是：

```text
外部工具版本必须 exact pin
```

那么 `0.7.10` 与 `17.3.10` 都可以是 exact pin。若测试额外要求 `major >= 1`，但 owning provider contract没有这一条件，这个 assertion 就把偶然偏好扩张成了伪 contract。

同理：

- contract 没有规定数组顺序时，不得永久冻结当前枚举顺序；
- public semantics 没有规定内部函数数量时，不得把函数拆分方式作为 required invariant；
- type system 已完整禁止某种状态时，不应再写纯重复 runtime assertion，除非它验证新的 runtime / integration 不确定性。

测试失败不能通过改产品去迎合测试的偶然断言；应先裁决 Requirement 与 assertion 谁错。

## Layer 与真实不确定性

Test Responsibility layer 描述主要证明机制：

```text
unit
property
contract
integration
physical
recovery
mutation
```

层级不是“越高越强”的全序。

不同 layer 可以共同证明一个 Requirement，因为它们可能覆盖不同的不确定性：

- **unit**：纯算法、selector、normalizer、state transition等局部性质；
- **property**：输入空间、排列、幂等、round-trip、单调性、fixed-point等普遍性质；
- **contract**：公开 schema、CLI、package、protocol、identity、inter-owner shape；
- **integration**：跨 owner composition、transaction、artifact flow；
- **physical**：真实 filesystem/process/browser/provider/OS/package/network capability；
- **recovery**：crash、partial state、rollback、cleanup、resume、TOCTOU；
- **mutation**：校准 validator / selector / authorization 是否真的能检测对应 defect。

一个偶尔运行很快的 browser test 仍可能是 physical；一个位于 integration 目录但只测试 pure shape 的 case 仍不应因此获得 physical proof 身份。

## Proof role

当前 role：

```text
primary
supporting
calibration
diagnostic
```

### Primary

直接承担某个 Requirement 的正式主要证明责任。

### Supporting

为正式证明提供局部、前置或分区证据，但不能单独把 Requirement 推进为 PASS。

### Calibration

证明 selector、validator、oracle、authorization 或 test mechanism 确实能检测目标错误。它保护 verifier quality，但不能因为 calibration 自己通过就证明产品 Requirement。

### Diagnostic

为故障隔离、日志采集、实验或一次性观察存在。Diagnostic 不得冒充 ordinary required proof；必须绑定 bounded work/retirement condition。

## Proof Economy：最小充分证明集

目标不是最大化测试数量，也不是最小化测试数量，而是：

```text
对每个 required invariant
保留覆盖真实 failure space 的最小充分 proof closure
```

测试成本包括：

```text
代码维护
fixture / provider / browser / process 成本
执行 wall / CPU / I/O / memory
失败调查
candidate invalidation
AI / 人类上下文
false failure / flaky 风险
```

但成本高不能单独授权删除 correctness proof。

### 判断 duplicate proof 的必要维度

至少比较：

```text
requirement identity
input / behavior domain
environment / capability
oracle independence
failure class
state / recovery boundary
platform / provider boundary
```

只有这些维度都没有新增信息，两个 active proof 才可能是 duplicate-proof candidate。

第一版机器系统只能产生 candidate / witness，不能自动删除。

### 不能机械去重的组合

以下组合即使共享 Requirement，也通常覆盖不同 failure space：

```text
unit + physical E2E
reference oracle + candidate implementation
Windows native + Linux
clean path + crash/recovery
public contract + internal algorithm
static analyzer + dynamic effect
single-thread deterministic + concurrency/TOCTOU
provider-neutral contract + provider conformance
```

“E2E 更接近真实”不意味着它自动 supersede unit；“static analyzer 更快”也不意味着它能证明动态副作用。

## Static proof 优先，但只能在 coverage 完整时替代 runtime proof

如果某性质已经由更低成本且完整的 machine proof保证，例如：

- type system；
- schema validator；
- architecture fitness；
- compiler invariant checker；
- deterministic source graph；

则同一事实不应再由多个 runtime tests重复生产。

但替代成立至少要求：

```text
same Requirement
+ analyzer coverage完整
+ unknown frontier闭合
+ relevant dynamic/environment failure不存在
+ independent Review / parity evidence
```

只要其中一项未知，runtime proof就不能因“理论上静态可查”而自动退役。

## Independent oracle 与自证边界

验证器、selector、reference model、compatibility evaluator、security policy或merge authority不能只由候选自己的同一实现证明自己。

保留看似重复的 test 可能是必要的，如果它提供：

- 独立 reference implementation；
- 不同 parser/provider；
- physical observation；
- candidate-as-SUT bootstrap；
- mutation calibration；
- cross-platform owning cell。

Proof Economy 不能把独立性优化掉。

## Supersedence

“新 test 覆盖更多”不是 supersedence proof。

正式 supersedence 必须显式绑定：

```text
old test identity
replacement test identity
coverage reference
owning Requirement
```

并证明旧 test 独有的：

```text
input domain
environment
oracle independence
failure class
recovery/platform/provider coverage
```

均已由 replacement 覆盖或 owning Requirement 明确退休。

machine contract拒绝 self-supersedes、unknown target和 supersedence cycle。

## Retirement

Test retirement 是 authority transition，不是删除一个文件。

当前 retirement condition 只保留少量语义：

```text
persistent-invariant
owner-retirement
replacement-proof
diagnostic-completion
```

### Persistent invariant

只要 owning invariant 存在，该 proof仍可能需要。它不是“永远不能删”；未来仍可通过新的 replacement-proof 改变责任。

### Owner retirement

当对应 capability/contract/architecture owner完成真实退役后，测试才可进入退役证明。

### Replacement proof

必须引用明确 replacement test 与 coverage Evidence；新文件存在本身不是 coverage。

### Diagnostic completion

bounded diagnostic随着 owning work完成即退休或升格为 formal calibration/contract proof，不能长期泄漏进普通 suite。

## Regression tests

Regression test 保护的是 **曾经暴露出来的 invariant**，不是历史代码形状。

因此：

- issue/PR关闭不会自动删除 regression test；
-实现完全替换也不一定删除，如果同一 invariant仍存在；
-如果 invariant 已被更强 proof完整覆盖，可以退役旧 regression test；
-如果产品能力本身退役，可以随 owner retirement退役；
-如果测试只冻结旧实现细节而没有现实 invariant，应修正或删除，而不是永久背负历史。

`regressionRefs` 只是 provenance，不是 test existence authority。

## Coverage 的位置

Coverage 是校准与发现工具，不是 proof responsibility owner。

```text
低 coverage
→ 可能说明有未验证行为
→ 需要找到真实 Requirement / failure space
→ 再决定是否新增 test
```

禁止：

```text
某行未覆盖
→ 为覆盖率新增没有 Failure Meaning 的 test
```

同样，高 coverage 不证明语义完整、recovery完整、platform完整或 independent oracle存在。

## Diagnostic / Probe 生命周期

Probe、debug fixture、logging-only case、benchmark实验和一次性 sentinel 默认不进入长期 required test inventory。

如果它发现长期需要保护的性质，应显式升格：

```text
diagnostic observation
→ canonical invariant / Requirement
→ Test Responsibility
→ formal test
```

如果没有升格条件，则：

```text
diagnostic-completion
→ artifact/evidence按对应owner保存
→ test/probe本体退休
```

“sentinel”只是名称，不决定其性质。一个 sentinel 若保护真实 selector/trust-root invariant，可以是正式 contract/calibration proof；一个故意失败的 smoke probe 若没有正式 obligation，则不能留在 normal health profile。

## Unknown 与删除安全

以下事实任一 unknown 时，不得自动退休：

- canonical owner；
- Requirement仍是否有效；
- dynamic/external consumer；
- replacement coverage；
- oracle independence；
- platform/provider requirement；
- recovery/fault value；
- selector / full reference parity。

Unknown 只能阻止删除或扩大调查，不能因为测试“看起来没用”被解释成 safe-to-delete。

## 与其他 owner 的组合

### Test Impact

Test Impact决定：

```text
change
→ required | not-applicable | unresolved
→ selected test / Gate closure
```

它可以消费 Test Responsibility 的 obligation refs，但不拥有 test existence lifecycle。

测试退役前，所有 obligations 必须能被投影为：

```text
replacement proof
| owning Requirement retired
|可信 not-applicable
```

否则 retirement unresolved。

### Verification Result / Failure

Test Responsibility 的 `failureMeaningCode` 只说明哪个 proof obligation没有成立。

Result owner继续拥有 passed/failed/not-run/unsupported/invalidated；Failure owner继续拥有 fingerprint、归因、retry precondition和next action。

### Repository Structural Convergence

结构治理可以产生：

```text
orphan-proof
implementation-coupled
stale-regression
diagnostic-leakage
duplicate-proof-candidate
wrong-layer
non-actionable-failure
```

但这些只是 findings。真正删除仍需要 owning Requirement + Test Impact closure + consumer/reachability + Verification。

### Performance Truth

性能系统测 proof duplication 的真实 wall/CPU/I/O/process/browser/resource cost；不能因为昂贵就覆盖 correctness authority。

### Test Quality

Property/model/mutation/fault用于校准 proof 是否有真实 defect-detection power；它们不建立第二 Test Responsibility registry。

### Architecture Fitness

完整 static fitness result可以成为某些 architecture test 的 replacement evidence，但只有 coverage/unknown闭合后才成立。

## Machine contract 与迁移策略

`platform/shared/test-responsibility-contract.ts` 是当前 pure machine contract。第一阶段只强制新合同自身的结构完整性，不一次人工登记全仓所有 test case。

原因是：一次性手填巨大 registry 会制造第二维护宇宙，并把未知责任伪装成已理解。

迁移顺序：

```text
1. 新/高成本/高脆弱 test先声明责任
2. 现有 Test Impact owner逐步引用 obligation identity
3. repository audit只消费该声明产生 findings
4. 对 duplicate/stale candidate做 replacement/retirement proof
5. consumer-zero + parity后删除旧 test
```

旧 path-based supplemental selection 在真实 consumer迁移前继续存在；不能为了“架构漂亮”提前删除成熟 guard。

## 新增长期测试的资格

一个新的长期 test 至少需要：

```text
stable test identity
canonical proof owner
至少一个 proof obligation
stable Failure Meaning code
合适的 layer / role
必要 environment / independence说明
retirement condition
```

如果只是临时调查，应使用 diagnostic lifecycle，而不是伪装成永久 contract test。

## 删除测试的最低证据

删除不是因为：

- 当前失败；
- 很慢；
- coverage够高；
- 有另一个E2E；
- 代码已经重构；
- issue已关闭；
- AI判断“似乎重复”。

最低链条是：

```text
exact test identity
→ owning obligations
→ replacement / owner-retirement / not-applicable proof
→ independent dimensions没有丢失
→ Test Impact clean/full parity
→ consumer/reachability无未知
→ focused + required physical verification
→ Review
→ removal readback
```

任何环节 unknown 都不能自动删除。

## 反例与反转条件

### “测试越少开发越快”

局部成立，但如果删除的是独立 oracle、recovery 或 physical proof，失败会更晚暴露，整体开发成本可能更高。只有真实 critical-path Evidence与 proof equivalence 同时成立时，删除才是净收益。

### “测试越多越安全”

不成立。重复、实现耦合、flaky、错误 assertion会制造 false failures、维护放大和错误 authority。安全来自覆盖正确 failure space 的充分证明，不来自数量。

### “E2E 已经覆盖，所以 unit 可以删”

只有 E2E 对同一 Requirement提供相同或更好的 defect localization、input-domain coverage，并且 unit没有独立 value 时才可能成立。通常二者证明空间不同。

### “类型系统已经证明，所以 runtime test都该删”

只对完全静态且 analyzer coverage闭合的性质成立。runtime value、effect、serialization、filesystem、process、platform、recovery仍需要其他 proof。

## Anti-overengineering

禁止：

- 为每个 assertion 建 ontology；
- 建第二 Test Impact graph / test inventory / Result truth；
- 用测试标题 prose做identity；
- 全仓一次性人工登记所有 test case；
- free-form ignore永久绕开owner；
- 自动按 test count / LOC / duration 删除；
- “higher layer automatically stronger”排序；
-把所有重复代码都抽象成统一test helper并破坏oracle independence；
-保留历史 regression 墓碑但没有当前 invariant；
-让 diagnostic/probe因为曾经有用就永久进入 required profile。

## 现实成熟度

稳定文档只定义目标语义。某个 test是否已经完成责任声明、某个 selector是否已经消费obligation、某个 duplicate candidate是否已被验证退役，都必须从最新 `main` 的机器合同、测试、Evidence与 consumer readback判断。

文档存在、Issue存在、PR合并或测试数量减少都不能单独证明该能力已 adopted/enforced。
