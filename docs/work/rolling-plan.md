---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-11
---

# SEC 滚动近期计划

本窗口从受信 `main@450c9f8764b8159a5463603549af542efdf13869` 重新计算；local、
`origin/main` 与 live provider default 的 commit/tree 一致，root clean，开放 PR 为零。
PR #350、#351、#353 与 #354 的实现结果已经进入当前 tree，但其旧 candidate Review、Gate、
Session、manifest 与 bootstrap receipt 不可迁移。本窗口只消费当前代码、当前 Issue body、
exact Git objects 和新 frozen Work Package，不恢复任何 v2/v3 工作树或聊天隐状态。

## 当前唯一 Work Package

### import-operation-scope-v1

从 exact then-current main 完成 #348 剩余根因：把 public imports 命令收敛为
`check|apply|freeze`，check/apply 默认自动消费 exact candidate delta，共享一份带
preimage/replacement/write-set digest 的 immutable plan；只有显式 `--all` 才允许全工程
扫描或写入。删除 `transform|remove-unused|staged` 命令别名与手工
`SEC_IMPORTS_CHANGED_ONLY` 选择，不新建 v2/v3 candidate。

当前机器成熟度：#347 已完成并关闭；#348 的 pure writer transaction 已进入 main，但本包的
scope/command cutover仍在 candidate；#205 Phase A 已进入 main，而 #346 issuer/canary、#275
最终 retirement、#312 TS7、#327 path/evidence 与 #193 wheel cutover均未实现。`docs/evidence`
当前仍有 51 个 tracked JSON，因此不得把后续 cleanup 描述成已完成。

## 候选 Work Package

### 1. document-control-replan-recovery-v1

由 #321/#311 在任何下一次 formal freeze 前修复本次真实 Windows canary 暴露的两个 control-plane
缺陷：同一 manifest 的 pre-publication replan 在 pointer 已等于 NEXT 时必须是 byte-exact NOOP，
不能强制一次 no-replace rename；Git index recovery identity 必须以 semantic tree/entries 与受保护
tuple为准，raw index stat-cache 只能作传输观测，不能让相同 tree 永久不可恢复。修复还必须让旧
terminal operation residue自动 consumer-zero retire，禁止人工删除成为正常路径。

### 2. operation-read-plan-authority-canary-v1

Task Capsule compiler 进入 new main 后，从 then-current main 先由独立document-control/A0
owner签发durable、issuer-bound、exact repository/base/head/tree/manifest/control-byte receipt，
再执行 #346 的三个真实operation canary：至少一个普通focused operation、一个
`none-required` 或单 Skill operation、一个maintainer mutation case。Capsule consumer只能
验证receipt并以raw-byte equality + fatal UTF-8 decode派生planning closure，不能自行签发；
canary沿用现行A0/Work Package effect grant，只发布exact read receipt、上下文/工具调用量与owner closure。

### 3. skill-delegation-retirement-v1

三个 canary readback 后，从 then-current main 完成 #275 最终 consumer census；只有
`sec-task-delegation` 的 production consumer 为零，才把 route 切到 deterministic owner，
删除第八个 Skill ID/file，收敛到七个 durable judgement owner。

### 4. typescript-seven-native-provider-v1

完成 #346/#275 的 read-path cutover 后，由 #312 按 #193 package/lock 单写者规则执行
TypeScript 7 Phase 0/1：先做 native CLI 的诊断/退出/性能 parity，再把产品 typecheck route
切到 TS7 native checker；所有 programmatic Compiler API、Language Service 与 imports kernel
继续由 TS6 provider 拥有，直到后续 TS7 API 有独立迁移 Evidence。不得把版本升级和全仓
依赖更新混为一个 PR。

### 5. repository-path-and-evidence-retirement-v1

从 then-current main 执行 #327 Phase 4/5 与 #282/#271 的窄切片：先把 repository-relative
path normalization 收敛到唯一 shared primitive 并迁移真实 consumers，再把
`docs/evidence/**` 中仍被 production policy 使用的少量事实迁到 versioned owner，最后一次性
删除 consumer-zero 历史 stop records、过期 test-impact pin 与测试实现细节锁。unknown 或仍有
production consumer 的对象不得按年龄或目录名删除。

## 后续但暂不占 formal writer

### candidate-control-transaction-v1

从 then-current main 实现 candidate/control materializer、ProspectiveCandidateControl 与
ActiveMainControl分离、同一 mutable worktree/ref generation、expected-old CAS，以及可复用的
ScopeGrant/CandidateScopeAttestation；完成new-main readback后删除旧effect-grant owner，不保留双写。

- Issue #178 的 causal TCB 历史完成事实只作为 trusted-base manual transition 的输入；
  不能把旧 Evidence、Review 或 bootstrap receipt 复用为当前 PASS。
- Issue #193 在 path/evidence census 后只接受一个真实重复机制一个 measured Provider cutover：
  先证明成熟轮子在版本、许可证、安全、确定性和性能上合格，再迁移全部直接 consumer 并删除
  被替代实现；禁止只添加 dependency、adapter 或长期 fallback。
- import/export/path 唯一化分属两个既有 owner：#348 只拥有 import representation/effect；
  #327 拥有 repository path、module-specifier 与重复 primitive census。package exports/public API
  仍由产品 contract 与 release owner决定，不能由 formatter 越权重写。
- Issue #314 的 architecture maturity 与 delivery closure 继续由后续候选消费；当前包
  不取得该 Program 的 writer authority。
- #275/#348 曾因 partial slice 被关闭后重新打开；R14 promotion/retirement 必须把
  `IssueDisposition`、acceptance/remaining-consumer census、exact new-main close CAS 与 provider
  readback接入真实 GitHub adapter。该 cutover前禁止由PR/commit/comment closing prose关闭Issue。
- repository path/evidence 与 focused wheel cutover 后进入 candidate/control transaction，随后依次进入 VerificationSession physical partition +
  Requirement closure、ExecutionWave、Review/trust transition、promotion/retirement；每项
  都是独立纵切片，不建立一个长期 umbrella branch。

## 重新规划硬触发器

任一条件成立立即停止并从 then-latest main 重算：

1. main、PR、branch、manifest、trust revision、runner input 或相同 failure fingerprint
   发生未处理漂移；
2. 本包 changed path 超出 frozen ownedPaths 或命中 forbiddenPaths；
3. Task Capsule、Read Plan、quarantine 或 scope intersection 的直接合同出现静态未闭合；
4. Capsule/Read Plan/Skill 出现第二 compiler、compatibility alias 或 candidate self-authorization；
5. 未先完成 exact-head independent Review（P0-P2 清零）就宣称 merge-ready；
6. merge 后没有先完成 exact new-main readback 与 `TASK_RESTART_REQUIRED` 就继续
   后续 trust-epoch 或治理工作。

## 加速验收

默认只做 changed-path ownership、import/consumer、schema/digest 与 control-plane 静态闭包。
只有静态分析不能裁决一个具体风险时，才一次性运行直接拥有该风险的最小 contract batch；
本包不运行 `check:affected`、`check:full`、全仓 audit、slow/hosted partition或相同输入 rerun。
速度也不能来自放宽 parser/path/identity、伪造 Review/Gate 或把 unknown 升级成 PASS。
