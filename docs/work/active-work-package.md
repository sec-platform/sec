---
schema: sec-active-work-package-pointer-v1
status: active
last-reviewed: 2026-07-23
---

# 当前唯一 Active Work Package

```yaml
manifest: docs/work-packages/affected-fast-timeout-contract-v1.md
manifestDigest: sha256:3a91921c3769037c4064085f4544b0b82544be7df97d3e3edc2919767961902a
```

本文件只按 path + raw-byte digest 选择当前唯一正式 Work Package，不复制其 id、base、tracking、ownership、acceptance、tests、forbidden paths、stop/reload 或执行说明；exact `main` SHA、branch与PR是 `current-state` 观察事实。候选不能在自身 tree内嵌最终 commit SHA而不形成 self-reference，因此 candidate `headSha` 保持 `null`，exact candidate head只由外部 Context Capsule与绑定 evidence给出。完整可执行闭包以所选 frozen manifest为唯一 authority；控制面 lifecycle只以 `docs/04-AI自主实现执行蓝图.md` 为权威。
