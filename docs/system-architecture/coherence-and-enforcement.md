---
title: 全系统一致性与结构强制
status: stable
domain: system-architecture
---

# 全系统一致性与结构强制

本文拥有跨 Domain/Responsibility 的**全局闭合与强制规则**：哪些错误应由结构和执行边界自动阻止，多个局部正确结论怎样组合为系统级成立，以及何时必须扩大影响范围。它不重新拥有各领域的业务语义或具体实现算法。

## 1. 一致性不是一个中央服务

SEC 的一致性来自共享 identity、typed relations、single writer、严格 admission、capability/effect boundaries 和最终 readback，而不是一个永久中央“真相服务”。

每个事实仍由自己的 authority owner 产生；cross-domain coordinator 只消费 public contracts/receipts：

```text
authoritative source → validated relation → consumer
```

不得为了“一致”把源码、Evidence、runtime state、docs 全复制进一个统一数据库。

## 2. 产品 Domain 与实现职责是两条正交分区

Product owner定义的 Engineering Semantics、Realization、Operation Runtime、Workspace Evolution、Assurance、Delivery and Support 是**产品语义 Domain**：它们按独立state/invariant/public operation成立。

SEC 默认实现另外采用十个**逻辑实现职责**。它们是代码/依赖/状态边界，不是Product Domain、进程、微服务、package数量或固定物理目录：

| logical responsibility | 唯一实现责任 | 明确不拥有 |
| --- | --- | --- |
| `contracts` | 最轻量的跨责任值合同、refs、dimensions、diagnostic/result envelope | mutable shared state、业务Definition、global config、执行 |
| `workspace` | 作者/原生/资产snapshot、candidate、source mapping、edit/apply plan的工作区事实 | 产品语义、实现选择、Effect执行 |
| `semantics` | Engineering Semantics、类型化definition/contract/requirement的解释与validated boundary | Target实现、执行、UI流程 |
| `compiler` | query/lowering、实现选择、Target Program、layout/artifact plan等pure编译责任 | runtime Effect、Assurance verdict、live Provider调用 |
| `assurance` | Claim/obligation、check plan、Evidence applicability、coverage与Verdict聚合 | 生产被验证artifact、修改Requirement、执行产品Effect |
| `application` | query/propose/preview/check/apply/operation用例编排、task intent/input获取、有限结果组合 | compiler内部算法、Provider私有状态、transport编码 |
| `execution` | 当前Authority、资源、真实tool/provider Effect、commit/recovery/settlement/readback | Target AST重写、产品Requirement、Verification自证 |
| `adapters` | 具体语言/frontend/target/format/host/provider适配与成熟外部工具接合 | 第二semantic core、第二resolver、业务decision |
| `entry` | CLI/API/协议transport、请求解码、结果编码和presentation入口 | application decision、semantic truth、Effect authority |
| `bootstrap` | 配置选择、validated assembly、process startup、依赖接线和handoff | 产品语义、业务状态、运行期间service locator式重选 |

六个Product Domain与十个实现职责不是一一对应。例如Realization主要由`compiler`承担，Assurance主要由`assurance`承担，但`application`会编排多个Domain，`adapters`会横跨外部技术边界，`contracts`只提供无状态公共载体。Domain边界改变需Product/System Architecture裁决；实现职责只是在不改变这些Domain所有权的前提下组织代码。

### 2.1 唯一静态直接依赖表

以下表是这十个职责的**直接静态依赖**源；传递依赖由它推导，不另维护第二张图：

| responsibility | may directly depend on |
| --- | --- |
| `contracts` | — |
| `workspace` | `contracts` |
| `semantics` | `contracts` |
| `compiler` | `contracts`, `workspace`, `semantics` |
| `assurance` | `contracts`, `workspace`, `semantics`, `compiler` |
| `application` | `contracts`, `workspace`, `semantics`, `compiler`, `assurance`, `execution` |
| `execution` | `contracts` |
| `adapters` | `contracts`, `workspace`, `semantics`, `compiler`, `assurance`, `execution` |
| `entry` | `contracts`, `application` |
| `bootstrap` | `contracts`, `workspace`, `semantics`, `compiler`, `assurance`, `application`, `execution`, `adapters`, `entry` |

共33条直接边，必须保持无环。它表达**编译时/源码依赖资格**，不等同运行调用顺序：例如`execution`可以在运行时通过`contracts`定义的Port被`application`调用，却不能静态反向依赖`application`；`compiler`不能为执行一个工具而导入`execution`实现，必须返回typed requirement/plan让外层编排。

硬方向：

```text
semantics  -/-> compiler/application/execution/adapters
compiler   -/-> assurance/application/execution/adapters/entry/bootstrap
assurance  -/-> application/execution/entry/bootstrap
execution  -/-> workspace/semantics/compiler/assurance/application/adapters/entry/bootstrap
entry      -/-> compiler/semantics/execution/adapters
```

这里`-/->`表示不允许该反向静态依赖；需要协作时通过被允许方向上的public contract、callback/Port、operation request或外层assembly完成，不使用ambient service locator逃避DAG。

当前物理仓库不要求机械重命名成十个顶层目录。一个现有目录可以包含多个待分离责任，一个责任也可以由多个文件/包实现；融合实施只需最终依赖和owner关系满足上表。若未来证明某职责应split/merge，必须给出新的职责闭包、依赖DAG和迁移证明，而不是因为目录方便随意改变。

### 2.2 默认部署形态

十职责默认装配为**本地、可嵌入的模块化单体**；逻辑分区不等于分布式部署：

- library/SDK：同进程嵌入；
- one-shot CLI：短生命周期进程；
- warm local service：只有反复启动成本、共享只读缓存或交互延迟确有收益时启用；
- isolated process/Wasm/worker：只有不可信代码、崩溃隔离、运行时冲突、资源隔离或并行收益要求时启用；
- remote worker/provider：只有数据位置、专用硬件、组织边界或规模收益超过网络/一致性成本时启用。

没有实际需求时不引入数据库、消息总线、控制平面、常驻daemon或远端调度。部署变化只改变Placement/Provision/Execution Binding，不重新定义十职责或产品语义。

## 3. 结构不变量

系统至少强制：

- 一个 canonical fact/decision/Artifact writer 只有一个 owner；
- raw/candidate/derived/observed/authoritative 的 authority ceiling 不混同；
- identity 不由 path/UI order/Map order 产生；
- unknown 不降格为 absent/false；
- plan 不产生 Effect；
- candidate/preview 不自动 publication；
- Verification 不由 producer 自签；
- runtime result 不反向改写原 Requirement；
- generated view/index/cache 无 authority；
- external Effect 在 settlement/readback 前不报告 terminal success。

## 4. 资格链与不可跨越边界

从要求到真实采用的最短正确链：

```text
Author/Observed candidate
→ semantic admission
→ implementation requirement
→ candidate qualification
→ exact Binding
→ target/materialization plan
→ Effect admission
→ execution + settlement/readback
→ Evidence/Verdict
→ publication/adoption
```

后一步的绿色不能补偿前一步没有成立。例如：

- 类型检查通过不产生业务语义；
- 签名/沙箱通过不证明 checker 逻辑正确；
- 测试通过不产生 Effect 权限；
- artifact 存在不证明已部署；
- deploy API 成功不证明目标健康；
- monitor 没报错不证明从未泄露。

## 5. 条件与支持闭包

跨组件保证形成有向 support graph。一个保证只有在每个 premise 被独立支持、或被公开成 consumer 必须满足的 import 时才可使用。

环不是自动错误，但没有种子/不变量/固定点/信用/真实进展规则的环不能自证。Safety、liveness、resource、deadline 分开闭合。

组合器必须防止：

- 循环假设自证；
- 空环境/矛盾前提造成 vacuous success；
- 每个局部 task 都“能完成”但共同资源不足；
- 公共资源死锁；
- 独立 root 的局部成功冒充共同发行成功。

## 6. 权限与能力注入

纯编译/分析阶段不应拥有 filesystem write、network、process execute、package install 等 Effect capability。需要外部事实/执行时形成 typed requirement，由外层 operation owner 经过 AuthorityGrant、Provision、Allocation 准入。

这优于“代码里记得别联网”：没有 capability 的代码在结构上不能执行相应 Effect。

但类型/constructor 不能代替不可信代码隔离。恶意 native/plugin 需要真实 process/Wasm/OS permission boundary；已有 file handle、远端已受理操作也不会因为撤销本地 token 而物理消失。

## 7. 候选、发布与 generation

Candidate generation 与 active generation 分开。新的 semantic/implementation/document/runtime generation只有在对应 publication/cutover完成后才成为新 consumer 的来源；旧 generation 在 consumer-zero、effect-zero、resource-zero 前不能删除。

在途 request 固定其 generation。新版本到达不重写旧 request/result/recovery identity。

## 8. 资源与死锁

共享资源进入实际 wait-for / ownership / capacity 关系。Local budget pass 不代表组合 pass。

准入检查包括：

- peak live memory / handles / processes / device queues；
- completion callback 所需 reserved capacity；
- locks held while waiting for another actor；
- producer/consumer credit；
- cleanup/recovery resource；
- irreversible effect budget。

如果一种实现只有通过串行化才能满足资源，必须重新检查公开并发/时限合同。

## 9. 变化传播

增量是优化，不是系统真理。Change impact 从实际读关系/共享条件传播：

- 私有算法变化通常局部；
- public contract/semantic invariant/ABI/Target/Profile 可扩大；
- shared allocator/cache/queue/time source 改变可能影响没有显式业务 data edge 的消费者；
- security/support/license/provider withdrawal 可能全局 invalidation。

系统不得为了“保持局部”删除真实消费者。不存在真实相交关系时也不做机械全局重验。

## 10. 失败与恢复

所有 Operation terminal 使用统一事实边界：requested/unresolved/rejected/planned/blocked/admitted/executing/settling/completed/failed/recovery-required/rolled-back 等可映射到领域状态，但不能用一个 `done` 取代 Effect terminal 与 readback。

失败处理优先：

1. 保留 exact operation/effect identity；
2. 观察当前物理状态；
3. 判断 terminal/unknown/residue；
4. 只有在 idempotency/compensation/readback 条件成立时重试或回滚；
5. 否则 forward-recover 或保留人工处置 frontier。

## 11. 人与 AI 的相同强制边界

Human/AI/CLI/IDE 都不能绕过同一 canonical owner/authority/effect chain。AI 可以得到更小的 context projection和proposal权，但不能因“自主”获得新的事实权、执行权或 completion权。

用户明确授权扩大 Effect ceiling 也不能覆盖 semantic truth、Evidence honesty、durable integrity 等不可豁免不变量。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

SEC 的全局一致性由单写者、typed identity/relation、十职责无环静态依赖、资格链、capability注入、generation cutover、resource/support closure和真实settlement/readback共同产生；十职责默认是本地可嵌入的模块化单体责任分区，不是十个服务。可由结构防止的错误必须 fail closed，真实跨域变化也允许扩大影响范围。
