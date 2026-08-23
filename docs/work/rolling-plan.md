---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-23
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
      "currentSpecRef": "github:issue/311",
      "currentSpecRevision": "sha256:1bfd0d0be75c12566a7d08e976684539a87a83b89cf99e699c76483e53e97db3",
      "decisionStatus": "rejected",
      "packageId": "sec-static-convergence-v1",
      "tracking": "issue-311",
      "workId": "issue-311"
    },
    {
      "currentSpecRef": "github:issue/321",
      "currentSpecRevision": "sha256:60f0760b2354f9042db2f4e06144a4d9a4c2a6b8851779b4d35a47acd0ebc96a",
      "decisionStatus": "eligible",
      "packageId": "candidate-control-transaction-v1",
      "tracking": "issue-321",
      "workId": "issue-321-candidate-control"
    },
    {
      "currentSpecRef": "github:issue/312",
      "currentSpecRevision": "sha256:8ea6f8ab0ac40bffa4d337e61f1ddf199b73a4600865e5d3fd9b395012198f9b",
      "decisionStatus": "rejected",
      "packageId": "typescript-7-checker-acceleration-v1",
      "tracking": "issue-312",
      "workId": "issue-312"
    }
  ],
  "catalogDigest": "sha256:9be5866dd0db2ff633b39d587149589f831081ffa03ac0c870d78d09f8fdb876",
  "decisionDigest": "sha256:07ca11f2eaccab6d8dc695e65cfd2cfe2761a2f07cf11ae7a9bc5dc014900b69",
  "exactMain": "489518c3bd8b28753473e43ecb2e236452dee0b9",
  "projectionDigest": "sha256:02663d8b6d9a09b6c9730c4c7d75e57f487b27f0f2bdc170f9b1ee3dd9ec604e",
  "receiptDigest": "sha256:f3f3a87e2f884084eb22aacd3786b07da5b12efeb46445f83335d50fc9fb2a7f",
  "roadmapRevision": "sha256:c340463122d44ce950d1da5387aaf722e1a0bdf6ec30c0b71085de5deffdf4f8",
  "schema": "sec-work-rolling-projection-v1"
}
```

## 当前唯一 Work Package

### git-worktree-physical-closeout-v1

Work identity `issue-186`; current spec `github:issue/186` at
`sha256:6901ae5183daa5f90511abc9e3aafd9799ce4be5cd36d94efcb3bd5ac2b8283a`; decision `sha256:07ca11f2eaccab6d8dc695e65cfd2cfe2761a2f07cf11ae7a9bc5dc014900b69`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Work identity `issue-346`; current spec `github:issue/346` at
`sha256:b1b350a7bc0a9cc741fee5d8688580a419ad737c028a383e33153844fee5e729`; current decision status `eligible`.

### 2. sec-static-convergence-v1

Work identity `issue-311`; current spec `github:issue/311` at
`sha256:1bfd0d0be75c12566a7d08e976684539a87a83b89cf99e699c76483e53e97db3`; current decision status `rejected`.

### 3. candidate-control-transaction-v1

Work identity `issue-321-candidate-control`; current spec `github:issue/321` at
`sha256:60f0760b2354f9042db2f4e06144a4d9a4c2a6b8851779b4d35a47acd0ebc96a`; current decision status `eligible`.

### 4. typescript-7-checker-acceleration-v1

Work identity `issue-312`; current spec `github:issue/312` at
`sha256:8ea6f8ab0ac40bffa4d337e61f1ddf199b73a4600865e5d3fd9b395012198f9b`; current decision status `rejected`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
