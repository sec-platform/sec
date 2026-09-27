---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-27
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:aec125353728dc47fe48ce8da1a20f5cb5f0d0b934e0b61ec5f0a9e97310dae5",
    "manifestPath": "config/repository/work-packages/repository-closeout-20260927-v1.md",
    "packageId": "repository-closeout-20260927-v1",
    "tracking": "none"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "a863f1bc5cad4d31a249a967a09bdbf3af9eafae",
    "sourceManifestDigest": "sha256:aec125353728dc47fe48ce8da1a20f5cb5f0d0b934e0b61ec5f0a9e97310dae5",
    "sourcePointerRevision": "sha256:dd2df94d86a8d5061671a210f3574917e42943fd3f7f66bd5e98833a5a612fe7",
    "sourceRollingRevision": "sha256:8664c4ed9f3a626584d502e98a4a03bc562d6e38a5107472b459b8415f718ae3",
    "sourceTree": "05049eda8fecb5d6498042a540f37bb8342c17e7"
  },
  "candidates": [
    "development-critical-path-spine-v1",
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "263878d40ee4b92485ee07d14185fe6f606aee8d",
  "exactMainTree": "fe1b293837a211b2981b3bcd3edb09d9904e3cb3",
  "projectionDigest": "sha256:1460a1d526a932cf69c705ad4e7caea9156c28a5fbfb58087ffa8db1138c886c",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### repository-closeout-20260927-v1

Existing active package replan bound to exact source head `a863f1bc5cad4d31a249a967a09bdbf3af9eafae`, source tree `05049eda8fecb5d6498042a540f37bb8342c17e7`, manifest `sha256:aec125353728dc47fe48ce8da1a20f5cb5f0d0b934e0b61ec5f0a9e97310dae5`, and authority `sha256:021a75165502c85dabdaaafd6045a87971292685650d8d46d2d47e4f2e015198`.

## 候选 Work Package

### 1. development-critical-path-spine-v1

Retained ordered candidate from transition authority `sha256:021a75165502c85dabdaaafd6045a87971292685650d8d46d2d47e4f2e015198`.

### 2. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:021a75165502c85dabdaaafd6045a87971292685650d8d46d2d47e4f2e015198`.

### 3. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:021a75165502c85dabdaaafd6045a87971292685650d8d46d2d47e4f2e015198`.

### 4. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:021a75165502c85dabdaaafd6045a87971292685650d8d46d2d47e4f2e015198`.

### 5. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:021a75165502c85dabdaaafd6045a87971292685650d8d46d2d47e4f2e015198`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
