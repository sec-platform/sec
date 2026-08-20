---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-21
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:55dcfd798b91e2f0a7c65af1ba7f432f2a9df639c62240db7189a71946cfac4f",
    "manifestPath": "docs/work-packages/sec-static-convergence-v1.md",
    "packageId": "sec-static-convergence-v1",
    "tracking": "issue-311"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "4b955294edfaa9835e5dddbed340b8149c140a4d",
    "sourceManifestDigest": "sha256:55dcfd798b91e2f0a7c65af1ba7f432f2a9df639c62240db7189a71946cfac4f",
    "sourcePointerRevision": "sha256:60efb1dd55d7c9e30844f5c88ca926d067b12b9fa2d69740512eba00ac0f089b",
    "sourceRollingRevision": "sha256:4003145c566ac9b03c1e97ca501f1b787371b7ff2d7a50cb3f2125a414b696b9",
    "sourceTree": "3e4b1dc3b5a8ddea92cb729d8c032b6cc4cf5b7d"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "generated-ignored-state-lifecycle-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "2bdd3526d6f42993bfab3db87b66683afa06323a",
  "exactMainTree": "3a5be620152737536d22995fe96cb8c141a2b731",
  "projectionDigest": "sha256:3b776f6811bb8503e229e0ce527eaa29c70bbf19ee6a3a2d0d3aec70a0d5c9b0",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### sec-static-convergence-v1

Existing active package replan bound to exact source head `4b955294edfaa9835e5dddbed340b8149c140a4d`, source tree `3e4b1dc3b5a8ddea92cb729d8c032b6cc4cf5b7d`, manifest `sha256:55dcfd798b91e2f0a7c65af1ba7f432f2a9df639c62240db7189a71946cfac4f`, and authority `sha256:798d1a448fa70a7b79441f90db0307c031ba70b50a2fd263c6d4110f1120aaeb`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:798d1a448fa70a7b79441f90db0307c031ba70b50a2fd263c6d4110f1120aaeb`.

### 2. generated-ignored-state-lifecycle-v1

Retained ordered candidate from transition authority `sha256:798d1a448fa70a7b79441f90db0307c031ba70b50a2fd263c6d4110f1120aaeb`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:798d1a448fa70a7b79441f90db0307c031ba70b50a2fd263c6d4110f1120aaeb`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:798d1a448fa70a7b79441f90db0307c031ba70b50a2fd263c6d4110f1120aaeb`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
