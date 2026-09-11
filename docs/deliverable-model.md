---
title: 成品与消费边界
status: stable
domain: deliverable-model
---

# 成品与消费边界

本文唯一拥有“一个开发结果作为某种**消费形态**时需要对消费者承诺什么，以及何时该消费合同算完整”。作者定义需要什么产品行为，Deliverable Model定义消费者看到的形态合同，Compiler/Implementation Resolution选择并降低实现，Backend/Runtime物化和运行它。各层不得共享同一事实 owner。

成品形态不是一个 `mode` 字符串，也不是核心封闭枚举。它由正交条件构成：

```text
DeliverableContract =
  semantic root refs
  + public consumer semantics
  + lifecycle/failure/recovery obligations
  + host import obligations
  + artifact membership requirements
  + verification obligations
```

Target/Profile、ImplementationBinding、实际 symbol/ABI/route/file bytes 是下游 realization input/result，不反向成为 DeliverableContract 的作者语义。

## 1. 五个必须分开的边界

| Boundary | 唯一 owner | 不能推出 |
| --- | --- | --- |
| Author module export | Authoring Model | 已存在 runtime symbol |
| Definition `exposes` | Authoring Model | 已创建 process/object |
| Deliverable consumer contract | Deliverable Model | 已选具体语言/ABI/实现 |
| Target interface realization | Compiler / exact Implementation Binding | 实现已验证、宿主已可用 |
| Distribution/artifact members | Backend / Distribution owner | 已安装、启动、部署或采用 |

同一名称可以有明确映射，但不能因此把两个边界合并为同一 identity/owner。例如“normalize”可以同时是作者公开角色、Library symbol和CLI operation display name；它们的引用关系必须显式存在。

## 2. 三种正常作者情形

**完整复用**：已有库/程序/定义满足要求，成品可以直接绑定/re-export，不强制生成包装层。

**只写差额**：行为已足够，只需改变编码、公开名、启动方式、生命周期或 Target；只实现真实差额。

**新行为**：作者定义独立 Requirement，由供给侧寻找成熟实现或创作实现；不把底层算法自动转嫁给产品作者。

三个情形可以在同一产品中同时出现。

## 3. 完整性的四个层级

必须分别陈述：

```text
AuthorDesignClosed
DeliverableContractClosed
ImplementationClosed
VerifiedAndAdopted
```

- **AuthorDesignClosed**：产品行为、输入/结果/失败/状态及作者公开决定无待猜项；由 Authoring/semantic owners判断。
- **DeliverableContractClosed**：实际消费者的入口语义、lifecycle、Host Imports、需要交付的成员类别和验证义务已经确定；由本文判断。
- **ImplementationClosed**：具体 Target interface、实现、adapter、依赖、资源和实际 artifact members 存在并绑定；由 Compiler/Implementation Architecture/Backend判断。
- **VerifiedAndAdopted**：所要求 Claim 在准确环境取得 Evidence，并完成真实采用/发布/部署；由 Verification/Delivery等真实owner判断。

规格包可以在没有运行实现时完成自己的交付；可运行 Library 只有 `.d.ts` 则不完整；Handler 合同完整不等于独立 Service 已监听；构建 Firmware image 不等于已刷写且满足实时条件。

## 4. 成品合同闭合门槛

对每个被选择的消费形态，Deliverable Model必须能回答：

1. 谁消费、消费动作是什么；
2. 输入 value/type/encoding/untrusted decode 的语义要求；
3. 成功结果和业务拒绝；
4. transport/runtime/internal failure 对消费者如何表现；
5. 是否有 state、instance identity、concurrency/order；
6. cancel/timeout/close/termination 怎样结算；
7. 哪些资源由成品拥有、借用或转移；
8. 哪些 capability/import 是合法 Host Import；
9. 哪些成员类别必须存在于最终交付；
10. 哪些 Requirement/Claim 必须在交付前验证；
11. 再次修改时哪些消费合同会失效；
12. 不满足时是 incomplete、unsupported、blocked 还是 failed。

这里定义的是**消费者可依赖的语义**。具体文件名、函数符号、ABI布局、路由实现、package manifest字段和部署位置由下游 Target/Backend 按该合同实现，不能回写本文成为第二实现模型。

缺任何与该形态实际相关的项，都不能仅因“目录/接口存在”声明完整。

## 5. 公共导入与内部闭合

可复用组件可以把明确的 Host Import 留给消费者满足，例如：
- allocator；
- clock；
- network transport；
- filesystem capability；
- logger/telemetry sink；
- scheduler；
- secret reference resolver。

该 import 必须有类型、Effect、lifetime 和 failure contract。请求“独立运行应用”时，必需 import 必须在部署/启动前被真实满足或成为明确 deployment prerequisite；不能留下无界 TODO。

Host Import 的实际 Target representation、Provider和Binding由下游owner选择；Deliverable Model只声明消费者/宿主之间需要成立的公开合同。

## 6. 最小适配原则

已有实现的公开 boundary 已精确满足时，直接使用或 re-export。只在以下差额真实存在时生成 Adapter：

- value/serialization mapping；
- error vocabulary；
- sync/async shape；
- lifecycle/init/close；
- ABI/FFI/Wasm/process boundary；
- isolation/security；
- state/resource ownership；
- stable public facade。

转发函数不是安全边界。一个“thin wrapper”跨了状态、时钟、资源、异常、权限或共享内存时，仍要满足完整合同。

适配器是否需要、放在哪里、用什么语言由 Implementation Architecture 决定；本文只给出不能改变的 consumer observations。

## 7. 多根与共同发行

同一行为可产生 Library、CLI、Service、Plugin、UI 等多个独立 root。它们可以共享不可变实现和资源，但不能因共享代码而合并产品 identity 或 state instance。

```text
IndependentDeliverableContractClosed(root)
CommonReleaseContractClosed =
  all required deliverable contracts closed
  AND all declared shared-member/config/resource obligations compatible
```

一个 root 缺宿主不抹掉另一个已实现 root；请求共同发行时则仍报告共同缺项。实际 root 是否 ImplementationClosed/Verified 由下游各自判断，不能由本文的合同闭合冒领。

## 8. 再次修改

- 改共享行为 Requirement：所有消费该行为的 root 重核其 Deliverable Contract 与实现。
- 只改 CLI encoding：Library 的消费合同不变；共享实现只在真实依赖相交时重核。
- 只换私有实现：Deliverable Contract 可保持，但 exact Binding/Artifact/Evidence 更新。
- 新增一种成品：共享行为不重复创作，新增该消费合同及下游 realization。
- 改默认值：显式 pin 的消费者保持；真正沿默认的使用点采用新定义后才变化。
- 改 Target/Profile：不改 Deliverable consumer semantics，但 Target/Implementation/Artifact/Verification 相交部分失效；若新Target无法实现合同则该realization blocked/unsupported。

## 9. 当前已设计消费家族

下列不是核心 enum，而是已经定义了完整消费语义的家族：
- specification/value/resource；
- expression/context patch；
- Library/SDK/protocol client；
- CLI/batch；
- Handler/Service；
- Worker/Component/Plugin；
- Web/Desktop/Mobile；
- family/common release；
- query/batch data/stream；
- migration；
- compiler/analyzer/generator；
- inference/trainer/sampler/optimizer；
- GPU/Firmware/RealTime；
- installer/deployment；
- governed change to existing native project。

详见：
- [软件、服务、插件与交互成品](deliverable-model/software-forms.md)
- [数据、工具、模型、设备与部署成品](deliverable-model/data-model-device-forms.md)

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

Deliverable Model只拥有消费者可依赖的成品形态合同；作者出口、逻辑公开主体、消费合同、Target接口实现和发行成员各有唯一owner。完整性按作者设计、Deliverable合同、实现、验证/采用四层判断；共享行为可产生多种独立成品而不重复算法，也不能由合同闭合或局部成功冒领实际实现与共同发行。
