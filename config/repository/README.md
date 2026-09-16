---
title: 动态工程控制面
status: active
domain: current-control
last-reviewed: 2026-09-16
---

# 动态工程控制面

- `current-state.yaml` 只保存 resolver 配置和跨候选稳定的 authority 入口。
- `rolling-plan.md` 只保存一个当前包和二至五个条件候选；候选不是授权。
- `active-work-package.md` 只保存 frozen manifest path 与 raw Git blob digest。

持久工作身份/current spec归既有Issue或canonical machine owner，长期依赖归work-selection catalog，#221
`WorkDecision`拥有eligibility/priority，#207/#349拥有order/conflict，rolling plan只投影结果。
发现新问题时先做existing identity/owner census；命中则同步原identity，不能用聊天、comment recency、
AI评分或新增计划文件重建下一步。Phase C writer切换前，人工rolling更新必须标明A0 reconciliation；
切换后由trusted document-control进程从exact main重新运行#221 live adapter，只接受manifest
`id + tracking`与`select-next`一致的generated projection；receipt文件本身没有写authority，投影不一致
返回`reconcile`/`unresolved`。normalized近端记录只内嵌在canonical `work-selection.md`，不得另建计划或
registry文件。选中manifest保留到下一decision消费，下一纵切片再删除旧manifest和已消费catalog item。
effectful freeze必须运行clean trusted-main脚本，并用`--workspace`显式指向物理隔离、attached到非default
branch的候选；branch前缀只是locator命名习惯，不参与authority判断。rolling-plan的WorkDecision、
committed-candidate replan与MainHealth repair由同一typed projection union和全文renderer生成；
标题、prose、JSON与digest不能分开维护；committed replan只消费exact HEAD/tree与source control raw
bytes digest，不复制旧projection digest或旧prose；
直接运行候选修改过的控制脚本不能给候选授权。

当前 Git、PR、CI、Review 和 resolver 状态在运行时生成，不写入稳定架构文档。
仓库只保留 pointer 当前引用的一个 Work Package manifest；下一任务原子替换 pointer 与 manifest，
不能累积历史包。pointer 引用的同字节 manifest 已进入 default branch 时，resolver 返回
`none/matching-default-blob`，表示没有活动候选。历史、差异、Review、Evidence 和恢复由
Git commit、PR、Issue 与 Actions artifact 承担，`docs/`只允许当前设计源。

Proposal 的 `retirementTarget` 是不可物化 tombstone identity，不是文件搬迁目的地。
迁移和 readback 完成后，proposal record 与源文件从当前树删除；corpus census 拒绝
实际落盘的 archive path，也拒绝 Evidence/Superpowers 叙事 Markdown 回流。

任何默认分支变化都会使旧 candidate base、Review、CI 和 manifest key 失效。即使变化
已经进入 `main` 并成为当前事实，只要缺少可验证 merge authority，也必须登记 incident、
冻结旧候选并从新主干重算；不得用“main 已经包含”抹掉来源缺陷，也不得静默 force-reset。
平台级禁止 admin bypass 由 Issue #279 独立闭环，未完成 ruleset readback 前不得声称
GitHub 物理保护已经成立。

已合并 Work Package manifest 在 pointer 仍指向它时保持 `conditional`；repository audit
使用 trusted exact base 区分 default branch 上的惰性当前记录与 active candidate。该记录不获得
产品 authority，也不能被复制为第二份历史目录。
