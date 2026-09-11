---
title: 增量编译、变换接纳与目标发射
status: stable
domain: compiler-target-ir
---

# 增量编译、变换接纳与目标发射

本文细化 pure compiler 内的增量、缓存、Pass 接纳、分析失效、source mapping 与 Target emission。它不拥有物理工作区写入、手工源 round-trip 或 Operation Effect；这些由 Implementation Architecture / Workspace Evolution / Runtime owner 承担。

## 1. Clean 与 incremental 必须等价

对同一冻结输入：

```text
CleanCompile(input) == IncrementalCompile(input, validCache)
```

这里“==”按该 artifact 的 canonical identity/bytes/meaning 定义。Incremental 只能跳过可证明未受影响的工作，不能拥有较弱的 validator、eligibility、tie-break、source mapping 或 verification planning。

Cache 是可删除加速物，不是 authority。读取失败、key unknown 或依赖漂移时 clean recompute。

## 2. 增量 key 只含真实语义依赖

一个缓存节点的 key 来自其实际消费者读取：

- exact content/input revisions；
- validated semantic/Application/Behavior/Target revisions；
- ImplementationBinding closure；
- pass/options/backend identity；
- relevant Target/Profile/toolchain premises；
- proof/evidence freshness only when result consumes it。

文档 locator、未读取 metadata 或无消费者的字段不应强制重编译。相反，共享环境、allocator、queue、ABI 或 cost model 实际参与结果时，即使没有显式 data edge 也必须纳入依赖。

“源 bytes 未变”只有在上游 semantic producer 能证明消费者所读语义未变时才允许替代重读；否则保守重算。

## 3. 分析失效按性质而非文件判断

类型、CFG、range、alias、Effect、resource、cost、binding 等分析分别拥有 invalidation rule。一个 Pass 改 `y=x` 为 `y=x+16`，CFG 可以完全不变，但 range 已改变。

如果分析 B 依赖 A，A 失效则 B 必须更新/失效。旧结果仍是保守上界时可以保留为 `conservative`，不能继续标成 exact 再用于等价优化。

IR node identity 不能由内存地址继承；删除后新对象复用同一地址不获得旧分析 cache。

## 4. Pass 在私有候选上运行

成熟工具可能“先修改 IR，再返回失败”。因此每个可能失败的变换遵循：

```text
frozen accepted input
→ acquire private writable candidate or proven exclusive ownership
→ run transform
→ validate stage invariants
→ validate required semantic/property preservation
→ update/invalidate analyses
→ atomically publish accepted candidate
```

失败候选不发布，后续 Pass 不得消费半合法状态。可选优化失败时，如果原方法仍满足目标，可以保留原结果并报告优化未采用；明确要求该变换时则任务未完成。

不要求每次深拷贝全工程：结构共享、region clone、COW 或 exclusive ownership 都可以，只要其他 observer 永远看不到未接纳的中间状态。

## 5. Target Program 接纳

Target Program promotion 前必须闭合：

- upstream semantic/Application/Behavior validity；
- exact Target Profile/Type mapping；
- exact ImplementationBinding；
- public contract mapping；
- module/artifact/symbol ownership；
- unsupported/unknown/conflicted resolution；
- source/provenance map；
- required imports/resources/verification plans。

Backend 不重新选择 Provider，不读取 live registry，不修改产品要求。不能物化的节点停在 typed frontier，不打印 TODO/placeholder 冒充成品。

## 6. 成品根与最小闭包

同一 Behavior root 可以生成多个 consumer roots（library/CLI/service/plugin等）。编译器先形成共享实现闭包，再按每个 root 的实际消费合同增加 adapter/member：

```text
SharedSemanticBehavior
      ↓
Exact ImplementationBinding
      ↓
Shared implementation units
  ├─ library surface
  ├─ process/CLI surface
  └─ other requested consumer surfaces
```

一个 public rename 不强制生成 runtime forwarding function；只有 ABI/encoding/error/lifecycle/isolation/stable facade 存在真实差额时才生成 adapter。

每个 root 独立结算。某个插件宿主缺失不删除已经完成的 library root；共同发行要求所有 roots 时，共同发行仍不完整。

## 7. Source mapping 与诊断

每个生成节点保留最小但足够的 provenance：

```text
Target span/symbol
→ Target Program node
→ Binding/implementation unit
→ semantic obligation / author source span
```

诊断必须区分：作者源无效、semantic conflict、missing/unknown supply、Target unsupported、Backend failure、physical materialization failure。不能把下游缺方法推回成“请作者手写底层实现”。

多个作者 source/Definition 组合到一个目标成员时，mapping 可以是多源集合；生成格式化后仍需回到逻辑 token/span，而不是依赖字符偏移永远不变。

## 8. 生成物手改与 round-trip 边界

Compiler 只拥有 canonical generated target。目标代码手改后的处理由 Implementation Architecture 的 source ownership/round-trip 决定：

- generated-managed region：手改先成为 drift/candidate；
- 可准确逆变换的 edit 回到唯一作者 owner；
- 用户明确接管时转换 ownership；
- unknown region 不被猜测式覆盖。

Compiler 不因为看到当前目标源码就自动把它反向提升为产品语义。

## 9. 目标发射与 deterministic bytes

Bytes 只由冻结 Target Program、Binding、Target Profile、Backend identity 和 canonical source policy 决定。Locale、timezone、cwd、wall clock、Map iteration、temp path 等 ambient state 不污染 bytes。

Formatter 是 pure semantics-preserving projection；若 formatter 可能改义，它必须作为 Compiler transform 接受同样 validation，而不是“后处理”。

## 10. 变换验收反例

- Pass 返回失败但修改过候选：候选丢弃，原输入仍可用；
- 控制流没改但数值范围改：range 失效；
- 分支条件改变但 public signature 不变：行为/coverage 重核；
- 只移动文档/locator：不触发语义重编译；
- Backend version 改变：bytes/cache失效，即使 semantic revision 不变；
- 新候选出现但 binding policy 是 sticky qualified：无需重选；
- target root 未请求 Worker：不生成 Worker adapter/queue/runtime。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

增量编译与 clean 编译共享同一语义、资格和 Target 接纳；Pass 只在私有候选上修改并原子发布；分析按实际依赖失效；Backend 不重选实现；多种成品从同一冻结语义/Binding生成最小且完整的独立 consumer roots。
