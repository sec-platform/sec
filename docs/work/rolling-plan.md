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
    "currentSpecRef": "github:issue/352",
    "currentSpecRevision": "sha256:363e771392f5b5e046a8e86cd9db9cf937b4cedc6cfc8b95ad9e1aaaecc07e89",
    "decisionStatus": "selected",
    "packageId": "controlled-pr-issue-disposition-single-writer-v1",
    "tracking": "issue-352",
    "workId": "issue-352"
  },
  "candidates": [
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
  "decisionDigest": "sha256:ffdc542a00bb6cffa0820ee167f591f7e5a5c8735a922a57b0c20552720c2836",
  "exactMain": "d7a15ea3b766c54ab5eacd422f435964b0a32b24",
  "projectionDigest": "sha256:222a3e9a8ba23276e2bd1302357cfb7340d1b10a6729280e1b2adf168dcb335a",
  "receiptDigest": "sha256:9ff1606d3f883844c56378497a8aab1e122c03ee882b161e0d85dcd48c526c83",
  "roadmapRevision": "sha256:d6fdab676cbb8ec7b2b61c1a60d62b0f59fc6c75f79b65ec72b9d823793c54e8",
  "schema": "sec-work-rolling-projection-v1"
}
```

## 当前唯一 Work Package

### controlled-pr-issue-disposition-single-writer-v1

Work identity `issue-352`; current spec `github:issue/352` at
`sha256:363e771392f5b5e046a8e86cd9db9cf937b4cedc6cfc8b95ad9e1aaaecc07e89`; decision `sha256:ffdc542a00bb6cffa0820ee167f591f7e5a5c8735a922a57b0c20552720c2836`.

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
