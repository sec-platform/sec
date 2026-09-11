---
title: 兼容、迁移、切换与退役
status: stable
domain: change-management
---

# 兼容、迁移、切换与退役

本文细化 Contract、Definition、Binding、schema/data、runtime generation、Provider与成品的兼容/迁移/退役。Change Management 不拥有业务语义本身；它比较old/new exact definitions与consumer requirements并产生transition obligations。

## 1. Compatibility 是关系，不是版本号属性

```text
Compatible(old, new, consumer, direction, context)
```

至少区分：

- source/authoring acceptance；
- semantic behavior；
- public API/type/error；
- serialization/schema/data；
- ABI/layout；
- protocol/wire；
- state/checkpoint；
- permission/security/privacy；
- resource/performance/deadline；
- deployment/support/toolchain。

SemVer、schemaVersion或package version只用于寻址其对应revision，不自证这些维度兼容。

## 2. Definition 与 default 演进

同一Definition identity升级后：

-显式固定参数保持其值；
-省略且采用new Definition的use-site继承new default；
-锁定old Definition的use-site继续旧解释；
-新增required parameter无default会使旧use-site不兼容；
- public `exposes`/subject关系改变需要consumer impact分析；
-只改private implementation不自动改变Authoring semantics。

因此“当前值一样”与“值来源一样”不同，升级传播需要保留来源。

## 3. Contract/API 演进

输入、结果、业务错误、fault、ordering、lifecycle、resource和permission都属于兼容面。返回类型名称相同不代表错误/取消/关闭兼容。

Adapter可以承担合法兼容差额，但不能隐藏semantic breaking change。例如把sync API转为async、把数学Int缩成i64、把exactly-once承诺降成at-least-once，都需要新合同/明确采用。

## 4. Implementation Binding 与 Provider 演进

Provider/implementation升级若保持Semantic Contract，不改写semantic revision；Binding revision、dependency closure和Evidence freshness变化。

切换遵循：

```text
qualify new Binding
→ materialize/verify new closure
→ establish safe cutover point
→ route new work to new generation
→ settle old in-flight work/resources/results
→ consumer/effect/resource zero
→ retire old closure
```

旧请求不热切到新方法。Returned handles/destructor仍依赖旧模块时，旧模块继续保留。

## 5. Data/schema migration

迁移设计至少定义：

- source/target schema revisions；
- total/partial transform；
- validation invariant；
- identity/key preservation；
- handling of unknown/legacy data；
- write/read cutover；
- concurrent changes/log catch-up；
- reversibility条件；
- readback/verification；
- cleanup/retention。

可逆代码不代表所有实际数据可逆。例如ms→s会丢信息；只有满足整除条件的数据可 exact reverse。

在线迁移若没有跨系统原子能力，选择明确较弱协议（shadow/dual-write/log catch-up/barrier/saga），不能用“atomic”标签补能力。

## 6. Dynamic state/topology migration

State machine/stream/runtime升级需要映射：

- active state/configuration；
- queued events/messages；
- timers/time origin；
- activities/in-flight work；
- checkpoints/source positions；
- resource ownership；
- old callbacks/results。

缺映射时可以保留old generation直到自然结束，或明确停机迁移；不能猜测同名state就表示同一运行位置。

## 7. 热替换边界

默认是**new instance / new generation**。只有存在真实 safe point，且 state/resource/code-pointer mapping 完整时才热替换。

热替换成功要求：

- no executing frames in replaced code or supported patch mechanism；
- compatible public contracts；
- state transform verified；
- callbacks/destructors rebound or old module retained；
- external Effects not replayed；
- rollback/forward recovery defined。

Debug time travel/replay在隔离环境中进行；不能重播收费、真实写盘、远端提交等外部Effect来“恢复历史”。

## 8. Deployment cutover

发布/部署区分：artifact built、installed、ready、traffic adopted、healthy、old retired。Blue/green/canary等只是实现策略。

切换需真实readback：

- target image/config identity；
- health/readiness；
- traffic/consumer routing；
- persistent state compatibility；
- rollback target；
- old generation drain。

上传artifact或deployment API exit0不等于adoption terminal。

## 9. Retirement

删除旧definition/provider/parser/adapter/schema/version前证明：

```text
consumer-zero
AND effect-zero
AND recovery-zero
AND retained-data/read obligation satisfied
AND support/migration horizon closed
```

“仓库里搜不到import”不是完整consumer-zero；外部消费者、durable data、old artifacts、recovery records都可能继续需要旧reader/ABI/destructor。

历史协议只在真实consumer/support window存在时保留。为了“信息不丢”永久双读、alias或兼容路径属于设计债，不是正确迁移。

## 10. Failure/recovery

Migration/upgrade operation记录 exact preimage、intended target、effects/receipts和unknown frontier。Crash后先观察当前状态，再决定resume/compensate/rollback/forward-recover。

如果 Effect 是否发生未知，禁止blind replay。Rollback只在能证明exact prior state恢复时签发`rolled-back`；否则保留residue/recovery-required。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

兼容性是old/new/consumer/context之间的多维关系；Definition、Binding、data、runtime generation和deployment按各自identity演进。切换只影响new work，old work/resources在consumer/effect/resource-zero前保持；迁移和退役以readback与真实consumer闭合为准，不以版本号、文件删除或永久兼容壳代替。
