---
title: Development Throughput Architecture 对抗审查
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# Development Throughput Architecture 对抗审查

## 1. 审查目标

本审查不检查文档是否“完整好看”，而是攻击以下可能：

-新组合层成为第二状态机；
-自动化扩大写权限和错误merge半径；
-cache/增量以漏声明输入换取假命中；
-context裁剪隐藏authority和unknown；
-基础设施路线阻塞核心产品；
-并行与virtual merge制造更多返工；
-指标奖励错误行为；
-历史性能被误当当前事实；
-目标架构无法从当前代码渐进落地。

## 2. 攻击一：Candidate Closure会不会与Run Kernel双写状态？

### 攻击

Candidate Closure定义`prepared → scope → verification → review → merge → readback`，Run Kernel也记录phase和next transition。如果两者都拥有current state，恢复时可能出现：

- Closure认为`verification-passed`；
- Kernel认为`running`或`candidate`；
- GitHub live state又显示head已变化。

这会把“统一闭环”变成第三套状态。

### 裁决

Candidate Closure拥有**领域状态投影和transition receipt schema**；Run Kernel只拥有run event chain、precondition验证和next transition调度。Kernel事件引用Closure receipt，不复制其状态推导。

```text
GitHub/Git/Evidence facts
→ Candidate Closure reconciler
→ domain state + receipt
→ Run Kernel event references receipt
```

### 阻断条件

正式WP若在Run capsule中复制Scope/Verification/Review字段算法，而不是引用receipt，必须拒绝。

### 反转

如果无法形成稳定的领域receipt边界，应把Candidate Closure降为纯read-only查询，不推进自动mutation。

## 3. 攻击二：Candidate Closure会不会成为第二Verification owner？

### 攻击

编排器为了判断下一步，可能逐渐内置：

- 哪些Gate required；
-什么是PASS；
-哪些Risk可跳过；
-哪些Evidence可复用。

### 裁决

Closure请求必须包含`verificationPolicyRef`和owner生成的plan；Closure只能检查结果是否满足引用的claim，不定义claim。

禁止在Closure代码出现第二套status aggregate、path→test规则或platform applicability。

### 机器门禁

-依赖方向测试；
-禁止导入/复制Verification内部算法；
-plan/result schema contract tests；
-Review检查重复枚举和状态表。

## 4. 攻击三：exact-one next transition是否过度串行？

### 攻击

若每个run只能有一个next transition，可能错误串行化：

-独立focused tests；
-Scope和只读Review准备；
-多个parallel-safe Work Package；
-多个Evidence节点。

### 裁决

“一个next transition”针对一个**状态owner的原子提交**，不限制transition内部引用DAG并发，也不限制多个run在Integration Epoch下并行。

```text
one run transition
  contains action DAG with parallel nodes
multiple runs
  authorized by integration epoch
```

### 反转

如果实现把所有Action强制单线程，必须拆出machine-owned execution plan，而不是取消transition确定性。

## 5. 攻击四：GitHub App自动dispatch/merge会扩大灾难半径

### 攻击

个人`gh`流程虽慢，但每次有人确认。服务拥有Actions和merge权限后，路由bug可能：

-对错误repo/PR dispatch；
-重复merge；
-错误删除branch；
-绕过Review；
-泄露token。

### 裁决

权限分阶段：

1. read-only reconciler；
2. dispatch-only App，无contents write；
3. Review request；
4. authorization-only，人工merge；
5. expected-head merge；
6. cleanup按独立provider授权。

每一级必须有typed action、target identity、expected precondition、readback和kill switch。

### 阻断条件

-无法把dispatch和merge权限分开；
-token进入日志/Journal/cache；
-没有expected-head；
-网络错误后不readback直接重试；
-main写权限可被plan-only operation调用。

## 6. 攻击五：Action Key完整输入几乎不可能声明

### 攻击

实际命令可能读取：

-ambient PATH；
-home config；
-系统证书；
-timezone/locale；
-network服务；
-未声明文件；
-native库和CPU特征。

若Action Key漏项，复用会假绿。

### 裁决

V1只缓存输入闭包可证明的动作：install、repository census、import plan、TS diagnostics/typecheck、test inventory和明确focused tests。物理/外部动作默认不复用或由owner提供environment/resource identity。

### 防线

- hermetic env allowlist；
-process/file access diagnostic census；
-clean/hosted parity；
-cache disable fallback；
-low-trust结果不进入merge authority；
-Full/post-merge发现错误复用时撤销producer/action family。

### 反转

若维护Action closure的成本超过重跑成本，保留该Action非缓存；不能通过弱化key强行提高命中率。

## 7. 攻击六：Context Capsule缩短token会漏掉决定性authority

### 攻击

“少加载文件”容易成为效率KPI，导致：

-遗漏公共consumer；
-不读最新authority；
-只看局部测试；
-unknown被省略；
-模型首轮更快但返工更多。

### 裁决

Context大小不是独立目标，必须绑定：

- authority coverage；
-consumer closure；
-unresolved frontier；
-first-pass yield；
-escaped defect。

每个被排除ref有reason。缺索引时保守加载或阻断，不能推导not-affected。

### 反转

若Context Compiler不能比人工Capsule保持同等或更高的历史回放覆盖，停止自动裁剪，仅保留引用和digest功能。

## 8. 攻击七：Repository Semantic Index会变成第二IR和持续维护负担

### 攻击

索引逐渐增加state、artifact、authority、provider和test语义，可能：

-复制Engineering IR；
-拥有新的identity/revision；
-需要持续迁移；
-索引陈旧导致错误Impact。

### 裁决

索引只拥有从exact Git tree和registry可重建的派生分析。禁止：

-产生产品canonical IDs；
-写回source；
-覆盖Engineering IR；
-在缺失时宣称无影响；
-成为唯一产品查询入口。

### 反转

若clean/incremental parity频繁失败，或维护时间超过重复解析节省，缩回TS import/export和owner索引，不扩展全语义图。

## 9. 攻击八：TypeScript Project References可能带来更多复杂度

### 攻击

Project References需要composite、declaration、边界和构建顺序，可能：

-破坏编辑器体验；
-增加配置；
-制造跨项目类型边界；
-对当前规模没有净收益。

### 裁决

不是路线前置。先用Incremental Program和现有`.tsbuildinfo`，收集typecheck profile；只有真实模块ownership、稳定public boundary和显著净收益时采用。

### 验收

-clean/incremental parity；
-editor navigation；
-declaration freshness；
-cycle检测；
-config维护成本；
-P50/P95和内存。

## 10. 攻击九：Automatic Feedback Daemon会持续耗资源和制造噪声

### 攻击

常驻watcher、TS program、index和tests可能：

-高CPU/内存；
-频繁取消；
-占用ports/process；
-输出不断变化；
-让开发环境比显式命令更不稳定。

### 裁决

分阶段：plan-only→thin checks→candidate execution。默认debounce不靠时间成为identity，而以bytes revision收敛。heavy physical actions不进入edit loop。

### Kill switch

-单命令停daemon；
-清理所有owned resources；
-回退现有显式commands；
-derived state可删除；
-不影响main和Evidence truth。

### 反转

若stale work、CPU/memory或噪声成本高于节省，保持plan-on-demand而非常驻。

## 11. 攻击十：Virtual Merge无法预测Windows/browser/database等物理冲突

### 攻击

Git tree组合通过不意味着：

-两个候选可共享port/browser cache；
-native平台通过；
-migration顺序安全；
-外部服务状态兼容。

### 裁决

Virtual Merge只证明组合tree和可执行closure；physical resource conflict由Integration Epoch resource registry和selected physical Gate证明。

不得把virtual tree PASS投影为所有环境PASS。

### 反转

若关键冲突主要来自不可建模外部资源，Queue保留人工顺序和physical Gate，不自动publication。

## 12. 攻击十一：更多并行会增加失效和合并等待

### 攻击

即使pairwise safe，多个PR长期并行也会因main连续前进导致：

-频繁rebase；
-Evidence失效；
-Review stale；
-queue wait；
-认知切换。

### 裁决

并行目标是2–4个真实独立包，不是最大化会话数。队列排序应考虑失效成本和预计交付时间；global writers保持单一。

### 指标

- effective main slices；
-Evidence retained after main advance；
-queue wait；
-reorder；
-late conflict；
-context switching。

若并行使总吞吐下降，收缩active set。

## 13. 攻击十二：基础设施会无限阻塞产品核心

### 攻击

#175路线包含Verification、Impact、Failure、Bootstrap、Resources、Evidence、Daemon、Properties、Integration、Incremental等大量能力。如果全部视为前置，SEC会长期只建设开发平台而没有编译器核心进展。

### 裁决

-普通产品修复继续执行；
-只建设有当前consumer的最小Slice；
-P0 Candidate Closure直接解决#227样本；
-read-only contracts先行；
-每个基础设施包必须由后继真实产品PR验收；
-没有真实瓶颈证据时不继续深化。

### 预算建议

在核心产品尚未形成更高价值纵切片前，吞吐基础设施不能无限占据全部formal packages。Selection应比较：

```text
expected future time saved
× recurrence
× confidence
- implementation cost
- trust risk
- delayed product value
```

## 14. 攻击十三：指标会被游戏

### 攻击

-为了first-pass yield，在freeze前无限手工检查；
-为了PR cycle time，把任务拆成无独立价值小PR；
-为了cache hit漏声明输入；
-为了context小省略authority；
-为了并行数把unknown当safe；
-为了Gate快减少覆盖。

### 裁决

`metrics.yaml`为每个主指标绑定guardrail。所有效率结论同时报告：

- Verification completeness；
-unknown frontier；
-escaped defects；
-cleanup residue；
-manual pre-freeze work；
-slice independent value。

活动量指标只作诊断，不作目标。

## 15. 攻击十四：历史55秒Fast基线可能已过时

### 攻击

该数字来自历史candidate和环境，当前main、机器、cache或测试inventory可能变化。

### 裁决

只用于证明“测试本体曾完成结构治理”和提供profile方法，不作为当前SLO。正式优化前重新固定当前candidate/environment采样。

禁止在README或路线中写“当前Fast就是55秒”的无条件事实。

## 16. 攻击十五：post-merge settlement可能永远无法原子

### 攻击

active pointer可能需要merge SHA或new main，无法与产品candidate原子提交。两阶段必然存在窗口。

### 裁决

明确saga：

```text
product merge committed
→ main readback
→ settlement requested
→ settlement committed
→ cleanup completed
```

每步有幂等receipt。产品结果和control-plane状态分开，不用假装完全原子。若settlement失败，进入`reconciliation-required`并禁止选择错误next package。

## 17. 攻击十六：Proposal本身会变成新的巨型重复文档

### 攻击

本目录超过数千行，可能复制Issue和authority，增加维护成本。

### 裁决

本目录是一次性Spike综合，不进入active authority。正式采用时：

-只提炼pure contracts和对应owner的窄authority变化；
-不把整个目录合并进main；
-Issue #230完成后关闭；
-后续事实进入原owner Issue/code；
-研究分支保留或删除按工具能力处理。

## 18. 最终裁决

### 高置信度

-当前主要即时瓶颈是candidate closure，不是继续压单个Fast样本；
-Action Key必须先于CAS；
-Task/Closure/Impact/Evidence/Run/Integration必须保持唯一owner；
-上下文恢复必须外化；
-并行必须基于authority/resource而非Git文本；
-指标必须覆盖ready→main readback完整critical path。

### 中等置信度

-Candidate Closure最适合提炼为独立领域编排器；
-Context Capsule可显著减少重复读取；
-Repository Semantic Index具有净收益；
-warm plan-only daemon能早期降低成本；
-virtual merge对2–4个候选有净收益。

### 低置信度，必须实测

-具体部署形态；
-自动publication权限；
-Project References；
-本地/remote CAS命中率；
-性能SLO；
-多写者最佳数量；
-完整自动selection。

## 19. Spike完成条件

本设计只有在以下全部成立时可结束研究：

-每个能力映射唯一owner；
-状态、输入输出和invalidation可机器表达；
-最短落地顺序和回滚明确；
-历史和对抗评测覆盖；
-强竞争解释和反转条件记录；
-无当前runtime/control-plane修改；
-不宣称目标能力已实现；
-正式下一步可从最新main创建聚焦Work Package，而不需要重新解释整套设计。