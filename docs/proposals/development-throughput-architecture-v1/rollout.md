---
title: Development Throughput Architecture 正式落地顺序
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# Development Throughput Architecture 正式落地顺序

## 1. 原则

本路线不是把所有吞吐基础设施变成产品开发前置。每个正式Work Package必须满足：

- 从执行时最新`main`冻结；
-拥有单一自然责任和明确consumer；
-可独立进入main、readback、回滚和退役旧路径；
-先交付read-only合同，再增加自动副作用；
-普通产品修复不等待整个吞吐平台完成；
-任何trust-root变化由旧受信基线验证；
-并行只由#207后的Integration Epoch机器授权；
-本Spike分支和提交历史不直接合并。

## 2. 当前前置收口

在启动任何正式吞吐WP前：

1. 收口当前PR #227 / Issue #217，或准确关闭/取代；
2.确认其产品结果是否进入最新main；
3.归档/切换active Work Package；
4.复核开放PR、Review、CI和main；
5.删除或记录无法删除的已完成Spike/临时branch；
6.从新main重算本路线。

原因：吞吐trust-root不应与当前verification artifact产品修复共享active control plane或base。

## 3. 总体序列

```text
WP-T0 Candidate Closure State
→ WP-T1 Candidate Closure Read-only Reconciler
→ WP-T2 Trusted Dispatch Adapter
→ WP-C0 Task + Change Closure Read-only Contracts
→ WP-F0 Epoch / Failure Core
→ WP-B0 Trusted Bootstrap
→ WP-E0 Evidence Action Key / Result Core
→ WP-R0 Run Journal + Kernel Shadow
→ WP-I0 Impact V2 Minimal Consumer Interface
→ WP-A0 Warm Feedback Plan-only
→ WP-P0 Parallel Resolver V1.1 / Integration Epoch
→ WP-V0 Virtual Merge Shadow
→ WP-H0 Hermetic Execution Integration
→ WP-C1 Automatic Candidate Closure Publication
→ WP-O0 Telemetry Baseline / Optimization Loop
```

这不是永久固定顺序。每次main变化后由真实依赖和write/resource set重算；允许机器证明的并行，但不靠本文件授权。

## 4. WP-T0 — Candidate Closure纯合同

### 目标

把当前散落在merge bootstrap、workflow和Skill中的候选状态编译为纯类型/validator。

### 建议owner

```text
integration.candidate-closure-contract
```

### 允许范围

-新的pure shared contract；
-focused unit/contract tests；
-必要test-impact登记；
-窄authority projection。

### 禁止

- workflow写入；
-GitHub API调用；
-merge；
-package/lock；
-PR #227产品路径；
-自动dispatch。

### 产物

- CandidateIdentity；
- ClosureRequest；
- ClosureState；
- Transition；
- TransitionReceipt；
- PublicationReceipt；
- exact-key parser/validator；
-非法跳转和invalidation测试。

### 验收

-同一外部事实得到唯一state/next transition；
-所有stale/missing/ambiguous输入fail closed；
-不复制Verification/Review/Impact算法；
-历史PR #227状态可纯函数解析。

### Trust

若只新增pure contract且不改变现有Gate选择，可按普通共享合同变化验证；若加入merge-gate trust set，则走manual bootstrap。

## 5. WP-T1 — Read-only Candidate Closure Reconciler

### 目标

从GitHub/Git/manifest/Evidence读取当前候选闭包状态，只输出计划，不写任何外部资源。

### 产物

```text
sec candidate status --pr <n> --json
```

输出：

- exact identity；
-current closure state；
-valid/invalid Evidence；
-blockers；
-唯一next transition；
-所需typed action request；
-不执行动作。

### 验收

-与人工审查至少10个历史/当前PR一致；
-进程重启输出byte-stable；
-PR #227 shadow运行不产生mutation；
-多open PR/shared head/base advance正确阻断；
-可作为Run Kernel和Agent输入。

## 6. WP-T2 — Trusted Dispatch Adapter

### 目标

把Scope/Verification dispatch从个人本地`gh`凭据迁为受信、最小权限、幂等adapter。

### 设计选择

优先使用GitHub App或仓库受信service identity。不得把任意AI session授予admin token。

### 允许动作

- `sec-scope-attest-v1` dispatch；
- `sec-verify-frozen-v1` dispatch；
- workflow run/read artifact；
- stale run cancellation；
- transition receipt发布。

### 暂不允许

- merge；
-update main；
-delete ref；
-close Issue。

### 验收

-duplicate request幂等；
-exact head/base/manifest不匹配拒绝；
-old head cancellation；
-trust-root candidate返回manual bootstrap；
-服务重启不重复dispatch；
-权限审计证明无不必要`contents:write`。

### Trust route

该包修改workflow/API trust path，必须：

1. base-side pure contract验证；
2.独立Review；
3.管理员manual integration；
4.新main readback；
5.普通非trust-root successor PR证明真实dispatch。

## 7. WP-C0 — Task Capsule + Change Closure Phase A

### 目标

组合#205和#219的read-only部分，但保持两个schema和owner分离。

### 任务A：Task Capsule

-从Issue、manifest、authority、root cause、Impact生成稳定Capsule；
-关键unknown显式；
-不修改产品。

### 任务B：Change Closure

-消费Task Capsule；
-生成producer/consumer/state/identity/environment/trust/migration/counterexample表；
-回放#203→#210、#210→#213、#211→#215、CRLF和intent/action错配。

### 并行条件

只有#207证明两者authority/path/resource独立时，才能并行开发；逻辑上Task Capsule先于Closure消费。

### 验收

-相同输入byte-stable；
-历史后来暴露的已知缺口在首次Closure Plan出现；
-局部叶节点可以提供leaf proof；
-不自动签发authoring或修改代码。

## 8. WP-F0 — Epoch / Failure Core

### Owner

#177。

### 最小范围

- Authoring/Candidate/Frozen；
- failure class/input/fingerprint/occurrence；
- typed next action；
- invalidation and proof-reset signal；
-不接完整Impact或Evidence DAG。

### 验收

-相同失败输入不重复计新occurrence；
-环境因果变化后才能受限重试；
-head变化准确失效；
-Change Closure receipt作为pre-freeze输入但不复制其规则。

## 9. WP-B0 — Trusted Bootstrap / TCB Core

### Owner

#178。

### 目标

收敛当前workflow中分散的trust file清单、base-side request、candidate-as-SUT和manual-bootstrap状态。

### 验收

-唯一trust registry；
-候选不能修改验证自身的受信实现；
-TCB closure可解释；
-trust-root变化输出manual-bootstrap-required；
-普通successor PR证明新trust epoch。

## 10. WP-E0 — Action Key / Result / Evidence DAG Core

### Owner

#179 Phase A。

### 首批节点

- dependency install；
- repository census；
- import plan；
- typecheck；
- test inventory；
- affected plan；
- focused/fast test；
- build/platform smoke。

### 不在首批

- browser live readiness；
-port/process group；
-database/container；
-remote cache；
-remote execution。

### 验收

-Action Key完整性测试；
-same key精确复用；
-toolchain/env/selector/input变化失效；
-local-untrusted与hosted-trusted隔离；
-deterministic failure可复用；
-cache删除后可clean重建；
-local cache不形成merge authority。

## 11. WP-R0 — Run Journal / Kernel Shadow

### Owner

#179 Run Journal + Development Run Kernel proposal，保持职责分离。

### Phase

-记录但不控制；
-每个真实transition产生event/capsule；
-与人工next transition比较；
-compact/restart/worktree/session切换回放。

### 验收

-至少10个真实开发transition shadow一致；
-相同外部状态给出相同next transition；
-损坏chain从最后合法generation恢复；
-instruction/worktree/manifest mismatch阻断；
-不恢复隐藏思维；
-不创建第二Failure/Evidence语义。

## 12. WP-I0 — Impact V2最小消费接口

### Owner

#188。

### 首批目标

不一次重建全部图。先支持高频共享变化：

- TypeScript import/export传递；
-public type/schema；
-state/artifact producer-consumer；
-authority owner；
-test owner；
-provider/platform requirement；
-unknown frontier。

### 验收

-affected empty source change fail closed；
-clean complete scan与incremental plan一致；
-selector false-negative corpus；
-path规则保留为conservative fallback；
-输出可被Task Capsule、Feedback和Evidence DAG消费。

## 13. WP-A0 — Warm Feedback Plan-only

### Owner

#189 Phase A。

### 目标

`sec dev`或过渡`bun run dev`自动更新：

- TypeScript diagnostics；
- changed digests；
-Impact paths；
-required action plan；
-owner和unknown；
-不自动运行产品/physical tests。

### 验收

-watcher只作hint；
-重复事件按bytes合并；
-rapid edits只发布最新revision；
-plan解释所有选择；
-不产生PASS或副作用；
-clean restart结果一致。

## 14. WP-P0 — #207 Resolver V1.1 / Integration Epoch

### 目标

在任何正式多写者并行前修正relation和epoch语义。

### 验收

严格采用#207已列出的至少10类回归：requires方向、ordered/conflict、cycle/missing、authority prefix、permitted、rename/case、verification resource、5包matrix、main/cancel/recompute。

### Trust

该包不能使用当前未验证resolver给自己授权并行；默认单一active Work Package或人工保守证明。

## 15. WP-V0 — Virtual Merge Shadow

### 目标

纯Git tree构造，不自动merge。

### 产物

- ordered candidate list；
- virtual tree identity；
- combined changed records；
-组合Impact/Evidence plan；
-conflict/unknown；
-shadow queue recommendation。

### 验收

-A→B与B→A分别计算；
-不创建长期远端integration branch；
-前一PR进入main后重算；
-无关candidate Evidence保持；
-与实际顺序合并后的tree/closure对比。

## 16. WP-H0 — Hermetic Execution Integration

### Owner

#190 + #189 Phase B，职责分离。

### 目标

自动反馈可以安全执行selected actions。

### 必须先有

-Verification Truth；
-Epoch/Failure；
-resource allocation/cleanup receipt；
-Impact plan；
-Action Key/Evidence core。

### 验收

-workspace/process/port/browser等各有owner；
-cancel/supersede cleanup；
-cleanup unknown不PASS；
-编辑循环不启动heavy physical gates；
-candidate/Frozen只运行required closure。

## 17. WP-C1 — Candidate Closure Publication

### 目标

在T0–T2 shadow稳定后，允许自动Review请求、merge authorization和publication。

### 分级权限

1.自动请求Review；
2.自动生成authorization但人工merge；
3. expected-head merge；
4. post-merge reconciliation；
5. branch/Issue/worktree cleanup。

每一级独立验收，不能一次授予所有写权限。

### 验收

-普通非trust-root候选全链通过；
-中断恢复不重复Gate/merge；
-main readback验证产品结果；
-pointer settlement失败可恢复；
-delete能力缺失准确记录；
-manual transition count达到0或仅保留明确policy approval。

## 18. WP-O0 — Telemetry与持续优化

### 目标

实现`metrics.yaml`事件和dashboard，不先冻结武断SLO。

### 首批视图

- critical path waterfall；
-wait vs execution；
-first-pass/rework；
-Evidence reuse/invalidation；
-context load/resume；
-Actions cost；
-integration queue。

### 数据最小化

-不记录隐藏推理；
-不上传源码正文作为metric；
-只记录typed identity、duration、counts、classification和receipt refs；
-secret/credential禁止进入event。

## 19. 可以并行的研究/只读工作

在正式单一active WP期间，以下可并行，但不能写其owner路径：

-历史failure corpus标注；
-Action Key候选census；
-context load telemetry设计；
-TypeScript incremental benchmark；
-GitHub App权限设计；
-cache容量/eviction观察；
-virtual merge纯Git实验；
-external provider研究。

任何研究成立后都要提炼正式focused package，不能合并Spike噪声。

## 20. Rollback

### Candidate Closure

-自动推进异常时切换read-only reconciler；
-保留现有merge-gate和manual bootstrap；
-撤销服务write token；
-不回退Verification Truth。

### Evidence Cache

-禁用reuse，clean rebuild；
-按producer/revision撤销；
-local store可删除；
-不得删除canonical Evidence或main。

### Run Kernel

-停在shadow；
-从Git/GitHub事实重新orientation；
-保留event chain作diagnostic；
-不让损坏journal阻断人工安全收口。

### Feedback Daemon

-退回plan-only或显式commands；
-清理owned processes/resources；
-不删除现有test/check入口。

### Integration Queue

-退回单一formal package和人工顺序；
-关闭自动publication；
-保留pairwise/virtual Evidence；
-不创建长期integration branch。

## 21. 退役矩阵

| 旧路径 | 退役条件 | 保留形态 |
|---|---|---|
| `sec-merge-bootstrap.ts`拥有全状态 | Candidate Closure publication真实闭合 | thin operator/diagnostic CLI |
| 手工聊天resume | Run Journal + Kernel真实compact/restart验收 | emergency manual orientation |
| 人工选择affected/typecheck/Risk | Automatic Feedback Phase B | explicit override/diagnostic |
| path-only impact主算法 | Impact V2 clean parity | conservative fallback |
| 一个formal package默认 | Integration Epoch真实闭合 | unresolved/conflict fallback |
| 多文档/Skill重复transition prose | typed contract和生成投影 | 窄authority链接 |
| 本地成功日志作为完成说明 | trusted Evidence/receipt | diagnostic log |
| post-merge人工pointer修补 | settlement reconciler稳定 | emergency repair command |

## 22. 反转条件

以下证据出现时必须调整路线：

- Candidate Closure自动化增加错误merge或权限风险；
- read-only Task/Closure计划不能在历史回放中提高解释力；
- Action Key无法声明完整输入，cache poison高于节省；
-Run Journal恢复仍需大量聊天语义；
-Repository Semantic Index维护成本超过重复扫描；
-Project References没有真实模块边界或净收益；
-virtual merge无法预测关键physical resource冲突；
-并行增加总返工/queue wait而非有效main吞吐；
-自动反馈导致持续高CPU/内存或频繁stale work；
-指标驱动人为拆小无独立价值PR。

反转不等于放弃目标，而是回到更窄read-only或manual-shadow阶段重新设计。

## 23. 最终现实验收

整条路线只有在真实产品开发上满足以下条件才算完成：

-用户说“继续”后系统从外部状态执行唯一next transition；
-普通candidate无需手工组合多个控制命令；
-已知相邻不变量首轮覆盖；
-相同有效action不重复；
-compact/restart不重复Gate、不偏离scope；
-无冲突包安全并行，有冲突包提前阻断；
-merge后产品、control plane、Issue、branch/worktree全部有readback/receipt；
-有效进入main的纵切片吞吐提高，且Verification Truth、unknown frontier、resource cleanup和escaped defect不恶化。