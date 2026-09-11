---
title: 跨实现数据寿命与异步结算
status: stable
domain: runtime-distribution
---

# 跨实现数据寿命与异步结算

本文拥有 native/Wasm/worker/device/remote 等实现边界上的数据表示、buffer/handle 生命周期、callback/取消和最后卸载的运行合同。它不决定采用哪个实现；Implementation Binding 已由 Compiler/Implementation Architecture 冻结。

## 1. 存在、只读、独占与可转移不同

跨边界访问至少区分：

| 模式 | 含义 | 最低条件 |
|---|---|---|
| value snapshot | 独立值副本 | 复制准确授权范围；捕获输入不重复 Effect |
| synchronous read borrow | 同步只读借用 | pointer/view 有效；相交期间无人写/搬移；callee不保留 |
| exclusive borrow | 有界原地访问 | 所有相交读写停止；失败后 ownership 可结算 |
| ownership transfer | 接管底层资源 | 所有 aliases/allocator/lifetime 同时处理 |
| synchronized share | 显式共享内存 | memory model、synchronization、publication、lifetime 合格 |

强引用/pin 只证明相应对象不被回收，不能证明没有别名写入。`readonly`类型或冻结 wrapper也不是跨线程内存屏障。

复制也不总保持语义：若两个输入原本 alias 同一可变位置，分别复制会破坏可观察 alias 关系。要么保持关系，要么改变公开合同并重新获得采用。

## 2. 视图与边界检查

对多维带步长视图，使用精确/checked integer 先计算可能访问的 byte envelope。设 allocation 长度 `N`、offset `o`、element width `w`、各维长度 `n_i`、byte stride `s_i`：

```text
lo = o + Σ min(0, (n_i - 1) * s_i)
hi = o + Σ max(0, (n_i - 1) * s_i) + w
required: 0 <= lo <= hi <= N
```

空维、零维scalar、负stride、零stride/broadcast分别处理。这个 envelope 只证明地址范围，不证明 alignment、initialization、pointer provenance、non-overlap 或 data-race freedom。

不能先用窄机器整数让 offset/length 溢出，再拿溢出后的较小值通过检查。

## 3. Wasm/host/native memory

运行边界必须知道 underlying memory 的真实规则。Memory growth/reallocation、ArrayBuffer transfer、native allocator、GC pin、device memory 等各有不同 invalidation/lifetime。

不得假设“旧视图总有效”，也不得为了安全一律复制全部 allocation。借用/zero-copy只在 target runtime 能证明相应 lifetime+alias条件时采用。

## 4. 异步调用生命周期

一个异步调用至少区分：

```text
accepted
result-settled
provider-will-no-longer-access-input
callback/frame-exited
queued-owned-payloads-settled
returned-resource-ownership-settled
provider/module-unload-safe
```

这些事实可以不同时间成立。`Promise resolved`、callback return 或 request被取消都不能自动推出最后一个事实。

### 先登记再启动

Provider 可能在 `start()` 返回前同步回调或完成，因此 caller 必须先登记 operation/callback/resource ownership，再调用 provider。检查 generation/handle validity 与取得 in-flight lease 必须是同一受保护操作，避免“检查后立刻卸载”的竞态。

## 5. Cancellation

取消只具有 provider contract 明确允许的效力：

- queued but not started 可删除；
- running work 可能仅设置 cooperative flag；
- native/device work 可能无法立即停止；
- remote request 可能已经被对方接受；
- completion callback 仍可能负责 cleanup。

因此取消后保留 Effect/Resource responsibility，直到真实终态或 recovery path 成立。Timeout 同理：它是 caller等待策略，不是世界状态。

## 6. Duplicate/late completion

Operation/request identity 必须防止：

- duplicate completion 二次结算；
- late old generation result 覆盖 new request；
- protocol rejection 被误当成原 accepted request 的 failure；
- duplicate resource pointer 二次 free；
- old callback 在 module unload 后调用已释放代码。

迟到结果若携带新的 owned resource，即使业务结果不再被采用，也必须执行相应 release/settlement。

## 7. 模块替换和最后卸载

新调用切到 Method B 后，旧 Method A 仍可能不能卸载：

- in-flight calls；
- queued callbacks；
- returned handles/resources 的 destructor 在A中；
- background/provider threads；
- allocator/private state；
- registered host callbacks。

A只有在这些责任全部为零，或资源已安全转换到新的 owner 后才能卸载。`active call count == 0`不是充分条件。

Load 本身也可能执行 initialization Effect；依赖库搜索、环境和实际装载闭包需要冻结/验证，不能只核主文件 hash。

## 8. 背压与结算容量

系统必须避免“业务输入占满所有额度，completion callback需要额外额度才能释放输入”的结算死锁。常见合法方案：

- admission 时保留 completion/cleanup credit；
- bounded two-pool budget；
- chunking/backpressure；
- 无环 wait-for discipline。

事后无限加大内存不是合同。

## 9. 结果所有权

返回结果至少声明：

- caller-owned value；
- provider-owned borrowed view；
- reference-counted/shared handle；
- explicit release handle；
- copy-on-return。

Provider升级/卸载必须考虑结果release代码所在 generation。为了允许早卸载可以复制/转换结果，但转换必须保持 identity/alias/precision且成本进入比较。

## 10. 失败分类

跨实现 fault 与业务 error 分开：

- decode/contract violation；
- business rejection；
- provider unavailable/crash/trap；
- resource exhausted；
- cancellation；
- partial/unknown Effect；
- cleanup/unload failure。

适配器不能 catch 全部 fault 后返回一个普通业务错误，从而让上层误判可重试/幂等。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

跨实现运行正确性以真实数据访问模式、alias、provider access、callback、returned resource与module generation的完整寿命结算为边界；取消、结果返回或入口撤销都不等于资源已安全释放。零拷贝和高性能只有在这些条件成立时采用。
