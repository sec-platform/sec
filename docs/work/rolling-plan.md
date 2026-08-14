---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-15
---

# SEC 滚动近期计划

本投影由唯一MainHealth repair renderer绑定exact `main@3bb47145c58b19aef2b1981ac3a28d2561949f4b`、tree `721e088bfa8ea90a4f9ec4cad9798eb1e9ec4a45`、health `sha256:015341cb14e6214264069935faf0b1a3827212674f93fa41a0e2f944cefc4306`与排序failure fingerprints `sha256:ebe771353763e62a5473ac81a02b75407c0f8264c471817e4082378ea8cd3dff`。旧epoch说明、caller prose与普通WorkDecision都不能参与本次repair projection；长期DAG、current spec和普通选择权仍归其canonical owner。

## 当前唯一 Work Package

### default-branch-health-repair-3bb47145c58b19aef2b1981ac3a28d2561949f4b-01a7d6fd95bcca50355668a87c7b0eeebb0aec6a5344a4c08974bca8e82f07ae

Exact degraded-main repair for `main@3bb47145c58b19aef2b1981ac3a28d2561949f4b` and health `sha256:015341cb14e6214264069935faf0b1a3827212674f93fa41a0e2f944cefc4306`. This temporary projection has no ordinary work-selection authority.

## 候选 Work Package

### 1. controlled-pr-issue-disposition-single-writer-v1

Work identity `issue-352`; current spec `github:issue/352` at
`sha256:363e771392f5b5e046a8e86cd9db9cf937b4cedc6cfc8b95ad9e1aaaecc07e89`; current decision status `rejected`.

### 2. git-worktree-physical-closeout-v1

Work identity `issue-186`; current spec `github:issue/186` at
`sha256:6901ae5183daa5f90511abc9e3aafd9799ce4be5cd36d94efcb3bd5ac2b8283a`; current decision status `rejected`.

### 3. delegation-consumer-zero-retirement-v1

Work identity `issue-275`; current spec `github:issue/275` at
`sha256:b8fc75c138ab7541f5a29736e6abf275f191bce6bb5df26fc1182e8e438b88a4`; current decision status `rejected`.

### 4. candidate-control-transaction-v1

Work identity `issue-321-candidate-control`; current spec `github:issue/321` at
`sha256:0cce9c5ae5ceb15227d7b89633d8a99b83a94a5dd235a0b8a041536ce4fef332`; current decision status `rejected`.

### 5. typescript-7-checker-acceleration-v1

Work identity `issue-312`; current spec `github:issue/312` at
`sha256:5ddcc63bf3a8b1b13239b99a00a4e13fd933e54fa1e3c0f976ebe443721e9335`; current decision status `rejected`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision不是select-next，或任何required fact为unknown/unresolved；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
