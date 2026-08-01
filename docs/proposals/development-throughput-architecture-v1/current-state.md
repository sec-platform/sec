---
title: Development Throughput 当前状态与瓶颈
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# Development Throughput 当前状态与瓶颈

## 1. 证据边界

本报告绑定：

```text
repository: sec-platform/sec
main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
open product PR: #227
PR head: eeddf3c3ca2b43ecfb501cbf6110a38cf7b38018
research date: 2026-08-01
```

当前事实来自exact GitHub文件、PR/Issue和workflow查询。历史Work Package只用于解释已实现机制与历史性能样本，不覆盖当前`main`。

## 2. 当前执行面

### 2.1 开发入口

`package.json`当前暴露：

- `bun run dev` → `platform/dev-runner.ts`；
- `check:affected`、`check:fast`、`check:full`；
- `test:affected`、`test:fast`、`test:slow`、`test:full`；
- typecheck、imports、docs、repository audit、text census和environment settlement；
- GitNexus CLI和Graphify CLI；
- build、publish与SEC CLI。

这些入口已经集中到`platform/dev-runner.ts`，但“何时运行什么、是否复用、何时升级到hosted Gate、失败后下一步是什么”仍主要由Agent/Skill/操作者决定。

### 2.2 Frozen Verification

`.github/workflows/compiler-pr-validation.yml`：

-只接受`repository_dispatch: sec-verify-frozen-v1`；
-要求maintain/admin actor和triggering actor；
-绑定PR、expected base/head、manifest path/digest和profile；
-要求同仓库、单一open PR、single-parent head且parent等于current base；
-从default branch workflow trust root执行；
-候选修改verifier trust-root时返回`manual-bootstrap-required`；
-执行`ci-verification.ts`并上传V19 Evidence artifact；
-按PR设置concurrency并取消旧运行。

优点：exact identity、trusted producer、manifest和single-parent边界明确。

当前缺口：该workflow本身不决定何时形成single-parent候选，也不会在普通PR Ready后自动生成受信dispatch。

### 2.3 Merge Gate

`.github/workflows/sec-merge-gate.yml`：

-监听PR open/synchronize/reopen/ready/draft/edit/close；
-监听verification workflow run状态；
-监听Scope/Verification repository dispatch；
-监听main trust-root相关push与定时revalidation；
-为Draft或共享exact head的PR写失败status；
-为候选重算`sec/merge-gate`状态；
-验证Scope、Verification、Review和manifest Evidence。

优点：merge authority会因PR/head/workflow变化重新计算，且状态绑定exact head。

当前缺口：它是revalidation和authority evaluator，不是自动候选闭包推进器。它不会替操作者完成squash、dispatch、Review请求、merge和post-merge control-plane mutation。

### 2.4 Local Merge Bootstrap

`scripts/codex/sec-merge-bootstrap.ts`当前实现：

```text
digest
attest
verify
squash
merge
patch
cleanup
all
```

它调用本地`git`和`gh`：

-读取PR和manifest；
-计算manifest digest；
-dispatch Scope/Verification；
-轮询workflow run；
-确保single-parent；
-admin squash merge；
-更新post-merge pointer/rolling plan；
-删除local/remote branch。

该脚本已经是Candidate Closure Engine的原型，但目前存在以下结构风险：

1. CLI注释、纯函数、shell side effect和长期状态机混在单文件；
2.运行状态主要存在当前进程与轮询输出中；
3.中途退出后的resume依赖重新推断；
4.完整流程要求本地`gh`可用且授权正确；
5.post-merge pointer patch可能形成独立main提交，增加控制面延迟和新失败面；
6.merge、pointer、Issue、branch/worktree cleanup没有一个统一publication receipt；
7.脚本拥有过多流程知识，和Skill、workflow、merge-gate出现投影重复。

它应被提炼，不应继续扩大为万能脚本。

## 3. 当前性能事实

### 3.1 Fast执行

历史`fast-feedback-closure-v2`在固定候选、warm环境和五个有效样本下报告：

```text
54.754
54.947
54.955
54.973
55.118 seconds
median: 54.955 seconds
range: 54.754–55.118 seconds
```

同时已经完成：

- micro-sentinel不再无意义独占进程；
- bounded-parallel与exclusive owner区分；
- run-owned mutable workspace namespace；
-父进程finally cleanup；
-完整Workspace和physical acceptance迁到slow/Risk owner；
-性能结论使用固定环境多样本而非单次wall-clock。

因此后续Fast优化必须基于新的profile和结构证据，不能假设测试仍是主要瓶颈。

### 3.2 当前候选等待

PR #227已形成4 commits的候选，但研究时：

-PR仍为Draft；
-没有查询到其head关联的PR workflow run；
-没有hosted Quick PASS；
-没有独立Review；
-没有single-parent candidate；
-没有merge/readback/cleanup。

该样本说明`T_candidate_closure`和`T_wait`可显著大于约55秒fast本体。

## 4. 现有能力owner与成熟度

| 能力 | Owner | 当前成熟度 |
|---|---|---|
| Verification Result Truth | #176 | 部分进入main，仍有#215语义缺口 |
| Impact selection | #188 + current path/test rules | V1可用，V2未完成 |
| Candidate/Failure | #177 | 设计/Issue，未成为统一状态owner |
| Trusted Bootstrap | #178 | 现有workflow有manual-bootstrap边界，完整owner未闭合 |
| Evidence DAG/Run Journal | #179 | 设计，未形成通用持久节点系统 |
| Automatic Feedback | #189 | 设计，`bun run dev`尚不是目标daemon |
| Hermetic resources | #190 | 多个局部owner存在，统一identity/receipt未闭合 |
| Integration Queue | #191 | Program设计 |
| Parallel resolver | #207 | V3骨架已进入main，relation/epoch正确性待修 |
| Compiler Incremental Graph | #194 | 设计/后续能力 |
| Task Capsule | #205 | 设计，未生成正式最小上下文对象 |
| Change Closure | #219 | 设计，未形成pre-implementation/pre-freeze gate |
| Development Run Kernel | proposal | 设计，manual-shadow阶段 |
| Candidate Closure | CI/merge脚本组合 | 物理primitive存在，缺统一服务和state/receipt |

## 5. 当前重复与空洞

### 5.1 重复的流程知识

以下规则同时出现在多个表面：

- candidate必须frozen、single-parent、exact head；
-同一Evidence不能跨head复用；
-Review绑定exact head；
-trust-root candidate不能自证；
-Gate只在输入变化后重跑；
-merge后main readback和cleanup；
-proof reset和failure escalation；
-Work Package pointer/manifest/rolling plan切换。

分布位置包括：

-AGENTS；
-Skills；
-development/verification governance；
-workflow脚本；
-merge bootstrap；
-merge gate；
-Work Package manifest；
-Issue设计。

确定性规则应收敛到typed contract和state machine，其他表面只保留投影。

### 5.2 缺少持续状态

一个候选的真实推进状态没有一个可恢复machine object，例如：

```text
prepared
single-parent-ready
scope-requested
scope-passed
verification-requested
verification-passed
review-requested
review-approved
merge-authorized
merged
main-readback
cleanup-completed
```

GitHub status、workflow run、PR state和本地CLI日志可以推断这些事实，但没有一个统一transition receipt将它们串成可恢复链。

### 5.3 缺少Action级复用

当前GitHub Actions cache主要缓存：

- Bun install cache；
- TypeScript build info。

这不是通用Evidence复用。缺少：

- action definition；
-完整input closure；
-environment/toolchain/provider digest；
-output metadata；
-trust producer；
-freshness和invalidation；
-failure result cache；
-resource/cleanup identity。

### 5.4 缺少最小上下文编译

Agent恢复任务仍需读取：

- latest main；
-PR/Issue；
-manifest/pointer；
-authority；
-source/tests；
-Review/CI；
-failure tail；
-历史对话或摘要。

其中大量内容可以被Task Capsule和Context Capsule提前结构化，而不是每次重新探索。

### 5.5 缺少真实并行授权

V3 contract已能表达authority/path/resource和部分关系，但#207确认：

-`orderedAfter`和`conflictsWith`未完整进入resolver；
-producer/consumer requires方向需修正；
-没有exact-base Integration Epoch Registry；
-没有cycle/missing/stale/cancel重算；
-相同verification policy与physical资源独立性未区分；
-没有virtual merge和组合affected closure。

在这些缺口关闭前，正式多写者并行仍应保守。

## 6. 根因图

```text
没有统一Task/Closure输入
→ Agent先写局部实现
→ 相邻不变量晚发现
→ candidate反复变化
→ Review/Gate失效
→ 重复执行与等待

没有Candidate Closure state
→ 人工dispatch/轮询/squash/merge
→ 进程或会话中断后重算
→ 候选停在Draft或pending

没有Action Key/Evidence DAG
→ 相同有效节点重复运行
→ 失败也重复运行
→ hosted/local无法精确复用

没有Run Journal/Kernel
→ compact/restart重新orientation
→ 重读无关上下文
→ 重复Gate或偏离next action

没有Integration Epoch/virtual merge
→ 无冲突任务被串行
→ 有语义冲突任务晚到merge才暴露
→ 前一PR合并使后续Evidence大范围失效
```

## 7. 优化优先级裁决

### 当前最高收益

1. Candidate Closure state/receipt；
2. Task Capsule + Change Closure只读编译；
3. Failure/Evidence identity；
4. Run Journal / Kernel Shadow；
5. Impact V2和warm plan-only feedback；
6. Integration Epoch correctness；
7. virtual merge与组合Evidence。

### 当前次级收益

-进一步减少Fast几秒；
-引入remote cache；
-大规模Project References重构；
-更多Agent并行；
-自动GitHub Merge Queue；
-remote execution。

这些能力只有在主链identity、trust和invalidation正确后才安全产生净收益。

## 8. 当前必须保持的安全边界

-`main`是唯一正式结果；
-PR、Issue、branch、Spike、Evidence都不能证明已完成；
-Draft不进入正式Gate；
-Ready不等于PASS；
-unresolved/unknown不等于safe/not-affected；
-trust-root candidate不能调用candidate verifier授权自己；
-local cache不能直接形成merge authority；
-physical resource cleanup未知不能保留绿色；
-并行不能只凭无Git文本冲突；
-任何自动action必须验证目标repo/resource、权限、expected identity和readback。