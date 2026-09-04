---
title: 推导闭包、ActionKey 与局部失效
status: stable
domain: system-architecture
---

# 推导闭包、ActionKey 与局部失效

本文拥有纯推导与可复用计算的**局部输入 identity**、ActionKey、reverse-reachable invalidation 与 publication lineage 分离。具体 Source Program、Documentation、Verification、Compiler 等 owner 只实例化本合同，不得各自把整个全局 generation 当成局部计算输入。

## 1. 三种 identity 不得混用

```text
SemanticIdentity        = 对象是谁
ComputationInputClosure = 本次结果实际读了哪些不可变输入
PublicationGeneration   = 哪一组兼容 revisions 被一次发布/读回
```

一个 computation 可以来自某个 PublicationGeneration，但只有它**实际观察的 closure**决定纯结果 identity。把全局 generation ref 无条件写进每个 ActionKey 会让任意无关变化造成全局 cache miss。

## 2. Exact reachable input closure

```text
ComputationInputClosure = leastFixedPoint(
  requested output/Claim roots,
  exact dependency policy,
  immutable semantic/content/config/provider inputs
)
```

closure 必须记录：

- root refs；
-实际读取的 semantic/content shards；
-会改变结果的 config/policy/profile；
-实际依赖的 provider/environment semantics；
- opaque/unknown frontier；
- closure compiler revision。

它不包含：branch、PR、wall clock、temp path、所在全局 generation、无关 sibling、presentation order，除非目标算法确实观察它们。

## 3. Canonical ActionKey

```text
ActionKey = digest(
  algorithm/compiler identity,
  exact ComputationInputClosure refs,
  applicable policy/profile refs,
  exact provider/environment semantics actually observed
)
```

`PublicationGenerationRef`只在两种情况下进入 key：

1. computation 的 contract 明确观察整个 generation；
2. generation本身就是被验证的 Subject。

否则它只进入 provenance/receipt：

```text
DerivationReceipt = {
  actionKey,
  resultRef,
  sourcePublicationGenerationRefs,
  exactInputClosureRef,
  coverageAndFrontierRefs,
  producerRef
}
```

lineage变化不自动改变 ActionKey；输入 closure变化才改变。

## 4. 局部失效

```text
InvalidatedActions(delta) = reverseReachable(
  changed exact input identities,
  computation dependency graph
)
```

新事实、文件、Document、Provider、Target、policy只有在进入某 Action 的 actual closure 时才使其 stale。删除或修改无关 sibling 必须保持：

```text
same ActionKey
same canonical result
same Claim semantics
```

若实现因为全局 generation hash 改变而 miss，但 clean 结果 byte-identical，属于 `global-generation-contamination`，不是合法 conservative invalidation。

## 5. Incremental 与 clean

```text
IncrementalCorrect(action) =
  result(incremental, actionKey) == result(clean, actionKey)
  and changed unrelated input leaves actionKey unchanged
  and every relevant changed input invalidates
  and cache/service loss changes only cost
```

增量算法可以使用更大的内部 warm state，但它不能扩大 semantic key；warm state只能作为 AccelerationSeed。

## 6. Unknown frontier

无法证明某动态输入是否影响结果时，该边界进入 `unknown dependency frontier`。安全选择可以扩大 affected closure，但必须把扩大原因显式保留；不能通过把整个 repository/generation 永久塞进每个 key 来“解决”未知。

当新 frontend/analysis 后来证明依赖边界时，只更新依赖该 unknown frontier 的 actions。

## 7. 典型实例

### Source semantic check

错误：

```text
SemanticCheckActionKey = SourceObservationGenerationRef + ...
```

如果 generation 包含无关文件，这会全局失效。

目标：

```text
SemanticCheckActionKey =
  reachable source/config/dependency fact shards
  + checker/provider semantics
  + target/environment facts actually observed
```

### Documentation projection

错误：

```text
ProjectionKey = whole DocumentationGenerationRef + query
```

目标：

```text
ProjectionKey =
  purpose closure refs
  + disclosure refs
  + address refs actually rendered
  + renderer contract
```

全局 DocumentationGeneration 只进入 lineage receipt；无关文档变化不重渲染该 view。

### Verification

Review/Promotion可以因为 Git transport generation变化而需要重新绑定，但纯 semantic Action 若 exact content closure不变可以复用。不同 consumer identity 不得被压成一个全局“全部 stale / 全部 reuse”开关。

## 8. 新信息的局部吸收

未来发现缺失输入 x：

```text
x
→ 注册为 typed input/relation
→ 更新真正受 x 影响的 closure compiler edge
→ invalidate reverseReachable(x)
→ unaffected ActionKeys保持 byte-identical
```

禁止：

```text
发现 x
→ 给所有 ActionKey 增加 globalXRevision
→ 全仓重新执行
```

除非证明 x 对所有 actions 都是共同因果输入。

## 9. 完成

```text
DerivationLocalityClosed =
  every reusable result binds an exact reachable input closure
  and publication lineage is separate from computation identity
  and unrelated changes preserve ActionKey/result
  and relevant changes invalidate every dependent action
  and unknown dependency frontiers are explicit and removable
  and clean/incremental/cache-disabled are equivalent for the same key
```

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

可复用计算的ActionKey只绑定实际可达的semantic/content/config/provider输入闭包；全局publication generation默认只属于provenance。新增信息只给真正依赖它的closure增加typed edge并反向局部失效，禁止用global generation revision制造全仓cache miss。
