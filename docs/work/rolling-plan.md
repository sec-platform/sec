---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-16
---

# SEC 滚动近期计划

本文件是validated WorkDecision的只读投影，不是roadmap、registry、current spec或selection authority。
任何选择变化都从exact main重新观察；Issue/comment prose、AI评分、wall-clock、caller JSON和本文件自身
均不能成为输入。receipt只能用于replay；effectful consumer必须调用trusted live adapter重新推导。

```json
{
  "active": {
    "currentSpecRef": "github:issue/275",
    "currentSpecRevision": "sha256:b8fc75c138ab7541f5a29736e6abf275f191bce6bb5df26fc1182e8e438b88a4",
    "decisionStatus": "selected",
    "packageId": "delegation-consumer-zero-retirement-v1",
    "tracking": "issue-275",
    "workId": "issue-275"
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
      "currentSpecRef": "github:issue/271",
      "currentSpecRevision": "sha256:f33d021ae722fc22431c1697d0afcd35cb47ab660ec9feb3ec873e634c1487e5",
      "decisionStatus": "eligible",
      "packageId": "generated-ignored-state-lifecycle-v1",
      "tracking": "issue-271",
      "workId": "issue-271"
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
  "catalogDigest": "sha256:c2cc389a5e04a26c9d95b6be0433f0f32273d37a767d05e34315ae35a3d8efb1",
  "decisionDigest": "sha256:9ff300b6f5f667b65a094c5e4a47afbdbfbf5a9f551a096ce7dd91eb6e517380",
  "exactMain": "0137447c4b3821decfa5a6c332d8e7c5f6587ad6",
  "projectionDigest": "sha256:7c3ba9b8858af00c8cd073466c0bd1343a0717422b7abe539ce6514643de9903",
  "receiptDigest": "sha256:53ef76ffb07b48f75aa58a0a797b82bc92014fd9066bbb2528fa8f25c05d9c1c",
  "roadmapRevision": "sha256:5bdbf59793136a7b26238240abca56d89aceaccad1c6ab2c0a566e4b26cac177",
  "schema": "sec-work-rolling-projection-v1"
}
```

## 当前唯一 Work Package

### delegation-consumer-zero-retirement-v1

Work identity `issue-275`; current spec `github:issue/275` at
`sha256:b8fc75c138ab7541f5a29736e6abf275f191bce6bb5df26fc1182e8e438b88a4`; decision `sha256:9ff300b6f5f667b65a094c5e4a47afbdbfbf5a9f551a096ce7dd91eb6e517380`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Work identity `issue-346`; current spec `github:issue/346` at
`sha256:b1b350a7bc0a9cc741fee5d8688580a419ad737c028a383e33153844fee5e729`; current decision status `eligible`.

### 2. generated-ignored-state-lifecycle-v1

Work identity `issue-271`; current spec `github:issue/271` at
`sha256:f33d021ae722fc22431c1697d0afcd35cb47ab660ec9feb3ec873e634c1487e5`; current decision status `eligible`.

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
