# Gift118：公共业务语义模式的结构与差异保持样本（历史研究说明）

这是一份供施工者使用的**历史结构设计见证**。`capacity.pattern.json` 为未来 `semantic:pattern` Definition 的 `body` 样例，它仍不是 Gift117 现有 `intent:goal` Reader 可执行的新增种类；引入产品之前必须完成 parser/profile、Meaning/DefinitionRef 和 Method 资格接合。原 Gift112 的 `intent-hospital-bed.module.json`、`intent-gpu-quota.module.json` 和 `meaning-capacity.json` 按原版本保存，在原记录中作为有限作者/Meaning 见证报告，当前包未附运行证据。

`capacity.pattern.json` 只共享模型容量不变量，刻意留下医疗/票务/GPU 不同的资格签发、资源政策和确认观察。它不能靠给 `qualificationAuthority` 填一段字符串产生真实授权，也不允许把抢占/超售政策变成未显示默认。`meaning:cap-within` 是当前固定模型域中的谓词，不是现实事务或无限轨迹不变量的保证。

机器结构校验：原实验入口 `fixtures/semantic-abstraction/Gift118/check_design.py`。原脚本仅验证 JSON Schema、局部 role/variation 引用、重复 ID、含义引用存在与恶意未知键的拒绝；它不执行 Gift 产品编译器，也不对所有领域意义进行形式证明。

唯一语义 owner：[`抽象与开放定义`](../../../docs/20-语义与组合/组合/抽象与开放定义.md#gift-abstraction-calculus)。作者采用边界：[`意图源`](../../../docs/20-语义与组合/作者语义/通用意图语言-意图源与语义组合.md#gift-intent-abstraction-application)。该样例不会自动更新两者中的任何规则。

**通用性边界：**原样例使用有限谓词形状；`sharedClaims` 也允许 `requirementRef + roleBindings + scopeRef`，用于引用原有 Requirement owner 已定义的义务、许可、长时序、偏好、外部效果及复杂量化，而不是给这些区别发明假的 `Bool` 运算。样例脚本只能检查该引用的结构与局部角色，**不能核实外部 Requirement 是否存在或有权、兼容或已被执行**。产品接入时必须使用真正被锁定的 Requirement 解码器和证据系统，不能依赖原脚本的名字检查。

全模块外壳示意：`capacity.author-module.proposal.json` 把上述 Body 放在 `gift.author-module/1` 的 `definitions` 中，并**明确选取未来 `semanticPattern` 方言**。它属于候选读者的目标输入，不是旧版 `intent-module-1.schema.json` 或现有产品已发布支持的文件。旧版 Intent-only Reader 必须拒绝，未来共存 Reader 必须验证方言锁、导入、Kind 和源位置；不能因为 JSON 能解析就直接接受。
