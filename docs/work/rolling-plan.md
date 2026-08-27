---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-28
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:0369fe25da6990f295a690f93d7d9d6b9a9265c059e7a4f454c8ac111f81308c",
    "manifestPath": "docs/work-packages/default-branch-health-repair-36b174ebc783bb2b2e0c079d58fb825f0966b60b-848e6d50f2852dc05566c9d272c71782a7c39fb6c1badea43b1f74e9064b3c8e.md",
    "packageId": "default-branch-health-repair-36b174ebc783bb2b2e0c079d58fb825f0966b60b-848e6d50f2852dc05566c9d272c71782a7c39fb6c1badea43b1f74e9064b3c8e",
    "tracking": "none"
  },
  "authority": {
    "decisionDigest": "sha256:bb04d92b467d4ce1c8aaa07914333f4e7d3696d200c3f7c1fc04879cc8a670ec",
    "failureFingerprints": [
      "sha256:e46660e48b111d2dfb7f14792ac6749653cfdd8ca064187466d1096057097aac"
    ],
    "healthRevision": "sha256:ccb5afb6c3c6d3045bd6bca533ee695687ea1830957b36d662dbf7e5c4dc958b",
    "kind": "main-health-repair",
    "ledgerDigest": "sha256:dbb95366a302239df54f76468ce17e4ee4e6cec9c4833ce62ec945d1c0cbd605",
    "publishedActivePackageId": "default-branch-health-repair-4291ea94f26858c6570144f6632100a568832039-9606c61e638edb6562dd98421c5442fd28aca119c1fd8a9f472d74c1f606c010"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "36b174ebc783bb2b2e0c079d58fb825f0966b60b",
  "exactMainTree": "f7dd21a385a00589ecf04a41e98fe9d9e4fb43d6",
  "projectionDigest": "sha256:c370bbe1bf0077bf736d3ebcc48ab84dec3464f49f624754cd285baea9173977",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### default-branch-health-repair-36b174ebc783bb2b2e0c079d58fb825f0966b60b-848e6d50f2852dc05566c9d272c71782a7c39fb6c1badea43b1f74e9064b3c8e

Exact MainHealth repair bound to decision `sha256:bb04d92b467d4ce1c8aaa07914333f4e7d3696d200c3f7c1fc04879cc8a670ec`, health `sha256:ccb5afb6c3c6d3045bd6bca533ee695687ea1830957b36d662dbf7e5c4dc958b`, manifest `sha256:0369fe25da6990f295a690f93d7d9d6b9a9265c059e7a4f454c8ac111f81308c`, and authority `sha256:2132f1500cd77b61388fe08da3d05119117cf47b0c081bbef568e6cbc52f18e7`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:2132f1500cd77b61388fe08da3d05119117cf47b0c081bbef568e6cbc52f18e7`.

### 2. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:2132f1500cd77b61388fe08da3d05119117cf47b0c081bbef568e6cbc52f18e7`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:2132f1500cd77b61388fe08da3d05119117cf47b0c081bbef568e6cbc52f18e7`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:2132f1500cd77b61388fe08da3d05119117cf47b0c081bbef568e6cbc52f18e7`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
