---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-11
---

# SEC 滚动近期计划

本窗口从受信 `main@8ba2bf1fb39351124187130d60fa971e4802155a` 重新计算；local、
`origin/main` 与 live provider default 的 commit/tree 一致，root clean，开放 PR 为零。
PR #350、#351 与 #353 的实现结果已经进入当前 tree，但其旧 candidate Review、Gate、
Session、manifest 与 bootstrap receipt 不可迁移。本窗口只消费当前代码、当前 Issue body、
exact Git objects 和新 frozen Work Package，不恢复任何 v2/v3 工作树或聊天隐状态。

## 当前唯一 Work Package

### task-capsule-compiler-v1

从 exact `main@8ba2bf1fb39351124187130d60fa971e4802155a` 实现 #205 Phase A
production content compiler，并把已合并的 #346 Read Plan 从临时内嵌
Capsule projection 切换到唯一上游 content owner。Capsule强制保持unbound，所有
production projection/Read Plan/Skill positive入口在真实issuer接入前typed fail closed；
不把candidate-local freeze journal伪装成A0 receipt。该包进入new main后由#346先接入
独立activation authority再执行三个真实canary；未完成canary前不退役#275 delegation route。

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Task Capsule compiler 进入 new main 后，从 then-current main 先由独立document-control/A0
owner签发durable、issuer-bound、exact repository/base/head/tree/manifest/control-byte receipt，
再执行 #346 的三个真实operation canary：至少一个普通focused operation、一个
`none-required` 或单 Skill operation、一个maintainer mutation case。Capsule consumer只能
验证receipt并以raw-byte equality + fatal UTF-8 decode派生planning closure，不能自行签发；
canary沿用现行A0/Work Package effect grant，只发布exact read receipt、上下文/工具调用量与owner closure。

### 2. skill-delegation-retirement-v1

三个 canary readback 后，从 then-current main 完成 #275 最终 consumer census；只有
`sec-task-delegation` 的 production consumer 为零，才把 route 切到 deterministic owner，
删除第八个 Skill ID/file，收敛到七个 durable judgement owner。

### 3. candidate-control-transaction-v1

从 then-current main 实现 candidate/control materializer、ProspectiveCandidateControl 与
ActiveMainControl分离、同一 mutable worktree/ref generation、expected-old CAS，以及可复用的
ScopeGrant/CandidateScopeAttestation；完成new-main readback后删除旧effect-grant owner，不保留双写。

## 后续但暂不占 formal writer

- Issue #178 的 causal TCB 历史完成事实只作为 trusted-base manual transition 的输入；
  不能把旧 Evidence、Review 或 bootstrap receipt 复用为当前 PASS。
- Issue #327 的 repository structural convergence 继续由后续新 main 重算；当前包
  只保存其需求，不吸收其产品 delta。
- Issue #314 的 architecture maturity 与 delivery closure 继续由后续候选消费；当前包
  不取得该 Program 的 writer authority。
- candidate/control transaction 后依次进入 VerificationSession physical partition +
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
