# 跨层机器合同的有限示例与反例（设计提案）（历史研究说明）

原实验目录是 Gift 95 **未发布的版本化机器合同提案与可重复静态检查载荷**，不参与作者工程真源、不修改 `gift.project/1` 或已经存在的 Rule/Target 语义。该提案补齐 `req:rule` 中一个可判定的 **call-bound observation** 子 Profile；其它状态/时间/概率/设备/分布式观察继续由合格语义 Provider 提供，不被本有限 Schema 的 `oneOf` 错误关闭。

`example/author/` 的模块是真正的作者 JSON；`example/supply/` 由第三方 Method/Target 供给者拥有，不应被加入项目作者 `definitions`；`schemas/` 是候选机器文件布局，不是已发布正式 `gift.*` schema。这个例子故意留下 failure、progress、native purity、数值/Unicode 等 Need，证明结构检查不会签发完整实现。项目中的 `example.target.ts/1` 字符串只表示尚待绑定的供给身份，不是实际锁定的 TargetProfile。

原实验的 `verify.py`、`test_contract.py` 需要 Python3 与 jsonschema，运行时不联网、不执行项目源码、不运行第三方方法、不创建 `gift.lock.json`。工具只检查 JSON 严格性、Schema 与一部分跨文件引用/资格，不能替代 Gift 编译器、独立 Oracle、权限检查或生产级保证。

`example/author/src/document.ts`是真实原生作者文件，Rule内的 `example.native` 公开符号引用须由合格TS适配器和锁进行绑定；不能凭函数文本或同名声明自动证明纯性。`minimumDelta`字段通过 `field` 槽明确参与正常谓词，其他文件与实际目标工具链仍保持未完成状态。

## 结构校验到完成资格：派生结果封套

`schemas/qualification-envelope.proposal.schema.json` 是有限的**派生结果提案**，由 `verify.py` 根据当次真实输入字节组成的 `basis.files`（每个有相对路径与 SHA-256）产生；其 `stage=STATIC_DESIGN_FIXTURE`、`coverage.complete=false`、`qualification=NOT_READY_FOR_TARGET`、`artifacts.generated=0`、`operations.executed=0` 不是用户输入、也不是可修改的作者事实。修改任何参与的源字节都会改变相应 basis 摘要；旧结果不能代表新快照。原实验未验证的内容包括公开原生符号类型/效果、Predicate 纯性与解释、实际实现方法、Target 工具链、外部运行和独立验证。

若将该派生结果作为可共享的真正产品结果，必须由现行 Request/Session/Result Owner 提供身份、范围、披露与签名/完整性、防重放、分页/水位、资格等级和消费者合格 Schema。**不得**因为本 fixture 中出现了 `sha256` 就声称有认证或可执行授权；本结果也不允许被当作可执行 Lock、Method qualification 或 Evidence。

在有限结构检查中，所有 `project.modules` 必须处于被声明的 semantic SourceScope 内，`src/document.ts` 属于 native SourceScope，且经过受控路径读取；相交的符号链接（含中间目录段）、`..`、路径越界、重复作者 Scope 均拒绝。该保护只覆盖这一个本地 Fixture，不宣称任意非协作写者或多租户目录的实际防护。
