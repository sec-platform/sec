---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-13
---

# SEC 滚动近期计划

本文件是validated WorkDecision的只读投影，不是roadmap、registry、current spec或selection authority。
任何选择变化都从exact main重新观察；Issue/comment prose、AI评分、wall-clock、caller JSON和本文件自身
均不能成为输入。receipt只能用于replay；effectful consumer必须调用trusted live adapter重新推导。

```json
{
  "active": {
    "currentSpecRef": "github:issue/186",
    "currentSpecRevision": "sha256:6901ae5183daa5f90511abc9e3aafd9799ce4be5cd36d94efcb3bd5ac2b8283a",
    "decisionStatus": "selected",
    "packageId": "git-worktree-physical-closeout-v1",
    "tracking": "issue-186",
    "workId": "issue-186"
  },
  "candidates": [
    {
      "currentSpecRef": "github:issue/346",
      "currentSpecRevision": "sha256:b1b350a7bc0a9cc741fee5d8688580a419ad737c028a383e33153844fee5e729",
      "decisionStatus": "eligible",
      "packageId": "operation-read-plan-authority-canary-v1",
      "tracking": "issue-346",
      "workId": "issue-346"
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
    },
    {
      "currentSpecRef": "github:issue/349",
      "currentSpecRevision": "sha256:2511c8cf2f52506c4bb7b54acc54bfb0a793e94d2b9e8604e22b1b7260e64fe9",
      "decisionStatus": "rejected",
      "packageId": "execution-wave-v1",
      "tracking": "issue-349",
      "workId": "issue-349"
    }
  ],
  "catalogDigest": "sha256:66e1ae49a02cbec9c9e98446ba1617356f5692503d1ad4e19a5fee05201e5ab1",
  "decisionDigest": "sha256:1e95cc8235cdc2c13436e27166a548b8c1a27b84256445d335afdb3d3f1fee8c",
  "exactMain": "4c2dfbac5bfd5a2edf38e5ec7e8c6ed394c152dd",
  "projectionDigest": "sha256:e932efcb0a7f01a4bcb2cafdc6653c903bab319b5aacff7807e0653e98276022",
  "receiptDigest": "sha256:d828313cfe4e383d3695ec91f0ac0cc1b48851482c180899ef2b74971a134b90",
  "roadmapRevision": "sha256:d6fdab676cbb8ec7b2b61c1a60d62b0f59fc6c75f79b65ec72b9d823793c54e8",
  "schema": "sec-work-rolling-projection-v1"
}
```

## 当前唯一 Work Package

### git-worktree-physical-closeout-v1

Work identity `issue-186`; current spec `github:issue/186` at
`sha256:6901ae5183daa5f90511abc9e3aafd9799ce4be5cd36d94efcb3bd5ac2b8283a`; decision `sha256:1e95cc8235cdc2c13436e27166a548b8c1a27b84256445d335afdb3d3f1fee8c`.

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
