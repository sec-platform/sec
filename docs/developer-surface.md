---
title: 开发面
status: stable
domain: developer-surface
---

# 开发面

本文拥有 SEC 面向**目标工程开发者**的人/AI共同开发体验：开发者操作什么对象、六工具的产品级含义、会话与候选如何连续，以及编辑→检查→构建→运行→调试→再次修改怎样使用同一套 canonical 工程事实。

它不拥有 SEC 仓库自身的 Git/PR/Work Package 治理；那属于 [Development Governance](development-governance.md)。也不拥有 Agent/CLI 的 wire transport；机器接口 envelope 由 [Agent and User Machine Interface](agent-and-user-machine-interface.md) 承担。本域定义的是二者必须投影的**产品操作语义**。

## 1. 开发者看到对象，而不是内部流水线

正常开发者操作对象包括：
- Project/source scope；
- author/native document；
- logical Definition/Subject/Requirement；
- symbol/reference；
- candidate change；
- diagnostic/check result；
- target root/artifact；
- run/debug/test session；
- live operation/result。

内部 Parse/IR/Resolution/Lowering/Backend/Assurance 可以增量复用或融合，不要求用户逐阶段点击。

用户只写一个函数、一个表达式或改一份原生文件时，不先创建完整 Project、数据库、服务或意图图。持久多模块工程才建立相应共同入口。

## 2. 六工具

产品公共操作保持六个语义家族：

| Tool | Meaning | 不得暗做 |
| --- | --- | --- |
| `query` | 读取/解释固定范围事实或投影 | write、execute、adopt |
| `propose` | 构造候选变化/实现/修复 | 发布或取得写权 |
| `preview` | 对固定候选计算差异、影响和预期 Effects | apply、运行真实 Effect |
| `check` | 对固定对象执行纯/获准验证并形成 Evidence | 修改 Requirement 迁就结果 |
| `apply` | 在准确 preimage 和 Authority 下提交作者/工程变化 | 自动运行/发布 |
| `operation` | 启动真实 build/run/install/deploy/external Effect | 用成功启动冒充最终 settlement |

六者是语义家族，不要求六个物理二进制/HTTP endpoint。IDE、CLI、AI SDK 可以把高频组合做成一个命令，只要其内部 authority、result 和 failure 仍可区分。

**普通直接文本编辑是合法入口。** `propose` 不是每次修改的强制前置；当客户端已经拥有该作者区域写权，可以形成 candidate snapshot 后直接进入 preview/check/apply。AI/外部工具不能仅凭生成文本取得 apply authority。

## 3. 一次完整开发

典型闭环：

```text
fix intent/scope
→ obtain exact source snapshot
→ edit/propose candidate
→ preview semantic + physical delta
→ check required closure
→ apply exact candidate
→ build/materialize target
→ optionally run/debug/test
→ observe and settle
→ next edit uses resulting exact revision
```

合法提前结束：
- query-only；
- draft/candidate saved；
- author change applied but no target requested；
- target built but not run；
- run completed and settled。

“继续开发”不意味着自动执行后续 Effect。

## 4. 人与 AI

人与 AI 消费同一 canonical identity / Requirement / candidate / diagnostic，但界面不同：
- 人适合编辑器、diff、命令、局部可视状态；
- AI适合最小 typed context、stable refs、batch candidate、machine-readable diagnostics。

AI context 是投影，不是第二工程模型。预算不足时返回缺少的 closure/unknown，不能裁剪 hard Requirement 后继续。

AI 可以自主完成已委派范围内的分析、候选和无额外 Authority 的操作；网络、secret、写入、运行、部署等仍由实际 capability/Grant 决定，不由“agent”身份统一放宽。

## 5. 默认低摩擦路径

本地小改应接近原生工具体验：
1. 用户直接编辑；
2. 增量解析/语义/影响在后台或按需；
3. 保存时只检查必要结构；
4. 显式 `check/build/run` 才执行对应工作；
5. 无关 Target/Provider/领域能力不加载。

SEC 的附加抽象必须有真实消费者。若对某类任务结构作者、Implementation Resolution 或其他中间层长期没有净收益，允许该任务采用直接原生路径；不能要求所有用户为平台一致性填写无用对象。

## 6. session 与 generation

每个可异步返回的请求绑定：
- request/session identity；
- input/candidate revision；
- purpose；
- cancellation/timeout；
- output generation；
- disclosure scope。

新输入产生新 generation。旧诊断、搜索结果、preview、build 或运行结果可以作为历史结果显示，但不能覆盖当前 generation 或被误当当前适用。

Session 结束只释放它拥有且已 settlement 的资源；共享 compiler cache/provider/session 由其真实 owner 决定 lifetime。

## 7. 错误

开发面错误至少区分：
- invalid author source；
- unresolved/ambiguous；
- Requirement conflict；
- MissingSupply/unsupported target；
- stale candidate/preimage mismatch；
- permission/authority denied；
- check failed；
- tool unavailable/fault；
- operation accepted but settlement unknown；
- cancelled；
- partial root completion。

客户端不得把所有 failure 降成 red text 或 exit 1；下一步取决于类别。

## 8. 工作台与无界面使用

SEC 不要求图形界面。CLI/SDK/AI可以完整完成作者、编译、检查和运行流程。若实现 Workbench/IDE，则它是 [Deliverable Model](deliverable-model.md) 中的成品，必须满足编辑、搜索、诊断、任务、调试、VCS、扩展、设置、恢复等完整合同，不能以 UI 存在改变产品语义。

子规范：
- [工具、会话与 AI 上下文](developer-surface/tools-sessions-and-ai.md)
- [编辑、构建、运行、调试与测试](developer-surface/edit-build-run-debug.md)

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

SEC 开发面让人和 AI 操作同一 canonical 工程对象，不手工驱动内部编译流水线。query/propose/preview/check/apply/operation 六工具保持读、候选、预览、验证、提交和现实 Effect 的 authority 区分；普通原生编辑和无 GUI 使用始终是一等路径。
