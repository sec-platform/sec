---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-15
---

# SEC 滚动近期计划

本文件是validated WorkDecision的只读投影，不是roadmap、registry、current spec或selection authority。
任何选择变化都从exact main重新观察；Issue/comment prose、AI评分、wall-clock、caller JSON和本文件自身
均不能成为输入。receipt只能用于replay；effectful consumer必须调用trusted live adapter重新推导。

```json
{
  "active": {
    "currentSpecRef": "github:issue/346",
    "currentSpecRevision": "sha256:b1b350a7bc0a9cc741fee5d8688580a419ad737c028a383e33153844fee5e729",
    "decisionStatus": "selected",
    "packageId": "operation-read-plan-authority-canary-v1",
    "tracking": "issue-346",
    "workId": "issue-346"
  },
  "candidates": [
    {
      "currentSpecRef": "github:issue/352",
      "currentSpecRevision": "sha256:363e771392f5b5e046a8e86cd9db9cf937b4cedc6cfc8b95ad9e1aaaecc07e89",
      "decisionStatus": "rejected",
      "packageId": "controlled-pr-issue-disposition-single-writer-v1",
      "tracking": "issue-352",
      "workId": "issue-352"
    },
    {
      "currentSpecRef": "github:issue/186",
      "currentSpecRevision": "sha256:6901ae5183daa5f90511abc9e3aafd9799ce4be5cd36d94efcb3bd5ac2b8283a",
      "decisionStatus": "rejected",
      "packageId": "git-worktree-physical-closeout-v1",
      "tracking": "issue-186",
      "workId": "issue-186"
    },
    {
      "currentSpecRef": "github:issue/275",
      "currentSpecRevision": "sha256:b8fc75c138ab7541f5a29736e6abf275f191bce6bb5df26fc1182e8e438b88a4",
      "decisionStatus": "rejected",
      "packageId": "delegation-consumer-zero-retirement-v1",
      "tracking": "issue-275",
      "workId": "issue-275"
    },
    {
      "currentSpecRef": "github:issue/321",
      "currentSpecRevision": "sha256:0cce9c5ae5ceb15227d7b89633d8a99b83a94a5dd235a0b8a041536ce4fef332",
      "decisionStatus": "rejected",
      "packageId": "candidate-control-transaction-v1",
      "tracking": "issue-321",
      "workId": "issue-321-candidate-control"
    },
    {
      "currentSpecRef": "github:issue/312",
      "currentSpecRevision": "sha256:5ddcc63bf3a8b1b13239b99a00a4e13fd933e54fa1e3c0f976ebe443721e9335",
      "decisionStatus": "rejected",
      "packageId": "typescript-7-checker-acceleration-v1",
      "tracking": "issue-312",
      "workId": "issue-312"
    }
  ],
  "catalogDigest": "sha256:66e1ae49a02cbec9c9e98446ba1617356f5692503d1ad4e19a5fee05201e5ab1",
  "decisionDigest": "sha256:5eb491351d4ba3ec10dd05b17bb3dbc2c5f7638899b8d5121022c79395fcebfe",
  "exactMain": "93491f07a3b6c8fc94880be3bb6d18f41cda443b",
  "projectionDigest": "sha256:fcd30e1f8e7ec376d959b5eec6304ee88f0731c6b64e2a697e01ad60059eb9c0",
  "receiptDigest": "sha256:b4da7af49596dfa0e7d5f9adf508dafb83c0bb5fb9630a78ca9797815b664c2e",
  "roadmapRevision": "sha256:d6fdab676cbb8ec7b2b61c1a60d62b0f59fc6c75f79b65ec72b9d823793c54e8",
  "schema": "sec-work-rolling-projection-v1"
}
```

## 当前唯一 Work Package

### operation-read-plan-authority-canary-v1

Work identity `issue-346`; current spec `github:issue/346` at
`sha256:b1b350a7bc0a9cc741fee5d8688580a419ad737c028a383e33153844fee5e729`; decision `sha256:5eb491351d4ba3ec10dd05b17bb3dbc2c5f7638899b8d5121022c79395fcebfe`.

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
