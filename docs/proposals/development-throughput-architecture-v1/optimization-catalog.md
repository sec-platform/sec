---
title: SEC 开发效率全优化目录
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# SEC 开发效率全优化目录

## 1. 使用方式

本目录列出所有已分析优化，但不表示全部应立即实施。每项标记：

- **收益轴**：减少等待、重复、返工、上下文、资源或集成成本；
- **前置**：没有前置就自动化会扩大风险；
- **状态**：当前已实现、部分实现、已设计、候选或后置；
- **退役对象**：新机制稳定后必须删除或收窄的旧路径；
- **反转条件**：何时停止投入。

优先级使用：

```text
P0 当前物理阻塞
P1 直接减少可避免返工
P2 支撑精确复用与恢复
P3 自动反馈与增量
P4 安全并行与规模化
P5 数据驱动持续优化
```

## 2. 任务选择与规划

### OPT-SEL-01：价值/依赖/风险驱动的下一Work Package选择

- 优先级：P2后启动，P4成熟后自动化；
- 收益：减少人为挑选低价值任务和“为了继续开发制造修改”；
- 输入：ready Issues、roadmap阶段出口、依赖DAG、main缺口、风险、预计失效成本、Integration Epoch；
- 输出：条件化候选排序和唯一selected task；
- 约束：Issue存在不等于Ready；不能把branch/PR数量当进度；
- 前置：Task Capsule、Integration Epoch、main readback；
- 反转：自动排序频繁选择基础设施而阻塞核心产品价值。

### OPT-SEL-02：No-change / closeout作为合法首选动作

- 优先级：P0；
- 收益：避免无证据修改；
- 当代码正确且Gate/Review满足时，next action可以是merge、close、cleanup或confirm complete；
- 必须由main/readback和live GitHub facts证明；
- 指标：无意义commit、空分支和重复修复数量。

### OPT-SEL-03：Rolling plan只保留2–5个条件化候选

- 状态：治理已存在；
- 优化：由selection service从Issue graph生成投影，不手工复制动态状态；
- 退役：多处维护“当前/下一批任务”的叙述文档。

## 3. Orientation与事实获取

### OPT-ORI-01：最小充分orientation

- 优先级：P1；
- 普通任务只读取live main/PR/manifest/authority和相关source/tests；
- 全仓audit只在重大架构、重复系统性失败或用户明确要求时触发；
- 指标：orientation duration、files read、full audit escalation。

### OPT-ORI-02：GitHub事实批量读取与增量刷新

- 将PR、Review、threads、workflow、status、Issue和main identity按一次snapshot读取；
- `reload_if`事件发生前复用；
- 禁止无变化轮询；
- 对workflow完成等未来条件使用事件或有界reconcile，而不是Agent反复检查。

### OPT-ORI-03：Resolver code authority与target workspace分离

- 状态：现有orientation已提出；
- 目标：从受信latest main执行resolver，同时解析candidate workspace；
- 防止旧checkout resolver错误解释新manifest；
- launcher无法分离时fail closed。

## 4. Task与上下文

### OPT-CTX-01：Task Capsule Compiler

- 优先级：P1；
- Owner：#205；
- 将目标、root cause、owner、scope、contracts、impact、parallel、verification、resume编译为byte-stable对象；
- 退役：每个Agent重新搜索和重述完整背景。

### OPT-CTX-02：Context Capsule / progressive disclosure

- 优先级：P2；
- 只加载reason-tagged authority、symbols、consumers、tests和failure refs；
- L0–L4分层；
- 指标：context bytes、重复bytes、first edit前读取量；
- 反转：上下文缩小导致authority遗漏或unknown被隐藏。

### OPT-CTX-03：Reconciliation Delta

- main、Review、Evidence、failure或用户scope变化时只发送差异；
- 不重新注入整个Task Capsule；
- 保留未失效Evidence和context refs。

### OPT-CTX-04：生成式引用而不是复制文档

- authority registry、types、schema、test ownership以ref/digest引用；
- Skill、AGENTS、Task Capsule不复制字段表和动态SHA；
- 退役：同一规则在Issue、Skill、docs、workflow、脚本重复维护。

### OPT-CTX-05：上下文预算与价值排序

- 按authority criticality、write proximity、consumer relevance、failure explanatory power排序；
- 输出排除项和原因；
- 不按固定文件数硬裁剪。

## 5. 根因与首轮正确性

### OPT-COR-01：Root-Cause-First preflight

- 优先级：P1；
- Owner：#205；
- 要求最小复现、owner/invariant、因果链、sibling census、shared fix裁决、迁移/退役和完成证明；
- 拒绝只改最后抛错点。

### OPT-COR-02：Change Closure Compiler

- 优先级：P1；
- Owner：#219；
- 自动枚举producer/consumer、transition、identity、cache、environment、trust、concurrency、migration和control-plane；
- 先生成反例再实现。

### OPT-COR-03：Leaf proof

- 防止Root-Cause流程把真正局部缺陷扩大成巨型重构；
- 需要证明shared owner无影响、consumer闭包完整和相邻不变量不变；
- leaf proof本身进入Closure receipt。

### OPT-COR-04：历史failure corpus

- 编码#203→#210、#210→#213、#211→#215、CRLF、pointer drift、intent/action错配等；
- 新Closure版本必须回放；
- escaped failure自动标注`known-cell-missed | closure-model-wrong | physical-unknown`。

### OPT-COR-05：Adversarial Review前移

- candidate冻结前由独立只读Reviewer扩展反例和遗漏；
- exact-head正式Review仍在candidate稳定后执行；
- 防止实现者自证。

## 6. 编辑反馈

### OPT-EDT-01：Warm plan-only analyzer

- 优先级：P3；
- Owner：#189 Phase A；
- watcher hint→bytes digest→incremental diagnostics→Impact/Closure plan；
- 不自动跑产品测试；
- 目标：消灭每次编辑后全仓重扫和人工选lane。

### OPT-EDT-02：Thin feedback

- parse、local type diagnostics、import drift、forbidden path、owner conflict、public surface和micro-sentinel；
- 不运行browser/native/durable/release；
- 反馈对象结构化输出owner、impact path、failure和next action。

### OPT-EDT-03：Revision supersede与取消

- 快速编辑只发布最新revision aggregate；
-旧节点能取消则取消，不能取消则结果标记superseded；
-清理旧资源；
-保留仍有效独立Action结果。

### OPT-EDT-04：编辑后自动格式/import但受scope控制

- 只对owned changed paths运行；
- 输出明确diff；
-不能触碰forbidden/其他owner；
-避免全仓格式化造成噪声。

## 7. TypeScript与编译增量

### OPT-INC-01：TypeScript incremental program

- 优先级：P3；
- 复用compiler program和`.tsbuildinfo`；
- clean/incremental diagnostics parity为硬门禁；
- TS版本、options、lib和toolchain进入identity。

### OPT-INC-02：Project References按真实ownership采用

- 后置；
- 只有真实模块/发布边界和profile收益时拆分；
- 不为缓存命中任意拆包；
- 引入declaration边界、cycle和编辑器导航验收。

### OPT-INC-03：Compiler Incremental Graph

- Owner：#194；
- 管理compiler pass/artifact节点、delta、clean parity、cancellation、memory/backpressure；
- 不与Evidence DAG或Repository Semantic Index双写节点语义。

### OPT-INC-04：Repository Semantic Index

- derived开发索引；
- blob级解析缓存、symbol/import/state/artifact/authority/test/provider edges；
- 服务Context、Impact、Review和Integration；
- 可删除重建；
- 不是第二Engineering IR。

## 8. Test Impact与验证选择

### OPT-IMP-01：Semantic Impact V2

- 优先级：P3；
- Owner：#188；
- 从path/direct import升级到transitive code、contract/state/artifact/target/provider/release语义边；
- unknown frontier显式；
- path规则保守fallback。

### OPT-IMP-02：Selection explanation

- 每个selected/skipped/not-applicable action都有impact path和reason；
-无法证明无影响不等于not-affected；
- UI/Agent无需重新解释selector日志。

### OPT-IMP-03：Selector false-negative learning

- Full/post-merge发现affected漏选时登记selector defect；
-失效旧Evidence；
-反哺Impact rules和failure corpus；
- 同类漏选不能第二次发生。

### OPT-IMP-04：Gate分层保持

```text
edit advisory
→ candidate affected closure
→ pre-freeze
→ frozen Scope/Quick/selected Risk/platform
→ virtual merge/Release Full
```

- 不把Full移入edit loop；
-不把Risk按单次duration随意降级。

## 9. 测试运行时

### OPT-TST-01：保持Fast结构治理

- bounded concurrent shards；
-bounded-parallel isolated；
-exclusive owners；
-parent-owned namespace cleanup；
-immutable cache与mutable run workspace分离。

### OPT-TST-02：减少process waves

- 使用resource registry决定并行，而不是每文件进程；
-相同setup的测试合并共享fixture，但测试隔离不被破坏；
-指标：process starts/waves、workspace setups、exclusive wait。

### OPT-TST-03：Capability-scoped/lazy setup

- slow文件中的不相关named sentinel不启动完整Pipeline/browser/server；
- setup只在selected capability实际需要时执行。

### OPT-TST-04：Focused → final closure

- 开发中只跑当前失败和focused sentinel；
- candidate稳定后运行一次final local closure；
-同一输入PASS复用；
- deterministic FAIL输入不变不重跑。

### OPT-TST-05：Benchmark协议

- 固定candidate/environment；
- warm-up；
-至少5个有效样本；
-median和range；
-单次duration只作诊断；
-结构性owner/coverage是硬约束。

## 10. Hermetic资源

### OPT-RES-01：统一resource identity

- Owner：#190；
- fixture、workspace、port、process、browser、database、network、platform各有identity/owner；
-禁止ambient共享。

### OPT-RES-02：Cleanup作为PASS组成

- cleanup/readback失败使结果failed/invalidated；
-不允许绿色结果伴随残留；
-取消/supersede也必须cleanup。

### OPT-RES-03：Windows/POSIX进程树

- Windows Job Object、POSIX process group/signal/reaping；
- 不用JS普通child kill假设完整settlement；
- 资源provider只拥有物理机制，不拥有Verification Truth。

### OPT-RES-04：worktree closeout

- Owner：#186；
- Git registry+physical directory双readback；
-durable authorization；
-no-follow/reparse-safe cleanup；
-recovery ref；
-receipt。

## 11. Candidate Closure与CI

### OPT-CLS-01：Candidate Closure Engine

- 优先级：P0；
- 详见`candidate-closure.md`；
- 从现有merge bootstrap提炼纯状态、read-only reconciler、trusted dispatch、Review、authorization、publication。

### OPT-CLS-02：single-parent提前形成

- 在dispatch前形成并证明tree不变；
-不让hosted workflow因4 commits才首次失败；
-head变化失效旧Review/Evidence。

### OPT-CLS-03：事件驱动+定时reconcile

- PR/workflow/main事件作为主路径；
-schedule只修复漏事件和stale cleanup；
-所有handler幂等。

### OPT-CLS-04：old-head cancellation

- candidate concurrency group；
-cancel-in-progress；
-保留独立Action结果；
-统计stale work seconds。

### OPT-CLS-05：共同setup去重

- checkout、toolchain、install、changed scope可成为受信DAG节点；
-后续job验证digest后消费；
-不能把workflow workspace直接视为跨job可信状态。

### OPT-CLS-06：post-merge settlement

-产品merge和control-plane settlement区分；
-能原子则原子；
-需要merge SHA时由受信reconciler处理；
-failure标记reconciliation-required并可恢复。

## 12. Evidence与缓存

### OPT-EVD-01：Action Key先行

- 优先级：P2；
- action definition + input closure + environment + toolchain/provider + contract + resource identity；
-禁止branch/PR/time/chat进入纯Action key。

### OPT-EVD-02：Action Cache + CAS

-先本地/现有artifact；
-后接`cacache`或remote store；
- Action Cache保存key→result metadata，CAS保存immutable bytes；
-远程执行不属于V1。

### OPT-EVD-03：Trust namespaces

- local-untrusted、local-trusted、hosted-trusted；
-low-trust PR不能污染default trusted cache；
-merge authority只消费policy允许的producer。

### OPT-EVD-04：Failure cache

- failure fingerprint相同且因果输入不变时不重跑；
-直接返回诊断和next action；
-失败永不成为positive Evidence。

### OPT-EVD-05：Cache invalidation与撤销

-按producer/revision/action family撤销；
-cache poison、schema升级、security event可批量失效；
-cache删除不改变正确性。

### OPT-EVD-06：GitHub cache节制

- dependency/cache key绑定OS、Bun、lock和相关配置；
-restore key只作hint；
-PR关闭清理branch-scoped cache以减轻thrashing；
-监控容量、eviction和低复用entry。

## 13. Run Journal与恢复

### OPT-RUN-01：Immutable Run events

- 优先级：P2；
-每个合法transition写event/capsule；
- stable runId位于Git common dir状态根；
-session/worktree为binding。

### OPT-RUN-02：Deterministic resume

- 校验repo/head/tree/index/worktree/manifest/authority/instructions/skills/Evidence；
-重算失效refs；
-输出唯一next transition；
-不依赖聊天摘要。

### OPT-RUN-03：Prompt intake

- 用户消息先分类scope/goal/priority delta；
- “继续”执行现有next transition；
-新目标生成Reconciliation Delta；
-不直接覆盖phase或权限。

### OPT-RUN-04：正交locks

- recovery、pending prompt、instruction fence、proof reset、cleanup、integration invalidation与phase分离；
-避免phase枚举爆炸。

## 14. 并行与Integration Queue

### OPT-PAR-01：#207 resolver correctness

- 优先级：P4前置；
- relation、requires方向、cycle、missing、authority/path/resource、verification独立性、epoch重算。

### OPT-PAR-02：Integration Epoch Registry

- exact base、packages、pairwise matrix、global writers、session/worktree bindings、state/digest；
- base/manifest变化立即invalidated。

### OPT-PAR-03：Virtual Merge

-临时Git tree而不是长期integration branch；
-顺序进入identity；
-组合changed records、Impact、Closure、Evidence；
-运行新增组合节点。

### OPT-PAR-04：两层并发

- Work Package并行由Integration Epoch；
-候选内部Action并行由Evidence DAG/resource owner；
-不得用统一并发数替代语义。

### OPT-PAR-05：最佳Agent并行结构

默认：

```text
1个写Worker
+ 只读consumer/impact分析
+ 独立Reviewer
+ CI Actions并行
```

只有两个formal seam被机器证明不冲突时才使用多个写Worker。

### OPT-PAR-06：候选失败隔离

-失败候选blocked；
-无依赖候选继续；
-只失效相关Evidence；
-避免“一条线失败全部重跑”。

## 15. Git与仓库操作

### OPT-GIT-01：Typed repository actions

- create issue/comment/branch/file/ref/dispatch/merge/delete ref；
-每次验证intent、target、permission、expected identity、dry-run、reversibility、readback、receipt；
-防止工具路由错动作。

### OPT-GIT-02：显式stage owned paths

-不使用宽泛`git add .`；
-变更前后scope census；
-renames/copies和case变化显式处理；
-imports freeze只针对owned delta。

### OPT-GIT-03：不使用破坏性恢复

-禁止hard reset、force push frozen candidate、跨worktree stash/clean；
-未审计用户工作保持保护；
-失败恢复通过新commit、reconcile或authorized cleanup。

### OPT-GIT-04：Branch hygiene

- branch承载产品演进，不承载测试参数；
-合并后删除完成使命的head branch；
-validation/diagnostic默认不合并；
-Spike成果提炼，不合并过程噪声。

## 16. 文档与生成投影

### OPT-DOC-01：单一canonical owner

- stable facts唯一ownership key；
-navigation/proposal/evidence不竞争authority；
-动态SHA/run/failure不进入稳定docs。

### OPT-DOC-02：生成投影

```text
authority registry → docs index
Skill registry → routing projection
Work Package registry → plan view
verification registry → matrix/reference
schema/types → generated reference
```

-减少人工同步和漂移。

### OPT-DOC-03：文档只保存机制与取舍

-字段/enum/path/version由代码/reference生成；
-文档保留why、边界、不变量、迁移和现实能力；
-历史迁archive并标记historical。

### OPT-DOC-04：Docs变化最小验证

- registry/frontmatter/H1/link/Unicode/dynamic policy/pointer/Skill coverage；
-纯文档不无条件运行产品Full；
-authority变化仍触发相应contract/Review。

## 17. Toolchain与依赖

### OPT-TOL-01：唯一Toolchain Profile

- Bun exact toolchain、Node public host、Target runtime分离；
-version、平台、package surface和provider identity明确；
-不因仓库用Bun推导产品只能Bun。

### OPT-TOL-02：依赖域和唯一package/lock writer

- Core、Node Host、Bun Toolchain、Verification、Target、Workbench、External Provider、Build/Release；
-每个dependency有真实consumer和退役条件；
-package/lock全局exclusive writer。

### OPT-TOL-03：成熟轮子按consumer引入

- TypeScript incremental；
-cacache物理store；
-chokidar watcher；
-fast-check properties；
-execa/env-paths/tempy等Provider候选；
-先物理Evidence，后依赖写入；
-不为未来可能使用提前添加。

### OPT-TOL-04：安装次数最小化

-同一lock/toolchain Action Key复用；
-worktree/CI不重复安装；
-不得依赖相邻worktree或全局PATH冒充当前依赖；
-clean install仍可重建。

## 18. 外部Provider与网络

### OPT-EXT-01：Capability Ledger

-每个外部工具声明purpose、version、permission、data boundary、failure、owner、retirement；
-外部输出只作Evidence线索，不成为SEC事实。

### OPT-EXT-02：CLI优于常驻MCP的低频工具

-减少context、进程和权限常驻成本；
-只有频繁、结构化、确有收益的能力才保留standing provider；
-无consumer入口退役。

### OPT-EXT-03：网络调用内容寻址与有界

-请求参数、provider version、response identity进入Evidence；
-重试只针对明确瞬态；
-不可用返回unsupported/not-run；
-不让optional provider阻断Core。

## 19. 安全与权限

### OPT-SEC-01：Role × Envelope × Policy × Provider × Transition权限交集

-不让Skill或Agent自授权；
-Review只读；
-Worker无merge/hosted Gate；
-Integrator publication权限分级。

### OPT-SEC-02：GitHub App最小权限

- dispatch阶段不需要contents write；
-publication阶段单独授权；
-token不进入日志/event/cache；
-每个action有audit receipt和expected target。

### OPT-SEC-03：Candidate-as-untrusted-SUT

-trust-root变化由base verifier；
-candidate workflow不能授权自身；
-普通successor PR证明新epoch。

### OPT-SEC-04：Automation kill switch

-Candidate Closure、Daemon、Queue均可降级read-only；
-撤销write token；
-保留manual safe primitive；
-不回退产品事实或Verification Truth。

## 20. Observability与成本

### OPT-OBS-01：Typed transition telemetry

-从state/action/receipt自动记录；
-不记录隐藏推理和源码正文；
-秘密禁止进入telemetry。

### OPT-OBS-02：Critical path waterfall

- selection、orientation、authoring、feedback、rework、Gate queue/execution、Review、integration、publication和cleanup分开；
-优化最长路径，不只优化易测阶段。

### OPT-OBS-03：Actions与资源成本

- Actions minutes、install、process/browser starts、memory/CPU、cache bytes/thrash、exclusive queue wait；
-按change/trust/platform分类。

### OPT-OBS-04：反激励指标

- commit/branch/Agent/test数量不作为效率主指标；
-防止通过拆碎PR、延迟freeze、少测和扩大unknown美化指标；
-详见`metrics.yaml`。

## 21. AI工作方式

### OPT-AI-01：一个operation一个primary Skill

- Skill V2目标；
-共享确定性规则由机器contract；
-Role和Skill分开；
-避免多个prose owner竞争。

### OPT-AI-02：AI只处理不可确定部分

AI负责：

-新架构与语义；
-根因竞争解释；
-unknown调查；
-权衡和迁移；
-代码实现；
-对抗Review。

机器负责：

-identity；
-permission；
-scope；
-selection；
-state transition；
-Evidence reuse；
-Gate调度；
-publication readback。

### OPT-AI-03：输出Reconciliation Delta而非长报告

Worker结果结构化：

- changed symbols；
-tested identity；
-Evidence delta；
-invalidated assumptions；
-blocker；
-next transition；
-不重复整个任务背景。

### OPT-AI-04：错误早暴露

- implementation前Closure；
-edit后thin feedback；
-candidate前adversarial omission；
-merge前virtual combination；
-post-merge readback；
-避免问题逐阶段向后逃逸。

## 22. CI与GitHub Actions

### OPT-CI-01：concurrency按candidate/PR

-旧head取消；
-同一candidate同一Gate identity只执行一次；
-不同physical resource owner独立group；
-不能依赖queue FIFO决定工程顺序。

### OPT-CI-02：Job common nodes复用

-checkout trust、install、inventory、changed scope形成DAG节点；
-artifact消费前校验digest/producer；
-避免每lane重复setup。

### OPT-CI-03：最小权限与固定action SHA

-现状已固定第三方action commit；
-各job最小permissions；
-persist-credentials false；
-网络fetch只在受信明确需要时执行。

### OPT-CI-04：Artifact命名与查询不用字符串脆弱解析

-当前run title编码PR/head用于workflow_run匹配；
-目标增加结构化receipt/status payload或artifact metadata；
-标题仅展示，不成为唯一machine identity。

### OPT-CI-05：定时reconcile不代替事件

-schedule清理stale状态、补漏和审计；
-正常candidate推进由事件/receipts；
-避免每6小时全量无差别重验。

## 23. Release与主干

### OPT-REL-01：Merge及时收口

- Gate/Review/identity明确就合并；
-不为表现仍在开发继续改正确代码；
-不让Ready PR长期悬空失效。

### OPT-REL-02：new-main semantic readback

-按tree/behavior/contracts判断结果进入main；
-squash后不按commit ancestry误判；
-确认migration/retirement和用户可观察能力。

### OPT-REL-03：后继普通PR验证trust变更

- trust-root包合并只证明新机制进入main；
-需要一个普通候选成功消费，才证明开发闭环现实可用。

## 24. 不应实施或必须后置

- 立即迁移Bazel/Nx/Pants；
- remote execution；
-没有Action Key的remote cache；
-无限Agent并行；
-长期integration branch；
-所有测试放入watch loop；
-用AI判断PASS；
-按duration单独删除覆盖；
-把GitHub Merge Queue当Integration语义；
-把Repository Semantic Index提升为产品IR；
-把整个吞吐平台设为所有产品工作的先决条件。

## 25. 最短收益排序

```text
1. 收口当前#227
2. Candidate Closure pure state/read-only
3. trusted dispatch
4. Task Capsule + Change Closure read-only
5. Epoch/Failure
6. Action Key/Evidence core
7. Run Journal/Kernel shadow
8. Impact V2 minimal
9. warm plan-only feedback
10. #207 Integration Epoch
11. virtual merge shadow
12. hermetic automatic execution
13. publication automation
14. telemetry-driven tuning
```

每一步必须进入新`main`并readback；没有真实阻塞时优先收口而不是继续扩大设计。