---
title: 资源维度、Accounting Mode 与守恒
status: stable
domain: system-architecture
---

# 资源维度、Accounting Mode 与守恒

本文拥有通用资源维度、accounting mode、reservation/measurement/settlement 语义。Operation owner 只声明 Requirement 与 ceiling；Implementation/Provider 只物化已准入 allocation。新增资源种类只登记一个新的 `ResourceDimensionContract`，不得修改中央 Operation/Provider switch。

## 1. 为什么资源不能只有一种 Consume/Return

CPU time、累计 I/O bytes 是不可返还的累计消耗；process slot、lock、connection 是可释放 lease；resident memory 是随时间上下波动并需要 peak 的 gauge；token bucket/QPS 会随时间补充；外部 quota 可能只能由 Provider readback 判定。

因此“`Consume` 单调增加且只返还 unused reservation”只适用于 consumable，不是所有资源的第一性规律。

```text
ResourceAccountingMode =
  | Consumable
  | Lease
  | Gauge
  | ReplenishingRate
  | ExternalQuota
```

## 2. ResourceDimensionContract

```text
ResourceDimensionContract = exact {
  dimensionRef,
  unitRef,
  accountingMode,
  reservationSemantics,
  measurementSemantics,
  aggregationSemantics,
  releaseOrReplenishmentSemantics,
  settlementPredicateRef,
  overflowAndUnknownSemantics,
  providerReadbackRequirementRef | none
}
```

单位、mode 与 aggregation 是合同的一部分。不同单位或 mode 不允许靠字段名相同合并。

### Consumable

```text
reserve <= parent remaining ceiling
consumed(t2) >= consumed(t1)
remaining = ceiling - consumed - outstanding reservations
release only returns reservation that never became consumed
```

适用：CPU time、累计输入/输出 bytes、请求次数、retry units。

### Lease

```text
acquire => occupied += amount
release => occupied -= amount
0 <= occupied <= reserved <= parent capacity
terminal requires every owned lease released or retained as typed residue
```

适用：process/task slots、locks、connections、handles、exclusive permits。

### Gauge

```text
current(t) may increase or decrease
peak = max(previous peak, current)
current <= admitted ceiling
terminal requires current == baseline-or-owned-residue
```

适用：resident/buffered memory、temporary disk occupancy、open-handle count。

### ReplenishingRate

```text
available(t) = min(capacity, priorAvailable + refill(t) - admittedConsumption)
```

refill 规则、clock source、burst/window 都必须显式进入 contract；caller 不能通过 retry 重置窗口。

### ExternalQuota

本地 ledger 只能保存已准入 reservation 与观察 frontier；Provider authoritative quota 必须按 exact principal/endpoint/epoch readback。未知 quota 不得当成 unlimited 或 zero。

## 3. Parent ledger

```text
OperationResourceLedger = exact {
  operationRef,
  absoluteMonotonicDeadline,
  dimensionContracts,
  parentCeilings,
  reservations,
  measurements,
  activeLeasesAndGauges,
  residues,
  ledgerRevision
}
```

每个 child 只能消费 parent 已存在且 mode-compatible 的 dimension。新的 Provider-specific dimension通过 typed extension登记；若 parent 没有该维度，结果是 Requirement unresolved/unsupported，而不是给核心加品牌分支。

## 4. 通用操作是按 mode dispatch，不按资源名称 dispatch

```text
reserve(dimension, demand)
measure(dimension, observation)
release(dimension, ownedLeaseOrReservation)
settle(dimension)
```

这些操作首先读取 `dimension.accountingMode`，再调用该 mode 的唯一 algebra。禁止出现：

```text
if resource == "memory" ...
if provider == "docker" ...
```

新资源只需新的 DimensionContract 或已有 mode 的实例，不改 Operation System。

## 5. Deadline 是独立时间边界

absolute monotonic deadline不是可返还 capacity：它只随时间收窄。所有 lock、discovery、scan、child、retry、cleanup、readback、recovery共享同一 parent deadline；任何 child-local duration ceiling只能进一步收窄。

## 6. 并发与转移

Allocation可以在 child 间转移未消费 reservation或已释放 lease，但必须由 parent allocator线性化并保持总量不超 ceiling。运行中的 lease不能靠复制 receipt 被两个 child同时拥有；跨 operation 转移需要新的 owner-issued allocation。

## 7. Unknown 与故障

以下均不能降为“资源仍有”：

- measurement provider unavailable；
- lease release结果未知；
- external quota freshness过期；
- gauge readback不完整；
- arithmetic overflow/单位不匹配；
- parent ledger revision漂移。

它们产生 `unresolved | residue | blocked`，并只影响依赖该 dimension 的 execution closure。

## 8. 局部演进不变量

未来新增 GPU memory、file descriptor、database connection、API token、GPU stream 或新 Provider quota 时：

```text
new dimension
→ declare ResourceDimensionContract
→ select existing accounting mode or add one genuinely new algebra
→ add Provider measurement/binding
→ only reverse-reachable plans/actions stale
```

只有出现无法由五种 mode 表达的新状态转移语义时才演进 mode algebra；新增品牌、单位或实例不能修改根模型。

## 9. 完成

```text
ResourceAccountingClosed =
  every demanded dimension has one contract and unit
  and every allocation is parent-bounded and mode-compatible
  and consumable/lease/gauge/rate/quota obey distinct laws
  and deadline never resets
  and every terminal settles owned reservations/leases/gauges or records typed residue
  and unknown never becomes capacity
```

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

资源守恒不是统一的单调`Consume/Return`；每个ResourceDimension先声明`Consumable | Lease | Gauge | ReplenishingRate | ExternalQuota` accounting mode，再由唯一mode algebra执行reserve/measure/release/settle。新增资源实例只新增DimensionContract并局部失效依赖闭包，不修改中央Operation或Provider分支。
