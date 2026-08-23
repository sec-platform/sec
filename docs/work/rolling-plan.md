---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-23
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:f3002db74f403fc5b6c0efd7b37b5db1b50c5d5f510cebe3f8d6ad9857cf4910",
    "manifestPath": "docs/work-packages/default-branch-health-repair-4291ea94f26858c6570144f6632100a568832039-9606c61e638edb6562dd98421c5442fd28aca119c1fd8a9f472d74c1f606c010.md",
    "packageId": "default-branch-health-repair-4291ea94f26858c6570144f6632100a568832039-9606c61e638edb6562dd98421c5442fd28aca119c1fd8a9f472d74c1f606c010",
    "tracking": "none"
  },
  "authority": {
    "bootstrapObservationDigest": "sha256:73d8afcd21593ff06f4298177eb8d12fd75852b7012429772bcbe5ebb6ef4317",
    "defaultBranch": "main",
    "failureFingerprints": [
      "sha256:73d8afcd21593ff06f4298177eb8d12fd75852b7012429772bcbe5ebb6ef4317"
    ],
    "healthRevision": "sha256:5451991bcaa00c527ca761d9d34256ebed6182043cbfb10727f44dc5942346e6",
    "kind": "manual-main-health-bootstrap",
    "owner": "ci-verification-maintainer",
    "publishedActivePackageId": "git-worktree-physical-closeout-v1",
    "repository": "sec-platform/sec",
    "retirementPolicy": "exact-new-main-readback"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "4291ea94f26858c6570144f6632100a568832039",
  "exactMainTree": "352af4cbae1b76276b312372b8c12170452ac3d7",
  "projectionDigest": "sha256:0768c547a0442c41d2cf715533a6c91f1fbb9cce46f4e2dc5fb06a930e503fcc",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### default-branch-health-repair-4291ea94f26858c6570144f6632100a568832039-9606c61e638edb6562dd98421c5442fd28aca119c1fd8a9f472d74c1f606c010

Final manual MainHealth bootstrap bound to observation `sha256:73d8afcd21593ff06f4298177eb8d12fd75852b7012429772bcbe5ebb6ef4317`, health `sha256:5451991bcaa00c527ca761d9d34256ebed6182043cbfb10727f44dc5942346e6`, manifest `sha256:f3002db74f403fc5b6c0efd7b37b5db1b50c5d5f510cebe3f8d6ad9857cf4910`, and authority `sha256:fc0b9ca889b84c881cee44a72893bb2d0949efe193981f4ed08bd96f114b6baa`; it retires only after exact new-main readback.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:fc0b9ca889b84c881cee44a72893bb2d0949efe193981f4ed08bd96f114b6baa`.

### 2. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:fc0b9ca889b84c881cee44a72893bb2d0949efe193981f4ed08bd96f114b6baa`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:fc0b9ca889b84c881cee44a72893bb2d0949efe193981f4ed08bd96f114b6baa`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:fc0b9ca889b84c881cee44a72893bb2d0949efe193981f4ed08bd96f114b6baa`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
