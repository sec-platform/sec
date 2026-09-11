---
title: 数据、工具、模型、设备与部署成品
status: stable
domain: deliverable-model
---

# 数据、工具、模型、设备与部署成品

本文只细化这些形态作为**可消费成品**时必须公开的 boundary、lifecycle、failure 和完成语义；它不接管底层 Query/Stream/Migration/Compiler/Deployment 等领域算法。底层行为由 Domain Semantics、Compiler、Change Management、Runtime/Distribution、Verification 等实际 owner 定义，成品合同通过 typed refs 消费它们。

## 1. Specification / policy / model package

可以在没有 runtime implementation 时作为完整**规格交付**，前提是：
- exported definition/contract 可解析；
- identity/revision/parameters/public subjects 完整；
- interpretation dependencies 可取得；
- unknown/frontier 明确；
- 不被标成可运行软件。

## 2. Static value / configuration / resource

需要 exact value/bytes、encoding/unit、consumer applicability、source/provenance、member identity。类型正确不证明业务值适用。

资源 bundle 必须有完整成员规则；不存在的 optional resource 不生成空占位。资源更新与代码更新是否共同原子由实际消费者/Change owner决定。

## 3. Expression / function / context patch

表达式/函数成品保留 free-variable/environment contract、evaluation count、effects 和 target type。

Context patch 还必须绑定 exact preimage/region、syntax/semantic boundary 和 surrounding ABI/control assumptions。脱离原上下文即失去等义资格；冲突时保留候选，不在未知 base 上硬贴。

## 4. Query

Query 成品的消费者合同必须固定：
- source snapshot/coverage requirement；
- predicate/order/group semantic refs；
- duplicate/null/unknown observations；
- page/cursor public semantics；
- error/timeout/cancel。

空结果只有在 required coverage complete 时才能向消费者表示“没有”；源读取失败/权限不足/部分扫描是 unknown/unavailable。

Cursor 绑定 query + source snapshot + position；源 revision 变化不能拿旧 cursor 接到最新数据。实际查询代数由 Domain Semantics/数据owner定义，不由成品接口重新定义。

## 5. Batch data

BatchData 交付合同定义：
- exact input/member identity；
- partition/shard rule ref；
- ordering；
- per-part checksum/schema；
- recomposition completeness；
- partial failure/resume。

分片只保存起始位置不足以重建 interleaved partition；必须有 step/index mapping 或 explicit member identities。重组不得丢重复、顺序和 provenance。实际 partition算法由其数据/实现owner拥有。

## 6. Continuous stream

Stream 成品必须向消费者公开：
- event identity and business identity distinction；
- partition/membership generation；
- order guarantee；
- event time / processing time contract refs；
- watermark/frontier observation；
- lateness policy；
- backpressure/credit；
- checkpoint handle/state contract；
- sink acknowledgement；
- replay/idempotency。

静默超时不能证明以后不会出现更早 event time。返回 callback 不代表 downstream effect committed；只有真实 ack/settlement 才推进相应责任。

Checkpoint 的底层状态/位置/未确认输出语义由 Stream/Runtime owner定义；成品只规定消费者如何取得、恢复和判断其兼容性。改变 window/aggregation semantics 通常要求对应 state evolution，不能把旧 checkpoint 直接按新解释使用。

## 7. Migration deliverable

Migration 作为成品，是**Change Management migration operation 的消费面**，不是第二套迁移语义。底层 source/target compatibility、transform、cutover、rollback/forward recovery、Effect settlement 由 [Change Management](../change-management.md) 唯一拥有。

一个 Migration deliverable 至少公开：

```text
plan / preview
apply or start
inspect / status / readback
recover or resume
reverse/rollback capability ref when actually available
```

并让消费者区分：
- planned but no Effect；
- executing；
- applied but not independently verified；
- verified terminal；
- rejected/blocked；
- recovery-required / residue；
- rolled-back（仅在真实 prior state 恢复时）。

接口必须绑定 exact source/target revision 与 operation identity。它不能用“有 reverse function”宣称数据可逆，也不能在 unknown settlement 后自动重放非幂等步骤。

## 8. Compiler deliverable

Compiler 成品需要公开：
- accepted input language/IR contract ref；
- Target/Profile selection contract；
- diagnostics/source mapping；
- output/artifact contract；
- unsupported/unknown结果；
- toolchain/Host imports；
- bootstrap/reproducibility claim（若要求）。

内部 pipeline、Type Algebra、Implementation Resolution、Target Program IR 和 Backend 仍由 Compiler owner拥有。成品接口不能复制一套 pass/resolver语义。能 parse/print 不等于 semantics preserved；自举也不要求所有源码改写成 SEC 中立语言。

## 9. Analyzer

Analyzer 成品输出必须带 coverage/assumptions。`diagnostics=[]` 只有 `complete=true` 且 universe/inputs 精确时才能表示完整分析无发现；otherwise 是 partial/unknown。

分析 cache/失效语义由实际 analyzer/compiler owner提供；消费合同只要求结果能绑定 exact source/config/dependency/tool semantics。CFG 没变不意味着 range/alias/effect analysis 可保留。

## 10. Generator

Generator 成品向消费者公开：
- source semantic revision；
- generator/backend identity ref；
- options/target；
- deterministic input closure；
- target ownership；
- source/provenance mapping；
- regeneration/hand-edit policy。

生成 output 不反向成为 meaning owner。若 output 被接管为手写 source，必须通过实际 source ownership transition 停止双写；该transition不由Generator接口自行授权。

## 11. Inference

Model inference contract 包含：
- model/weight identity；
- input/output tensor/value schema；
- shape/layout/dtype/precision；
- preprocessing/postprocessing；
- resource/device assumptions；
- error/unknown；
- determinism/randomness；
- numerical tolerance。

模型文件存在不等于已验证目标 task。量化/设备优化不能暗改允许误差、NaN/overflow 或 privacy contract。

## 12. Trainer

Training 成品还需要：
- dataset selection/provenance；
- objective/loss；
- split/evaluation methodology；
- optimizer/hyperparameters；
- randomness/seed meaning；
- checkpoint/resume；
- produced model identity；
- training vs validation/test claim separation。

训练 loss 降低不证明泛化；反复查看 validation 后继续选模型会改变确认解释。训练算法/统计解释由相应 Domain/Verification owner拥有。

## 13. Sampler / probabilistic component

消费合同必须区分 nondeterministic choice 与概率分布，并引用 joint distribution/independence/correlation、random source semantics、support、error bound 和 sample identity 的实际owner合同。

单变量边际相同不证明联合分布相同；复用一次 random draw 不能冒充两次 independent sample。端点概率可在无需随机位时直接返回。

## 14. Optimizer

Optimizer 成品公开 candidate domain、hard feasibility、objective/ordering、tie-break、termination/approximation 的合同引用和结果分类。

“当前最好”与“已证明全局最优”分开。Search budget exhausted、unsupported procedure、proof of infeasible、no candidate found 不能合成一个失败码。具体搜索/证明机制由实现/Compiler/Verification owner拥有。

## 15. GPU / accelerator kernel

需要公开：
- exact numeric domain；
- buffer layout/alignment/stride；
- device capability import；
- transfer/residency；
- dispatch/grid contract；
- synchronization/completion；
- cancellation；
- precision/error；
- resource release。

Kernel enqueue success 不是计算完成；在 device 仍可能访问时不能释放/复用 host/device buffer。实际设备调度和内存实现属于供给/Runtime owner。

## 16. Firmware

Firmware 成品必须公开其 state-machine contract ref、device I/O、boot/reset/update、fault-safe state、watchdog、persistent config、hardware compatibility 与可观察运行状态。

Reset fault 需要真实的新鲜输入/安全前提，而不是清除 error bit 即恢复 actuator。Image 生成完成不等于刷写、启动、校准或现场安全成立。

## 17. Real-time program

在 Firmware/Process 之外必须公开：
- task model；
- period/release/deadline；
- WCET bound requirement/evidence ref；
- blocking/interference assumptions；
- scheduler policy；
- clock/timer source；
- overrun/fault policy；
- actual hardware/profile。

平均/P99 latency 不能替代 hard deadline proof。作者固定 timing Requirement 后，runtime `start` 不能接收一个参数随意放宽它。

## 18. Installer deliverable

Installer 是 Distribution/Change operation 的消费面。实际 install transaction、ownership mutation、privilege Effect、rollback/repair semantics 由 Runtime/Distribution 与 Change Management owner定义。

成品至少公开：
- inspect/plan/preview；
- install/apply operation；
- progress/status/readback；
- repair/uninstall operation when supported；
- conflict/permission/recovery-required结果；
- 最终 installed identity/receipt。

Copy files 成功不能作为 installed terminal。失败清理只能针对该 operation 真正取得的 Effect；用户原有内容是否保留/恢复由底层 change contract判定，不能由 UI/CLI installer 自行决定。

## 19. Deployment deliverable

Deployment 是已验证 Artifact 面向某 target environment 的消费/控制面；rollout、traffic cutover、drain、rollback/forward recovery 与真实 Effect terminal 由 Delivery/Runtime/Change owner拥有。

成品必须让消费者绑定/观察：
- exact Artifact/Config/Secret refs；
- target environment；
- rollout policy ref；
- desired/current deployment identity；
- readiness/health observations；
- cutover/drain status；
- recovery/rollback capability；
- final readback/support state。

Package 发布不等于 deployment。控制面返回 accepted 不等于工作负载已 healthy。回滚入口存在不等于外部数据和不可逆 side effect 已回滚。

## 20. Existing native change

对已有工程的 change 是一类合法成品，其消费合同包括：
- fixed base/preimage；
- exact intended semantic delta；
- preserved behavior/regions；
- source edits/assets/config；
- target consumers；
- tests/diagnostics/format obligations；
- reviewable patch/candidate；
- apply precondition and conflict path。

实际 Source Program reconstruction、Delta/Impact、mutation/recovery分别由已有 owner处理。Brownfield 未知区域默认保全；SEC 不要求把整工程先转换成结构作者源，也不因任务局部就忽略真实跨文件消费者。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

数据、流、迁移、编译工具、模型/概率/优化、设备/实时、安装/部署和既有工程变化需要各自完整的消费者边界；Deliverable Model只拥有这些公开消费合同，不复制底层Query/Stream/Migration/Compiler/Deployment语义。任何生成、计划、提交或控制面受理的中间成功都不能冒领实际实现、现实采用或运行终态。
