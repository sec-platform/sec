---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-15
---

# SEC 滚动近期计划

本投影由唯一MainHealth repair renderer绑定exact `main@2d2b92bbeb06effbdf1da850709e4d162898991e`、tree `18c3dffb4a992e0c78348bd8cc2d46099058e539`、health `sha256:53128af8e039fb7b1add22cde6883185b467d590c877c00702c62ca3452cc6c0`与排序failure fingerprints `sha256:3f059d3831af76dc74ca8c7813d9f47b457b753623a7090488dda2b42e54f946`。旧epoch说明、caller prose与普通WorkDecision都不能参与本次repair projection；长期DAG、current spec和普通选择权仍归其canonical owner。

## 当前唯一 Work Package

### default-branch-health-repair-2d2b92bbeb06effbdf1da850709e4d162898991e-ebcd146113d7f77482d452058181bbded2f25f3c592a64cc64d0fb9c7cc776c9

Exact degraded-main repair for `main@2d2b92bbeb06effbdf1da850709e4d162898991e` and health `sha256:53128af8e039fb7b1add22cde6883185b467d590c877c00702c62ca3452cc6c0`. This temporary projection has no ordinary work-selection authority.

## 候选 Work Package

### 1. git-worktree-physical-closeout-v1

Work identity `issue-186`; current spec `github:issue/186` at
`sha256:6901ae5183daa5f90511abc9e3aafd9799ce4be5cd36d94efcb3bd5ac2b8283a`; current decision status `rejected`.

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
