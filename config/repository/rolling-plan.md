---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-25
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:c307d9fecb41f183ea569a3db16eb5b5ebac08fa7cbb3bf60720d7df3b8e3db7",
    "manifestPath": "config/repository/work-packages/coordinated-repository-closeout.md",
    "packageId": "coordinated-repository-closeout",
    "tracking": "none"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "8d6f39a675abeca763024a6c096956d85b59cea1",
    "sourceManifestDigest": "sha256:741df9a432e425add332cabe97851cb4139c463fe17b2018bae15953ec972c4a",
    "sourcePointerRevision": "sha256:f35b1bfefac5abe201aa7dcba334e879d2a0367641bbcb098748ed0c73cde636",
    "sourceRollingRevision": "sha256:2c7565567cc055e57d12979f8a1e4755c3d8eb3885b79319c616cb55c06711ad",
    "sourceTree": "b999e56c0d51cb77cad80f42b7f0ac6f0b8bbee6"
  },
  "candidates": [
    "development-critical-path-spine-v1",
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "8c6dc289e3fe17b358e6a9c335fbbe092b8ce1ce",
  "exactMainTree": "52b96737f3f3983347738fe4fec11a89e76dc92c",
  "projectionDigest": "sha256:52fcfd360a80e2b0405d29e1f9cc74048bd48cac7b1aba5918abfd0f32bca07d",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### coordinated-repository-closeout

Existing active package replan bound to exact source head `8d6f39a675abeca763024a6c096956d85b59cea1`, source tree `b999e56c0d51cb77cad80f42b7f0ac6f0b8bbee6`, manifest `sha256:c307d9fecb41f183ea569a3db16eb5b5ebac08fa7cbb3bf60720d7df3b8e3db7`, and authority `sha256:48642de3962ac7f6f01cc6414dd673a435c15bf44f49c7858577a798e0482eb6`.

## 候选 Work Package

### 1. development-critical-path-spine-v1

Retained ordered candidate from transition authority `sha256:48642de3962ac7f6f01cc6414dd673a435c15bf44f49c7858577a798e0482eb6`.

### 2. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:48642de3962ac7f6f01cc6414dd673a435c15bf44f49c7858577a798e0482eb6`.

### 3. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:48642de3962ac7f6f01cc6414dd673a435c15bf44f49c7858577a798e0482eb6`.

### 4. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:48642de3962ac7f6f01cc6414dd673a435c15bf44f49c7858577a798e0482eb6`.

### 5. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:48642de3962ac7f6f01cc6414dd673a435c15bf44f49c7858577a798e0482eb6`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
