---
title: 实现供给、接合与系统装配
status: stable
domain: implementation-architecture
---

# 实现供给、接合与系统装配

本文拥有“一个已选语义义务如何映射到现有/新实现单元并装配成可消费目标”的实现架构。Implementation Resolution 的候选资格/选择由 Compiler owner 拥有；这里拥有供给形态、物理接合、适配、共享/实例化和运行装配责任。

## 1. 实现供给不等于语言

合法供给至少包括：

| 供给 | 典型内容 | 必须闭合的接缝 |
|---|---|---|
| 原生源码/源码包 | TS/Rust/C/Java/Python等实际模块 | toolchain、exports、effects、assets、dependencies |
| 预构建库 | static/shared library、runtime component | ABI、platform、runtime libs、load/unload、allocator |
| Wasm/component | module + imports/exports | value encoding、memory、trap、resource、host capabilities |
| 进程/worker | executable + protocol | codec、queue、backpressure、cancel、crash、partial output |
| GPU/device kernel | kernel/image | layout、transfer、queue/sync、precision、completion |
| Remote Provider | versioned service capability | endpoint/principal、protocol、privacy、timeout、idempotency、readback |
| Generator/template | deterministic producer | implicit reads、output ownership、follow-up validation |
| optional neutral computation | explicitly chosen semantic body | reader/type/effect/target preservation |

产品作者不因为采用某种供给就维护其全部底层代码。成熟供给满足合同则直接复用；只在真实差额存在时生成 adapter。

## 2. 实现单元和责任

`ImplementationUnit` 是物理/语言单位，`ResponsibilityRealization` 是实现责任；两者不是一对一。一个责任可以由多个 unit 共同实现，一个 reusable unit 也可被多个独立实例消费，但不能因此共享未授权 mutable state。

装配关系至少区分：

- semantic responsibility / use-site；
- selected method/candidate；
- implementation unit；
- adapter；
- public import/export；
- runtime instance/resource；
- artifact member；
- verification/conformance obligation。

路径、package或class名只是 address/binding，不产生 meaning。

## 3. 适配原则

如果现有供给已经精确满足 public contract，直接导入或重导出。Adapter 只用于真实差额：

- value/encoding；
- error/fault；
- sync/async；
- ABI/calling convention；
- initialization/lifecycle；
- isolation/permission；
- stable facade；
- resource ownership。

转发函数本身不是安全边界。跨独占资源、共享状态、时钟、权限或外部 Effect 的 adapter 必须拥有真实机制和验证。

同步 public API 不能为了采用更快 worker 偷偷变成 Promise；精确整数不能未经限制改为 float；character position 不可默认为宿主 offset。

## 4. 系统装配不是一个永久运行平台

同一逻辑核心可按需求装配为：

- in-process SDK/CLI；
- short-lived command；
- warm worker/service；
- isolated process/Wasm；
- remote/hosted provider。

没有恢复、并发、隔离或长期状态要求的小任务不强制启动守护进程、数据库、消息总线或控制平面。

所谓十个 logical responsibilities 是责任分区，不是十个服务。可以在一个进程/包内共存，只要 owner、state和调用边界不混淆。

## 5. Engine/Image 与请求绑定

一次请求/operation需要冻结它实际使用的解释与实现 generation：

```text
EngineImage = exact {
  semantic/interpretation refs,
  ImplementationBindings,
  loaded methods/adapters,
  Target/runtime premises,
  generation identity
}
```

新 generation 发布后，不热切换已经开始的请求。旧 request/result/resource 继续绑定原 image，直到其责任结算。只在真实 safe point + state/resource mapping 存在时才进行热替换。

Image 是实现装配视图，不是新的 semantic owner，也不要求所有程序存在一个全局运行 image。

## 6. 共享方法与独立实例

同一 method 可以覆盖多个 use-sites。允许共享：

- immutable code；
- truly immutable tables/assets；
- explicitly shareable caches whose key/eviction/security contract is valid。

不得自动共享：

- subject identity；
- mutable state；
- random stream；
- authorization/grant；
- transaction/session；
- lifetime/close state。

内容相同的两个 stateful Definition 实例仍然是两个实例。

## 7. 物理接合与依赖

装配前要回答：

- 谁提供入口/符号/endpoint；
- 哪个 target/runtime 能调用；
- initialization/close 由谁承担；
- dependencies 在内部闭合还是 public import；
- exact provider/version/integrity/config；
- assets/native/runtime dependencies；
- failure/cancel/readback；
- license/support/security constraints。

Package manager 或下载器只提供 materialization capability，不参与产品实现选择。

## 8. 性能供给与分段优化

允许系统的一部分先用 TS/已有实现，瓶颈区使用 native/Wasm/GPU/remote 实现。替换单位应是有意义的计算/责任区域，而不是把每个标量操作跨边界调用。

实际收益比较包含：

```text
kernel compute
+ marshal/copy
+ scheduling/queue
+ cold start/load
+ synchronization
+ memory peak
+ failure/cleanup
+ maintenance/toolchain cost
```

“内核更快”但总成本更高时不应采用。没有 evidence 时，保留已合格基线是正常结果。

## 9. 装配完成判据

一个目标根的实现装配闭合要求：

1. 每个 semantic/public obligation 有 implementation realization 或明确 public import；
2. 每个 realization 绑定 exact implementation units；
3. adapters 的差额和假设明确；
4. dependencies/assets/runtime imports 可获得；
5. public interface/lifecycle/failure/resource 保持；
6. unknown/unsupported 不被 placeholder 掩盖；
7. artifact members 完整；
8. conformance obligations 已形成，但是否 PASS 仍由 Verification owner 决定。

## 10. 原生源码与 SEC 自身

SEC 自身也允许保留原生 TS/Bun 实现。Self-hosting 的含义是 SEC 能用自己的 canonical semantics、resolution、target/conformance机制管理自身工程，而不是必须用新语言重写全部源码。

已有源码满足新合同则直接 Adopt/Bind；需要迁移时通过 target/current reconciliation 与单写者 cutover，不能长期维护“旧实现路径+新实现路径”双权威。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

SEC 的实现供给可以来自原生源码、库、Wasm、进程、设备、远端或生成器；实现选择仍由统一 Resolution 完成，Implementation Architecture 只负责把 exact Binding 接合为最小且完整的真实实现单元、适配、依赖和运行装配。不存在强制单语言、强制服务化或强制重写。
