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
    "currentSpecRevision": "sha256:5aa9a1e2802851ab429fbcddd0c861a3f566890eda74d212e448f4c6a64c777c",
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
      "currentSpecRevision": "sha256:60c9f9e949b699bd2aedd8b5b6462dbfa1a186d60d07a41789b6924bad4f0afe",
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
  "decisionDigest": "sha256:08c932c4d4596ed3eeffe0a3deab57af8141a8a238af2ffed2f68c3f800c31a1",
  "exactMain": "0137447c4b3821decfa5a6c332d8e7c5f6587ad6",
  "projectionDigest": "sha256:307acc92fee86d04e59f11de8f373e7c63128662501d7fec54ea7b1fef1ccf24",
  "receiptDigest": "sha256:ff3f6dca64054b808d329923cd58dbdecb5d8b53633ce1d8925e5a1c2efee766",
  "roadmapRevision": "sha256:5bdbf59793136a7b26238240abca56d89aceaccad1c6ab2c0a566e4b26cac177",
  "schema": "sec-work-rolling-projection-v1"
}
```

## 当前唯一 Work Package

### delegation-consumer-zero-retirement-v1

Work identity `issue-275`; current spec `github:issue/275` at
`sha256:5aa9a1e2802851ab429fbcddd0c861a3f566890eda74d212e448f4c6a64c777c`; decision `sha256:08c932c4d4596ed3eeffe0a3deab57af8141a8a238af2ffed2f68c3f800c31a1`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Work identity `issue-346`; current spec `github:issue/346` at
`sha256:b1b350a7bc0a9cc741fee5d8688580a419ad737c028a383e33153844fee5e729`; current decision status `eligible`.

### 2. generated-ignored-state-lifecycle-v1

Work identity `issue-271`; current spec `github:issue/271` at
`sha256:60c9f9e949b699bd2aedd8b5b6462dbfa1a186d60d07a41789b6924bad4f0afe`; current decision status `eligible`.

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
