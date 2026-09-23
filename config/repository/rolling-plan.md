---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-22
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:e0f2b0c67905ca62fc270bc3ce67ee62460cdeabc2be0ab9707aac8df9b4453f",
    "manifestPath": "config/repository/work-packages/sec086-current-main-convergence-v1.md",
    "packageId": "sec086-current-main-convergence-v1",
    "tracking": "none"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "6f08df8ba9057a064483636da7fd36928fcba84f",
    "sourceManifestDigest": "sha256:e9d216c4b6057613a9793cd568f8c47070c20fb13098de62f49b04fbe422f3c5",
    "sourcePointerRevision": "sha256:fd515b4e3a6dbf2c73ff759a2f1582cecd9daeaad7a41ed0fba67114de83a7f3",
    "sourceRollingRevision": "sha256:bfa2824edf4f3ff998d13fb66672c5888765408e0dba6ae71531367b676a95fe",
    "sourceTree": "046088a257ce4d555fa7a0e3ad2a21d48526c34c"
  },
  "candidates": [
    "development-critical-path-spine-v1",
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "69b321e4eeac478a5400d456a5fff92ceb37ace8",
  "exactMainTree": "49943fb5f3f26de2e02c8803f13c6f7692d9f9c0",
  "projectionDigest": "sha256:d66d172ef48672daae45887bf8c95bb0184ef37ac97261d3f959411f5bd1406a",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### sec086-current-main-convergence-v1

Existing active package replan bound to exact source head `6f08df8ba9057a064483636da7fd36928fcba84f`, source tree `046088a257ce4d555fa7a0e3ad2a21d48526c34c`, manifest `sha256:e0f2b0c67905ca62fc270bc3ce67ee62460cdeabc2be0ab9707aac8df9b4453f`, and authority `sha256:af300ccbeb3463bb2ea2a5e74831b93bf5393a1aa7de74b9bae401162f99f3db`.

## 候选 Work Package

### 1. development-critical-path-spine-v1

Retained ordered candidate from transition authority `sha256:af300ccbeb3463bb2ea2a5e74831b93bf5393a1aa7de74b9bae401162f99f3db`.

### 2. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:af300ccbeb3463bb2ea2a5e74831b93bf5393a1aa7de74b9bae401162f99f3db`.

### 3. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:af300ccbeb3463bb2ea2a5e74831b93bf5393a1aa7de74b9bae401162f99f3db`.

### 4. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:af300ccbeb3463bb2ea2a5e74831b93bf5393a1aa7de74b9bae401162f99f3db`.

### 5. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:af300ccbeb3463bb2ea2a5e74831b93bf5393a1aa7de74b9bae401162f99f3db`.
## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
