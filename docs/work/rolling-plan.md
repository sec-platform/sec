---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-14
---

# SEC 滚动近期计划

本投影由真实 Issue 186 closeout failure 绑定 exact `main@e8242316ca0c20807bbe5edf87bfec5da6658d7a`、tree `98fb2b6062565a354e4000b0278b7e9f317d63d3` 与 failure fingerprint `sha256:55b3afd72a8587f3bae44dc4ecb0cc04890a84f0ae849c535b307d756dbf9687`。旧epoch说明、caller prose与普通WorkDecision都不能扩大本次 exact-leaf repair；长期DAG、current spec和普通选择权仍归其canonical owner。

## 当前唯一 Work Package

### issue-186-retirement-fence-exact-leaf-repair-e8242316ca0c20807bbe5edf87bfec5da6658d7a-55b3afd72a8587f3bae44dc4ecb0cc04890a84f0ae849c535b307d756dbf9687

Exact Issue 186 closeout repair for one retained retirement-fence leaf. It removes the unrelated parent-tree scan while retaining the existing 64 MiB single-leaf bound and all no-follow identity checks. This temporary projection has no ordinary work-selection authority.

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

### 5. execution-wave-v1

Work identity `issue-349`; current spec `github:issue/349` at
`sha256:2511c8cf2f52506c4bb7b54acc54bfb0a793e94d2b9e8604e22b1b7260e64fe9`; current decision status `rejected`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision不是select-next，或任何required fact为unknown/unresolved；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
