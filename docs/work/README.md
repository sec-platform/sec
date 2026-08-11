---
title: 动态工程控制面
status: active
domain: current-control
last-reviewed: 2026-08-12
---

# 动态工程控制面

- `current-state.yaml` 只保存 resolver 配置和跨候选稳定的 authority 入口。
- `rolling-plan.md` 只保存一个当前包和二至五个条件候选；候选不是授权。
- `active-work-package.md` 只保存 frozen manifest path 与 raw Git blob digest。

持久工作身份/current spec归既有Issue或canonical machine owner，长期依赖归roadmap，#221
`WorkDecision`拥有eligibility/priority，#207/#349拥有order/conflict，rolling plan只投影结果。
发现新问题时先做existing identity/owner census；命中则同步原identity，不能用聊天、comment recency、
AI评分或新增计划文件重建下一步。Phase C writer切换前，人工rolling更新必须标明A0 reconciliation；
切换后由trusted document-control进程从exact main重新运行#221 live adapter，只接受manifest
`id + tracking`与`select-next`一致的generated projection；receipt文件本身没有写authority，投影不一致
返回`reconcile`/`unresolved`。normalized近端记录只内嵌在canonical `docs/roadmap.md`，不得另建计划或
registry文件。选中manifest保留到下一decision消费，下一纵切片再删除旧manifest和已消费catalog item。
effectful freeze必须运行clean trusted-main脚本，并用`--workspace`显式指向物理隔离的`codex/*`候选；
直接运行候选修改过的控制脚本不能给候选授权。

当前 Git、PR、CI、Review 和 resolver 状态在运行时生成，不写入稳定架构文档。
Work Package manifest 只在被当前 pointer 选择期间存在；新 pointer 原子接管并完成
new-main readback 后，旧 manifest 直接删除。历史、差异、Review、Evidence 和恢复由
Git commit、PR、Issue 与 Actions artifact 承担，当前树禁止 tracked `docs/archive/`。

Proposal 的 `retirementTarget` 是不可物化 tombstone identity，不是文件搬迁目的地。
迁移和 readback 完成后，proposal record 与源文件从当前树删除；corpus census 拒绝
实际落盘的 archive path，也拒绝 Evidence/Superpowers 叙事 Markdown 回流。

任何默认分支变化都会使旧 candidate base、Review、CI 和 manifest key 失效。即使变化
已经进入 `main` 并成为当前事实，只要缺少可验证 merge authority，也必须登记 incident、
冻结旧候选并从新主干重算；不得用“main 已经包含”抹掉来源缺陷，也不得静默 force-reset。
平台级禁止 admin bypass 由 Issue #279 独立闭环，未完成 ruleset readback 前不得声称
GitHub 物理保护已经成立。

已合并 Work Package manifest 在 pointer 仍指向它时保持 `conditional`；repository audit
使用 trusted exact base 区分 default branch 上的已合并 manifest 与 active candidate。
