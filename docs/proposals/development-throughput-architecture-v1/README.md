---
title: Development Throughput Architecture V1
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# Development Throughput Architecture V1

> 非 authority Spike。研究基线：`main@6cc3bf8a3b655bebf85dfca3f065c9842207c086`。跟踪：Issue #230。
>
> 本目录只组合现有 owner、裁决缺口和正式实施顺序，不替代 #175、#176、#177、#178、#179、#188、#189、#190、#191、#194、#205、#207、#219，也不证明任何目标能力已经进入 `main`。

## 1. 结论

SEC 的开发效率瓶颈已经不再主要是“单个测试太慢”或“模型写代码太慢”。当前更大的损耗来自：

1. 候选完成后仍依赖人工或 Agent 组合 Scope、Verification、Review、squash、merge、readback 和 cleanup；
2. Impact、Change Closure、Evidence、Failure、Run、Integration 等设计存在，但尚未形成一个可执行的端到端协议；
3. 每次恢复仍需从 Git、GitHub、manifest、Issue、Review、CI 和聊天重新拼装上下文；
4. 相同有效 install、scan、typecheck、test、browser 或平台节点不能跨候选、会话和进程精确复用；
5. 并行 resolver 已有 V3 骨架，但 relation、epoch、virtual merge 和 Evidence invalidation 尚未闭合；
6. Agent 仍承担过多本应由机器状态、权限、selector 和 transition validator完成的判断。

最高收益方向不是继续增加 Skill、治理文档或全量测试，而是建立一条机器拥有的交付主链：

```text
Goal / Ready Issue
→ trusted orientation
→ Task Capsule
→ Change Closure Plan
→ authorized operation
→ thin edit feedback
→ candidate
→ exact Candidate Closure
→ independent Review
→ Integration Queue
→ expected-head merge
→ new-main readback / cleanup / replan
```

任何一步缺少必需输入时输出结构化 `blocked | unresolved | not-run | invalidated`，不能靠 Agent 猜测、重复扫描或重跑来恢复信心。

## 2. 当前事实

### 2.1 已进入 `main` 的基础

当前仓库已具备：

- fast / slow / Full / selected Risk 分层；
- affected test selection 与 cache identity trust boundary；
- unified verification result与claim-based product summary；
- exact-base repository audit；
- V3 Work Package schema与pairwise conflict resolver骨架；
- frozen PR Scope/Verification workflow；
- exact-head merge-gate revalidation；
- `sec-merge-bootstrap.ts` 本地端到端bootstrap；
- active documentation、Agent Skill和repository audit机器合同；
- fast runner 的bounded parallel、exclusive owner和run-owned workspace cleanup。

历史 Fast Closure 在固定候选与固定环境下报告五个有效默认fast样本约为55秒。这个结果说明测试本体已完成一次结构性治理；继续把55秒压低仍有价值，但已不是当前最大控制面瓶颈。

### 2.2 当前直接阻塞样本

PR #227 / Issue #217是当前唯一开放产品候选。研究时观察到：

- PR处于Draft；
- head为`eeddf3c3ca2b43ecfb501cbf6110a38cf7b38018`；
-候选已有实现、focused tests、manifest和active pointer变化；
-当前连接器查询不到该head关联的PR workflow run；
-`compiler-pr-validation.yml`只接受受信`repository_dispatch: sec-verify-frozen-v1`；
-`sec-merge-gate.yml`会在PR事件上重算merge authority，但不会自动替用户把Draft候选squash并发出受信verification dispatch；
-完整流程仍由本地`sec-merge-bootstrap.ts all`调用`gh`完成dispatch、poll、squash、merge、post-merge patch和branch cleanup。

因此当前真实空档是：**candidate authoring已完成，但candidate closure没有成为持续可用的仓库服务。**

### 2.3 已设计但未成为当前能力

以下能力已有Issue或proposal owner，但不能按存在即完成解释：

- #177 Epoch / Failure / Pre-freeze；
- #178 Trusted Bootstrap / TCB reduction；
- #179 Evidence DAG / Run Journal；
- #188 Semantic Test Impact Graph V2；
- #189 Automatic Development Feedback；
- #190 Hermetic Test Runtime；
- #191 Integration Queue；
- #194 Compiler Incremental Graph；
- #205 Task Capsule Compiler；
- #207 Integration Epoch Registry与resolver correctness；
- #219 Change Closure Compiler / First-Pass Gate；
- `docs/proposals/development-run-kernel.md`。

本提案的职责是把这些 owner 组合为一条不重复、可分阶段落地的主链。

## 3. 吞吐模型

SEC不应只测测试执行时长。一次正式变化的总墙钟时间可拆为：

```text
T_total =
  T_selection
+ T_orientation
+ T_context_load
+ T_design
+ T_authoring
+ T_feedback_wait
+ T_rework
+ T_candidate_closure
+ T_review_wait
+ T_gate_queue
+ T_gate_execution
+ T_integration_wait
+ T_merge_readback
+ T_cleanup
```

当前 Fast Closure主要降低`T_gate_execution`的一部分；后续最高收益来自降低：

- `T_orientation + T_context_load`：Task Capsule、Context Compiler、Run Kernel；
- `T_rework`：Change Closure、counterexample-first、Failure learning；
- `T_candidate_closure + T_review_wait`：Candidate Closure Engine；
- `T_gate_queue`：exact-head自动dispatch、stale cancellation、资源调度；
- `T_integration_wait`：Integration Epoch、virtual merge、Evidence reuse；
- `T_merge_readback + T_cleanup`：typed publication action与receipt。

优化目标不是最小化某一个阶段，而是在不降低正确性、不扩大unknown和不污染资源的前提下最小化总交付时间。

## 4. 目标架构

```text
┌──────────────────────────────────────────────────────────────┐
│  Selection Plane                                             │
│  roadmap + ready issues + value/risk/dependencies            │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Orientation / Context Plane                                 │
│  exact repo facts → Task Capsule → Context Capsule           │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Change Design Plane                                         │
│  root cause + Change Closure + counterexamples + permissions │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Authoring / Feedback Plane                                  │
│  edit delta → incremental index → impact → thin checks       │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Candidate Plane                                             │
│  candidate identity + failure + pre-freeze + closure receipt │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Evidence Plane                                              │
│  action graph + hermetic resources + local/hosted producers  │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Review / Integration Plane                                  │
│  exact review + integration epoch + virtual merge + queue    │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Publication Plane                                           │
│  expected-head merge → main readback → cleanup → replan      │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 单一 owner 原则

| 语义 | 唯一 owner |
|---|---|
| 产品验证结果真值 | #176 |
| Candidate/Frozen与failure fingerprint | #177 |
| trusted bootstrap与TCB | #178 |
| Evidence DAG与Run Journal | #179 |
| Test Impact | #188 |
| 自动反馈执行 | #189 |
| 物理测试资源与cleanup | #190 |
| 多包冲突与Integration Queue | #191/#207 |
| compiler incremental graph | #194 |
| Task Capsule/root-cause input | #205 |
| Change Closure/first-pass completeness | #219 |
| Development Run transition/capsule | Development Run Kernel proposal |
| Candidate Closure orchestration | 本提案定义组合边；正式owner应从现有CI/merge控制面提炼，不建立第二Gate真值 |

组合器只能引用owner输出，不得复制其状态机或算法。

## 5. 十项架构裁决

### DEC-T01：先闭合候选交付，再优化更多测试毫秒

PR #227证明当前最大即时损耗是Gate调度和收口链。首个正式收益包应使一个已满足authoring acceptance的候选可以自动得到下一状态，而不是继续由人肉运行多个命令。

### DEC-T02：Candidate Closure是编排器，不是新Verification owner

Candidate Closure Engine只负责：

-读取candidate、manifest、Review、Gate plan和Evidence；
-调用既有Scope/Verification/Review/merge primitive；
-验证exact identity和transition；
-发布typed receipt。

它不定义哪些测试正确、PASS是什么意思或哪些路径受影响。

### DEC-T03：先只读plan，再自动执行

Automatic Feedback、Task Capsule、Change Closure、Integration Queue都应先交付read-only稳定输出；输出byte-stable且能回放历史失败后，再进入自动mutation或Gate触发。

### DEC-T04：Context Capsule必须由机器引用构成

上下文不再是一个长摘要。它是带reason、mode、symbol、authority、digest和失效条件的引用集合。模型只按需加载正文。

### DEC-T05：Action Key先于CAS

没有正确Action Key和input closure时，引入本地或远程CAS只会缓存错误结果。V1先实现key、result metadata、trust、freshness和invalidation；物理store可后接。

### DEC-T06：失败也是可复用结果，但绝不能投影为PASS

确定性失败在输入和failure fingerprint未变时直接复用，避免无意义重跑；任何failure只支持diagnosis和next action，不成为positive Evidence。

### DEC-T07：增量索引是derived control-plane data，不是第二Engineering IR

Repository Semantic Index用于开发影响、上下文裁剪、Review和并行冲突。它可删除、可重建、不能拥有产品identity/revision或覆盖canonical Engineering IR。

### DEC-T08：并行授权与Gate并行分开

多个Work Package能否并行由Integration Epoch解析；同一候选内部哪些Evidence节点并行由Evidence DAG和resource owner解析。二者不得用同一“并发数”字符串替代。

### DEC-T09：Publication必须是typed action

`create-issue | add-comment | create-branch | update-file | update-ref | dispatch | merge | delete-ref`必须有目标、权限、precondition、dry-run summary、reversibility和receipt。计划意图不能物理路由成文件/ref修改。

### DEC-T10：指标必须优化交付，而不是奖励活动量

不使用commit数、branch数、Agent数或测试总数衡量效率。主指标是有效纵切片从ready到main readback的时间、first-pass yield和可避免返工。

## 6. 分阶段目标

### P0 — Candidate Closure

目标：消灭“代码已完成但无人知道下一步”的空档。

- candidate identity与single-parent preparation；
- exact-head Scope与Verification dispatch；
- stale-head cancellation；
- compact machine status；
- independent Review request/readback；
- merge authorization；
- expected-head merge、main readback、cleanup receipt。

### P1 — First-pass correctness

目标：降低可预见返工。

- Task Capsule Phase A；
- Change Closure Phase A；
-历史failure corpus replay；
- pre-implementation counterexample plan；
- pre-freeze omission review。

### P2 — Evidence reuse与恢复

目标：不重复有效工作，不依赖聊天恢复。

- Epoch/Failure Phase A；
- Trusted Bootstrap；
- Evidence DAG / Run Journal Phase A；
- Development Run Kernel Shadow；
- exact Action Key与derived local cache。

### P3 — 自动反馈与增量

目标：普通开发只启动一个入口。

- Impact Graph最小可消费接口；
- warm plan-only analyzer；
- incremental TypeScript program；
- Repository Semantic Index；
- thin edit feedback；
- candidate automatic hermetic execution。

### P4 — 安全并行与集成

目标：无冲突任务不再错误串行，组合状态先于合并验证。

- #207 resolver correctness；
- Integration Epoch Registry；
- virtual merge tree；
-组合affected closure；
- Evidence invalidation/reuse；
- queue reorder、supersede和cleanup。

### P5 — 持续优化

- telemetry与SLO；
- cache GC与poison recovery；
- selector false-negative learning；
- escaped failure反哺Change Closure；
-删除被机器服务替代的prose、脚本和manual-shadow状态。

## 7. 最高优先级的具体变化

1. 从当前`sec-merge-bootstrap.ts`提炼纯Candidate Closure状态机和typed receipts；
2. 保留本地CLI作为operator adapter，但不让本地轮询成为唯一状态owner；
3. GitHub workflow负责受信producer，仓库服务负责读取和推进transition；
4. PR新head立即使旧Review、aggregate Evidence和merge authority失效；
5.新head到来时取消旧Gate，但保留仍有效的独立Action节点；
6. PR Draft不进入Gate；Ready只表示允许Closure Engine推进，不表示PASS；
7.每次推进只有一个幂等transition，例如`prepare → attest → verify → review → authorize → merge → readback → cleanup`；
8.任一transition可在进程重启后从外部receipt恢复；
9.失败输出owner、fingerprint、invalidated Evidence和唯一next action；
10.所有正式实现先在历史PR #203/#210/#211和当前#227流程上回放。

## 8. 明确不做

- 不把全部仓库迁移到Bazel、Nx、Pants或其他构建平台；
-不让GitHub merge queue替代SEC Integration Queue语义；
-不在V1引入remote execution；
-不把watcher事件当canonical change；
-不把branch、PR号、聊天、时间戳作为Action Key；
-不让本地cache直接形成merge authority；
-不为了速度把unknown解释为not-affected；
-不把所有测试塞回edit loop；
-不允许多个Agent共同写同一canonical owner；
-不创建第二Verification、Impact、Failure、Run、Resource或Integration状态机。

## 9. 目录

- `registry.yaml`：能力、owner、状态、依赖、输入输出与transition的机器草案；
- `current-state.md`：当前实现和缺口证据；
- `candidate-closure.md`：候选、Gate、Review、merge和readback闭环；
- `context-and-incremental.md`：Task Capsule、Context Compiler、Run Kernel、Semantic Index与自动反馈；
- `evidence-and-integration.md`：Action Key、Evidence DAG、Failure复用、Integration Epoch和virtual merge；
- `metrics.yaml`：指标、SLO和反激励约束；
- `evaluation.yaml`：历史回放与对抗场景；
- `rollout.md`：正式Work Package顺序、trust migration和退役；
- `research-basis.md`：内部证据、外部一手机制与本次推导边界。

## 10. 现实完成定义

本提案本身完成只表示设计闭合，不表示效率能力已经实现。现实完成必须证明：

1. 一个普通候选从Ready到main readback无需人工组合多个命令；
2.同一外部状态总能得到同一合法next transition；
3. stale、missing、unsupported、cleanup unknown不投影为PASS；
4.相同有效Action不重复执行；
5.上下文压缩、进程重启、Agent替换后不重复Gate、不扩大scope、不回到旧任务；
6.无冲突Work Package可机器授权并行，有冲突包在编码前暴露；
7. first-pass yield、avoidable failure、queue wait、context load和Evidence reuse可度量；
8.所有结果经过聚焦Work Package进入`main`、new-main readback并退役旧manual路径。