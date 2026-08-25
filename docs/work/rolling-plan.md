---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-26
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:fb1a4e90c8e837a18bf827508e267e3d1cf12571f9b51e0d0e17499aa5479d72",
    "manifestPath": "docs/work-packages/development-critical-path-spine-v1.md",
    "packageId": "development-critical-path-spine-v1",
    "tracking": "issue-398"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "0951d686f8cb248ade6d03d3e2de537b82573ae8",
    "sourceManifestDigest": "sha256:3c84190e246c71cdf8a7b768d8895a3467b58af2dba88e0a022ab946cc276467",
    "sourcePointerRevision": "sha256:910016bbea8d5e56cc59938182bfdd2eb534235b0699629f9b9516a3dba3486d",
    "sourceRollingRevision": "sha256:27bc4c3818c533b76deddea9ae55d8fca6588c285528b7067ff46191910a606a",
    "sourceTree": "4d6c6d6295854c8cbdcfc3e05f88129c95064992"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "36b174ebc783bb2b2e0c079d58fb825f0966b60b",
  "exactMainTree": "f7dd21a385a00589ecf04a41e98fe9d9e4fb43d6",
  "projectionDigest": "sha256:75960880dfb7534bd4315822250a119c6ad1c96e591bab31360bbd97cc9e1fcd",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### development-critical-path-spine-v1

Existing active package replan bound to exact source head `0951d686f8cb248ade6d03d3e2de537b82573ae8`, source tree `4d6c6d6295854c8cbdcfc3e05f88129c95064992`, manifest `sha256:fb1a4e90c8e837a18bf827508e267e3d1cf12571f9b51e0d0e17499aa5479d72`, and authority `sha256:d5291ec7603e6bb33f9566bd5e4f20c87bda260b5ea968988756de4c40a71966`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:d5291ec7603e6bb33f9566bd5e4f20c87bda260b5ea968988756de4c40a71966`.

### 2. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:d5291ec7603e6bb33f9566bd5e4f20c87bda260b5ea968988756de4c40a71966`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:d5291ec7603e6bb33f9566bd5e4f20c87bda260b5ea968988756de4c40a71966`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:d5291ec7603e6bb33f9566bd5e4f20c87bda260b5ea968988756de4c40a71966`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
