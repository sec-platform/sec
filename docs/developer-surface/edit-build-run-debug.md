---
title: 编辑、构建、运行、调试与测试
status: stable
domain: developer-surface
---

# 编辑、构建、运行、调试与测试

## 1. 编辑

直接编辑文本/结构是正常路径。编辑器持有 document model 与 candidate generation：
- multi-view 同一 document identity共享内容；
- undo/redo 属于该作者 model，不等于 Git history；
- unsaved buffer 与 disk source是不同 revision；
- external change需 reload/merge/conflict，不 last-write-wins。

结构化编辑、文本编辑和 refactor都产生同类 candidate delta；不能让 GUI path 和 CLI path 各自实现一套语义。

## 2. search / replace

Search result绑定：
- query/pattern dialect；
- exact source generation；
- scope/coverage；
- match coordinate model。

Replace：
1. freeze matches；
2. build preview；
3. user/tool selects exact matches；
4. apply 检查每项 preimage；
5. stale match拒绝或重新 preview。

Regex/Unicode/line ending/large-file semantics必须由真实 engine定义。搜索部分失败不能显示成“0 matches”。

## 3. language services

Completion/hover/definition/reference/rename/diagnostics/refactor 读取同一 Source Program / Engineering Semantics owner；不能在每个服务中重建第二套 parser/import/call graph。

Completion candidate不因显示就合法；采用时仍检查 scope/type/contract。Rename/refactor必须保持 source identity、capture/effects和known consumers。

Diagnostics按 producer+generation分区；一个 producer的新空集合只清除自己的旧 generation。

## 4. build

Build request固定 source/candidate、Target/Profile、Binding/Backend和输出 root。它不从 ambient cwd/PATH猜新的 provider。

Incremental build与clean build经过相同 validators/resolution/target rules；缓存只能省计算，不得改结果。输出写入先形成完整候选 artifact set，再按 artifact owner协议发布；失败不让半生成目录冒充新版本。

## 5. run

Run使用已经闭合的 runnable artifact + actual runtime imports：
- process/worker/container/device identity；
- args/env/config/secret refs；
- stdin/channel；
- resource budgets；
- cancellation；
- stdout/stderr/events；
- exit/settlement。

源码“可编译”不等于 run 已准备。Run 不自动采用新 source revision；旧运行继续绑定旧 artifact。

## 6. interactive process / terminal

PTY/terminal需要真实 byte/text encoding、resize、input ownership、signal/control event、child/descendant lifetime、exit settlement。Terminal escape sequence是外部数据，UI必须按终端安全模型解释，不能当普通富文本。

关闭前端窗口不自动证明 descendant process已结束；shared task不被单个 view关闭杀掉。

## 7. debug

Debug session绑定：
- artifact/build identity；
- loaded module/source map；
- debugger/provider version；
- breakpoint logical source identity；
- current thread/frame；
- one outstanding step/continue control per applicable target；
- stop reason。

源码改变后旧 breakpoint可重新 map，但不能把新位置当旧 artifact已加载。Debug读取/写内存、evaluate表达式属于不同 Authority/Effect，不因“调试”全部放开。

## 8. test

Test discovery与execution分开：
- discovery有 coverage；
- case identity稳定，不以展示顺序决定；
- test input、fixture、oracle、environment版本固定；
- skipped/not-run/failed/pass区分；
- flaky/retry保留所有 attempts和选择规则；
- test framework exit status经 adapter解释。

未保存 candidate C2 要测试 C2，就必须物化/提供真实 C2 input；磁盘C1结果不能贴给C2。

Affected-test选择只能在影响闭包证据足够时减少执行；unknown扩大而非缩小集合。

## 9. stop / restart

Build、run、debug、test各有不同停止点。Stop request先阻止新工作，再结算已接受工作/descendant/resource。restart形成新 attempt/generation，不原地修改旧 attempt历史。

外部非幂等Effect已经发生时，retry必须使用原 operation id/protocol query/idempotency，不以“测试/开发模式”绕过。

## 10. VCS

VCS integration明确区分 working tree、index/staging、commit tree、remote refs。SEC只修改用户选择的区域；不能通过 reset/checkout隐藏 unknown现场。

合并候选后必须基于合并内容重新 parse/type/check相交义务；两个分支分别绿不证明组合绿。

Git只是一个 Provider；具有等价内容/version/merge contract的其他系统可以接入，不把Git概念写进通用语义对象。

## 11. 可用性

纯文本 CLI 必须能完整表达关键状态/diagnostic/diff，不能只靠颜色或图标。UI应支持键盘、焦点恢复、可读标签、缩放/换行；大型结果分页/虚拟化不改变完整性判断。

性能优化优先降低首次有效反馈和相交输入量，但快速 partial result必须标coverage，不能用“快”替代完整 reference/impact query。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

编辑、搜索、语言服务、build、run、terminal、debug、test 与 VCS 都绑定 exact source/candidate/artifact generation；未保存源、磁盘源、生成物和运行实例不混同。增量/缓存/并行只减少成本，不改变完整结果、Authority、Effect 和 settlement。
