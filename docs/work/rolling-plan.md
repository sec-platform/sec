---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-15
---

# SEC 滚动近期计划

本投影由唯一MainHealth repair renderer绑定exact `main@95fb5d1deb773c3f2f7663997455cd06363557be`、tree `69d7e238e98bcfa58c22f11f2f3b227dc009b4ae`、health `sha256:781d13204a0d18bfaea9db0f66d0477259e64c100d88dfdeb30024c08d50f49b`与排序failure fingerprints `sha256:b82d7f2dda9c8d9a770e3d811150f0be97153bd4628930949770bcafca0bb278`。旧epoch说明、caller prose与普通WorkDecision都不能参与本次repair projection；长期DAG、current spec和普通选择权仍归其canonical owner。

## 当前唯一 Work Package

### default-branch-health-repair-95fb5d1deb773c3f2f7663997455cd06363557be-b8d39784353e7ef1e71ad74c2abad952a0615484e9a3049a8dda13cede6fc504

Exact degraded-main repair for `main@95fb5d1deb773c3f2f7663997455cd06363557be` and health `sha256:781d13204a0d18bfaea9db0f66d0477259e64c100d88dfdeb30024c08d50f49b`. This temporary projection has no ordinary work-selection authority.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Work identity `issue-346`; current spec `github:issue/346` at
`sha256:b1b350a7bc0a9cc741fee5d8688580a419ad737c028a383e33153844fee5e729`; current decision status `eligible`.

### 2. delegation-consumer-zero-retirement-v1

Work identity `issue-275`; current spec `github:issue/275` at
`sha256:b8fc75c138ab7541f5a29736e6abf275f191bce6bb5df26fc1182e8e438b88a4`; current decision status `rejected`.

### 3. candidate-control-transaction-v1

Work identity `issue-321-candidate-control`; current spec `github:issue/321` at
`sha256:0cce9c5ae5ceb15227d7b89633d8a99b83a94a5dd235a0b8a041536ce4fef332`; current decision status `rejected`.

### 4. typescript-7-checker-acceleration-v1

Work identity `issue-312`; current spec `github:issue/312` at
`sha256:5ddcc63bf3a8b1b13239b99a00a4e13fd933e54fa1e3c0f976ebe443721e9335`; current decision status `rejected`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision不是select-next，或任何required fact为unknown/unresolved；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
