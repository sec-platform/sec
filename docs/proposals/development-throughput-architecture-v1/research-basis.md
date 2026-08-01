---
title: Development Throughput Architecture 研究基础与采纳裁决
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# Development Throughput Architecture 研究基础与采纳裁决

## 1. 证据分层

本提案使用四类材料，权威等级不同：

1. **当前仓库事实**：`main@6cc3bf8a3b655bebf85dfca3f065c9842207c086`中的代码、workflow、配置、active authority，以及live GitHub PR/Issue状态。
2. **当前设计owner**：开放Issue和active proposal定义未来职责、依赖和完成条件；存在不表示已实现。
3. **历史Evidence**：已归档Work Package、旧PR链和性能样本，用于重放失败与理解机制，不覆盖当前事实。
4. **外部一手机制**：GitHub、TypeScript、Bazel等官方文档，只证明通用机制可用，不拥有SEC语义。

本次综合推导只是一项proposal。所有正式结论必须由对应owner从执行时最新`main`提炼。

## 2. 当前仓库事实来源

### 2.1 `package.json`

研究对象：

```text
package.json@main
```

支持的事实：

- Bun exact toolchain；
- `dev`、typecheck、affected/fast/slow/full、imports、docs、audit等入口；
-当前没有独立公开的Candidate Closure service命令；
-依赖与Provider仍集中在根包。

不支持的推断：

- `bun run dev`已实现目标Automatic Feedback Daemon；
-当前依赖边界已经完成；
-Node/Bun公共Host支持已闭合。

### 2.2 Frozen verification workflow

研究对象：

```text
.github/workflows/compiler-pr-validation.yml@main
```

支持的事实：

-仅接受`repository_dispatch: sec-verify-frozen-v1`；
-要求maintain/admin actor和triggering actor；
-绑定exact PR/base/head/manifest/profile；
-要求same-repository single-parent current-base head；
-默认分支workflow作为trust root；
-trust-root变化需要manual bootstrap；
-concurrency按PR取消旧运行；
-上传compact Evidence artifact。

不支持的推断：

-普通PR Ready会自动触发验证；
-Verification workflow自动请求Review或merge；
-该workflow拥有Impact/Review/Integration语义。

### 2.3 Merge gate workflow

研究对象：

```text
.github/workflows/sec-merge-gate.yml@main
```

支持的事实：

-监听PR、workflow_run、repository_dispatch、main push和schedule；
-重算exact-head merge status；
-Draft和共享head会阻断；
-消费Scope、Verification和Review相关事实。

不支持的推断：

-该workflow自动把候选squash为single-parent；
-它拥有完整Candidate Closure transition；
-它会自动merge、pointer settlement和worktree cleanup。

### 2.4 Local merge bootstrap

研究对象：

```text
scripts/codex/sec-merge-bootstrap.ts@main
```

支持的事实：

-本地CLI提供digest、attest、verify、squash、merge、patch、cleanup和all；
-调用`gh`和`git`；
-轮询workflow；
-执行post-merge pointer和branch清理。

本次推导：

-它是Candidate Closure的物理原型；
-应提炼为pure state、read-only reconciler、trusted adapter和publication阶段；
-不应继续作为唯一长期状态owner。

这属于架构推导，不是代码已经具备的事实。

### 2.5 Parallel Work Package V3

研究对象：

```text
scripts/codex/parallel-work-package-contract.ts@main
```

支持的事实：

-存在V3 manifest schema；
-表达authority reads/writes、owned/permitted/forbidden、resources和relations；
-存在pairwise conflict分类骨架。

结合Issue #207支持的当前设计结论：

- relation语义、producer/consumer方向、cycle/missing、Integration Epoch和多包重算仍需闭合；
-因此V3存在不等于正式并行已授权。

### 2.6 Development Run Kernel proposal

研究对象：

```text
docs/proposals/development-run-kernel.md@main
```

支持的设计：

- stable runId；
-event/capsule chain；
-transition preconditions；
-resume/cancel/supersede；
-prompt intake；
-Kernel不拥有Failure/Verification/Evidence/Integration语义；
-manual-shadow→Kernel Shadow→Hook→Journal→Parallel阶段。

不支持的事实：

-Run Kernel已经实现；
-上下文压缩已经自动确定性恢复；
-current state已经写入Git common dir。

### 2.7 Fast Feedback historical evidence

研究对象：

```text
docs/archive/work-packages/fast-feedback-closure-v2.md
```

支持的历史Evidence：

-固定候选、warm环境下五个有效default-fast样本；
-54.754、54.947、54.955、54.973、55.118秒；
-median 54.955秒；
- bounded concurrency、exclusive owner、workspace cleanup等结构治理。

限制：

-绑定历史candidate/environment；
-不是当前main的持续性能SLO；
-不能证明所有机器上仍约55秒；
-只能说明测试本体已完成过一次显著结构优化，因此当前应先测量整条critical path。

### 2.8 当前PR #227

研究时live事实：

-唯一开放产品PR；
-Draft；
-head `eeddf3c3ca2b43ecfb501cbf6110a38cf7b38018`；
-base `6cc3bf8a3b655bebf85dfca3f065c9842207c086`；
-候选包含verification artifact claim summary修复、focused tests和manifest；
-连接器未返回关联PR workflow run。

本次推导：

-它是authoring完成后candidate closure空档的真实样本；
-不能仅因连接器看不到run就断言GitHub UI绝对没有任何非PR事件运行；
-但PR本身明确没有hosted Quick/Review/merge claim，足以支持“闭环尚未完成”。

## 3. 当前Issue owner来源

### #175 — Verification Truth + Development Throughput

采纳：

-验证真实性与吞吐共同优化；
-速度只能来自Impact、增量、复用、并行证明、稳定候选和恢复；
-不允许少测、扩大timeout或unknown→PASS。

### #176 — Verification Result Truth

采纳：结果真值唯一owner。Candidate Closure、Evidence DAG和Daemon不得复制status/applicability/disposition算法。

### #177 — Epoch / Failure / Pre-freeze

采纳：candidate/frozen和failure fingerprint唯一owner。Run Kernel只引用。

### #178 — Trusted Bootstrap

采纳：candidate-as-untrusted-SUT和base-side trust route。自动dispatch必须服从。

### #179 — Evidence DAG / Run Journal

采纳：Action Key、通用Evidence节点和persistent resume唯一owner。Candidate Closure不另建缓存或Journal。

### #188 — Semantic Test Impact Graph V2

采纳：selection和unknown frontier唯一owner。Automatic Feedback不复制path→test逻辑。

### #189 — Automatic Development Feedback

采纳：plan-only→hermetic execution→persistent reuse三阶段，先获得warm分析收益。

### #190 — Hermetic Test Runtime

采纳：fixture/resource/cleanup identity唯一owner。Evidence结果必须引用cleanup receipt。

### #191 / #207 — Parallel Work Packages / Integration Epoch

采纳：authority/path/resource冲突和merge order唯一owner；正式并行前修正V3语义。

### #194 — Compiler Incremental Graph

采纳：compiler pass/artifact增量唯一owner。Repository Semantic Index只作开发派生索引。

### #205 — Task Capsule / Root Cause First

采纳：最小任务输入、root cause和Reconciliation Delta。

### #219 — Change Closure / First-Pass Gate

采纳：producer/consumer/state/identity/environment/trust/migration闭包和历史回放。

## 4. 外部一手机制

### 4.1 GitHub Actions concurrency

官方来源：

- <https://docs.github.com/en/actions/using-jobs/using-concurrency>

官方机制：

- workflow/job可设置concurrency group；
-同group最多一个running和一个pending；
-`cancel-in-progress: true`可取消运行中的旧实例；
-并发组中的调度顺序不保证FIFO。

SEC采纳：

-按PR/candidate/resource设置group；
-新head取消旧aggregate；
-不依赖GitHub queue顺序决定Integration Queue工程顺序。

SEC不采纳：

-把concurrency字符串当资源冲突证明；
-用GitHub调度替代Work Package关系和global writer registry。

### 4.2 GitHub Actions dependency caching

官方来源：

- <https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows>
- <https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts>

官方机制：

- cache按exact key查找，未命中可按restore keys部分匹配；
-cache hit后已有entry不能原地更新；
-cache具有branch/default scope和淘汰/容量行为；
-artifact用于workflow输出保存和后续消费。

SEC采纳：

- dependency和build cache作为加速hint；
-key绑定OS、toolchain、lock和真实配置；
-部分restore必须由工具验证内容identity；
-正式Evidence使用自己的Action Key、producer trust和artifact contract。

SEC不采纳：

-把GitHub cache hit直接视为PASS；
-用restore prefix代替完整input closure；
-让低信任PR污染merge-authoritative namespace。

### 4.3 GitHub Merge Queue

官方来源：

- <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue>

官方机制：

-可在受保护分支上对排队PR构造最新组合状态并运行required checks；
-处理主干变化和合并排队。

SEC候选采纳：

-未来可作为publication provider；
-仅消费SEC签发的Integration Queue entry。

SEC不采纳：

-让GitHub Queue定义authority/path/resource冲突；
-让它替代Work Package、Impact、Evidence reuse和semantic main readback。

### 4.4 TypeScript Project References

官方来源：

- <https://www.typescriptlang.org/docs/handbook/project-references.html>

官方机制：

-`references`声明项目关系；
-`composite`和declaration输出形成边界；
-`tsc --build`按依赖顺序构建并判断up-to-date；
-适合把大型程序拆成逻辑组件。

SEC采纳：

-先使用现有incremental program/build info；
-只有真实ownership/module边界和profile收益时采用Project References；
-clean/incremental parity为硬要求。

SEC不采纳：

-为提高缓存命中任意拆分项目；
-把`.tsbuildinfo`当Evidence authority；
-让Project References定义SEC模块语义。

### 4.5 TypeScript Compiler API / Incremental APIs

官方来源：

- <https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API>
- TypeScript公开API与源码中的incremental/builder program接口。

外部机制：

-可复用Program、watch/builder和diagnostics；
-可按文件变化增量更新。

SEC采纳：

-用于Automatic Feedback warm plan-only和Repository Semantic Index TS层；
-watcher事件只作hint，真实bytes/digest决定revision。

SEC不采纳：

-把TypeScript程序图当完整Test Impact或Engineering IR；
-让编译器缓存跳过clean parity验证。

### 4.6 Bazel Remote Caching

官方来源：

- <https://bazel.build/remote/caching>

官方机制：

-区分Action Cache与Content Addressable Store；
-action由输入、命令、环境和输出声明形成；
-远程cache允许多个构建共享结果。

SEC采纳：

-Action Cache/CAS二层概念；
-先定义Action Key、input closure、environment、producer trust和invalidation；
-物理store后接。

SEC不采纳：

-采用Bazel作为SEC语义owner；
-立即迁移构建系统；
-在输入未显式时启用remote cache；
-remote execution作为V1。

## 5. 本次综合推导

以下不是任何单一来源直接给出的结论，而是基于SEC当前结构和上述机制的架构推导。

### INF-01：Candidate Closure是当前最高即时收益

依据：

- Fast已报告约55秒历史基线；
- frozen workflow和merge gate已有强primitive；
-当前#227仍停在Draft、无完成Gate/Review/merge claim；
-本地bootstrap拥有完整流程但不可恢复/服务化。

推导：先提炼Candidate Closure能最快降低现有等待和手工transition，并为后续Journal/Evidence提供真实consumer。

### INF-02：Candidate Closure必须是编排器

依据：Verification、Failure、Impact、Review、Integration均已有owner。

推导：若Closure重新定义PASS/Impact/failure，会产生第二状态机；它只能验证输入并调用owner primitive。

### INF-03：Action Key先于CAS

依据：GitHub cache和Bazel均要求key/inputs，SEC当前尚无通用完整closure。

推导：先引入物理cache会增加错误复用和poison风险；应先交付纯合同和read-only planner。

### INF-04：Context Capsule必须是引用集合

依据：Task Capsule/Run Kernel目标、现有文档唯一owner原则和Skill V2 progressive disclosure。

推导：复制全文会制造第二事实源和重复token；引用带digest/reason/load policy更适合增量恢复。

### INF-05：失败结果可复用

依据：#177 failure fingerprint和重复确定性失败浪费。

推导：相同Action Key/fingerprint直接返回失败可显著减少墙钟时间，但不得进入positive Evidence。

### INF-06：两层并发必须分离

依据：#191管理Work Package冲突，Fast runner/Evidence DAG管理动作和资源。

推导：多任务并行与单任务内部测试并行是不同控制问题，不能共享一个并发开关。

### INF-07：post-merge settlement需要独立状态

依据：当前bootstrap在merge后另做pointer patch和cleanup。

推导：产品已merge和control plane已settled必须区分；后者失败时应可恢复而不是混淆主干结果。

### INF-08：指标必须覆盖整个critical path

依据：只测Fast不能解释Draft等待、Review、Gate queue、恢复和integration。

推导：ready-to-main-readback与first-pass yield应成为主指标，执行时长只是其中一层。

## 6. 被拒绝或后置的竞争方案

### 6.1 立即引入Bazel/Nx/Pants

拒绝原因：

-会引入第二build/test/Impact/cache语义；
-迁移成本大；
-当前主要瓶颈是候选闭环和状态，不是缺构建框架；
-SEC已有大量自定义physical/trust/Work Package约束。

反转条件：仓库规模和profile证明现有增量/Action DAG无法满足，且可通过Provider保留SEC语义。

### 6.2 立即启用remote cache/execution

拒绝原因：Action Key、trust和resource identity尚未闭合。

反转条件：本地Action DAG稳定、cache poison为零、clean parity和trusted producer成熟。

### 6.3 所有PR Ready自动跑Full

拒绝原因：浪费Actions、扩大等待，违背Impact和Risk分层。

采用替代：Ready触发Candidate Closure plan，profile由Impact/Verification policy选择。

### 6.4 所有编辑自动运行测试

拒绝原因：快速supersede、资源污染和高CPU；heavy tests不属于edit loop。

采用替代：plan-only和thin feedback，candidate阶段才执行完整affected closure。

### 6.5 更多Agent自由并行

拒绝原因：语义/authority/resource冲突晚发现，增加integration成本。

采用替代：一个写Worker+只读分析/Review；多写者由Integration Epoch授权。

### 6.6 GitHub Merge Queue直接作为总集成平台

拒绝原因：无法拥有SEC authority、Work Package、Impact和Evidence语义。

采用替代：未来只作为publication provider。

### 6.7 把Repository Semantic Index做成新IR

拒绝原因：会与Engineering IR竞争identity和产品事实。

采用替代：derived、可删除、面向开发控制的索引。

## 7. 不确定性

仍需真实实现/telemetry验证：

- Candidate Closure服务最合适的部署形态：GitHub App、workflow-only、local service或组合；
-约55秒Fast在当前main和不同机器上的真实分布；
-Task/Context Capsule能减少多少首轮token和orientation时间；
-TypeScript incremental program的内存/延迟收益；
-Project References是否有净收益；
-Action Key完整声明的维护成本；
-本地CAS命中率和容量；
-virtual merge对physical冲突的预测范围；
-自动publication可接受的权限与风险；
-Integration Queue在2–4个真实Work Package下的净吞吐。

这些必须保留为unknown或实验，不得在文档中写成已实现收益。

## 8. Freshness与重算

以下事件使本研究部分或全部失效：

- main前进并改变workflow、merge bootstrap、verification/impact/run/integration contracts；
- #227关闭、合并或被successor替代；
- #175/#179/#189/#191/#205/#207/#219 owner边界改变；
- GitHub Actions或TypeScript相关官方机制发生不兼容变化；
-新的性能profile证明当前critical path判断错误；
-新的安全Evidence否定自动dispatch/publication方案。

正式Work Package启动时必须重新读取最新main和官方来源，而不是复用本Spike的动态结论。