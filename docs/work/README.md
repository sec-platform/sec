---
title: 动态工程控制面
status: active
domain: current-control
last-reviewed: 2026-07-28
---

# 动态工程控制面

- `current-state.yaml` 只保存 resolver配置和跨候选稳定的 authority入口，不保存人工完成能力清单。
- `rolling-plan.md` 只保存一个当前包和二至五个条件候选；候选不是授权。
- `active-work-package.md` 只保存 frozen manifest path与raw Git blob digest。

当前 Git、PR、CI、Review和resolver状态在运行时生成，不写入稳定文档。历史manifest在新pointer原子接管后移入 `docs/archive/work-packages/`。
