# Gift96：从结构化作者意图到真实 TypeScript 符号的有限跨层见证（历史研究说明）

本文保存原 Gift96 **局部实现样本的说明和反例**，不是已发布的 Gift 编译器、Provider、目标后端或符合性证明。原例选择一个确切的 `req:rule`、一次 `require` 出现点、一个 `gift.controls/2` 硬控制、一个 Method 声明、一个 TargetProfile 声明、一个原生 TypeScript 实现，以及一个额外显式 native binding selection；它验证这些输入在这个封闭实例中能否同时成立，而不是通过若干独立 JSON Schema 就宣布成功。

## 原案例的文件责任

```text
example/
  author/
    gift.project.json               # 项目、SourceScope、目标和唯一 Control 记录
    design/
      rules.module.json             # req:rule Definition 与四类语义义务
      product.module.json           # req:composite 与发生点的 minimumDelta=1
      native.binding.json           # 逻辑符号 -> 真实 TS 导出，仍是尚未发布的提案协议
    src/
      document.ts                   # 仅此处保存原生 replaceText/revisionIncreases 的算法
  supply/
    method.json                     # 第三方供给声明，不是作者业务规则
    target.json                     # Target Profile 和预期成员，不是已生成目标字节
schemas/
  native-binding-selection.proposal.schema.json
  vertical-slice-envelope.proposal.schema.json
inspect_pipeline.py                # 有限闭合读取、检查、摘要和设计状态输出
probe-typescript.cjs               # 使用安装的 TypeScript Compiler API 解析真实 TS 类型
test_contract.py                   # 测试正常路径、冲突、逃逸、变化、失效等正反例
```

## 原实验的操作与边界

1. 严格 JSON 解码（拒绝同名键、NaN 和不合法正文），确认目录中的作者范围、模块导出、Rule/Occurrence/字段、原生符号绑定、Method/Target/Profile/Revision 与强硬 Control 一致。`gift.rule-call-observation/1` 必须**准确**被 Target `accepts` 接受。路径校验拒绝 `..`、未登记的原生来源和符号链接越界。
2. 命令 原实验入口 `inspect_pipeline.py`（原实验从其源码目录调用）调用 原实验入口 `probe-typescript.cjs`；只有已预装 TypeScript Compiler API 才运行检查。原实验记录使用 TypeScript 5.8.3；不自动安装、不执行作者源的业务代码。记录实际 exported symbol、函数类型、参数位置及赋值相容性；**不推断**纯度、帧条件、异常、终止性或行为证明。
3. 输出的提案 `gift.vertical-slice-envelope-proposal/1` 含跨作者源、供给、Schema、适配器与工具版本的内容基准摘要，强制给出 `NOT_READY_FOR_PRODUCT_DELIVERY`、明确的 `Need`，而不签发 ArtifactSet 或 Grant。
4. 带 `--emit /绝对路径/空输出目录` 时只输出一份**隔离的**源同字节 TypeScript 样本：`src/document.ts`、`package.json`、`tsconfig.json` 和逐成员 Hash 收据 `sample-receipt.json`。拒绝非空目标目录；不会触碰原 Workspace、推送 GitHub、发行 lock、生成通用规则包装器或执行外部效果。真实构建与调用需由独立测试验证；若编译器未装，将失败而非默默假定成功。

**有限 TypeScript 源图安全边界：** 原例刻意只授权 `src/document.ts` 一个原生文件，`probe-typescript.cjs` 在调用正式 TypeScript 模块解析器之前拒绝所有 import、re-export、类型导入、动态导入、三斜线引用和 require 依赖。正常多文件工程并不应永远禁止这些语法；产品级 SourceProfile 应预先用授权 SourceSnapshot 解析完整依赖图及所有否定依赖，并对 `CompilerHost` 的读取实施硬隔离。目前的单文件禁用是公开的**受限产品画像**而非通用 TypeScript 语言支持。

## 测试覆盖与不覆盖

包含 profile 不相交、require 与 ESM 冲突、描述符与 Target 修订失配、Method 覆盖缺口、Native 文件/符号逃逸、TypeScript 可观察类型不兼容、源变化使读基准失效、隔离输出不可覆盖及虚假资格等负例。这些测试仅针对**显式支持的 fixture 形状**。Method `domainRef` 的真实实例资格、别名/泛型/重载、多文件受权事务、全部目标语言、外部 Effect、Frame/Failure/Progress、独立 Assurance 和真实生产 Gift 所需的工程集成仍待对应真实 Owner/消费者实现。

## 规范所有者（禁止将样本当作规范副本）

- 作者源/绑定：`docs/10-作者与输入/作者源/工程源/工程清单模块与绑定锁协议.md`
- `req:rule`：`docs/20-语义与组合/作者语义/需求规则与供给合同.md`
- Control：`docs/20-语义与组合/组合/稀疏控制与目标限定.md`
- Method/Target：`docs/30-实现解析/实现选择/实现解析与候选资格.md`、`docs/40-目标与制品/目标/交付消费合同与发射.md`
- Assurance 与剩余实现：`docs/60-保证与证据/保证/要求证据与裁决.md`、`docs/90-治理与参考/状态/实施闭包.md`

注意：上述规范路径以**设计包根**为相对起点。此 README 是样本使用说明，不是任何机器合同的新增规范 Owner。

## 数值语义：可实际复现的反例

`example/author/src/document.ts` 的 `revision: number` 没有静态安全整数域约束。正常输入 `3` 时更新到 `4` 且谓词判断为真；将前像设为 `2^53` 时，`number` 舍入导致更新后仍为 `2^53`，**而谓词误判为真**。此异常不是测试程序的期望外错误，而是一个已经观察到的语义反例：若作者要求数学整数严格递增，必须加上可验证的输入域（以及越界失败语义），或采用精确整数表示并重新证明 Target 映射。

该证据支持“当前无限制 number 域的实现不符合数学严格增长”；不能扩展为“所有 Rule/Method 都错误”，也不能反向将正常范围的有限测试冒充全域证明。`SOURCE_CHANGED_DURING_INSPECTION`、`PREVIEW_BASIS_STALE` 则分别阻止在检查过程/发射前发生的持久字节漂移。前后核对在未受管的第三方写者、ABA 状态变化下不构成生产事务隔离。

## 下一范围中的修正而非追溯抹除

Gift97 在 [同属跨层样本的精确 Revision64 独立实现](../Gift97/revision64/README.md) 中用 `bigint`、canonical wire 和边界失败明确解决了**受限域**里的浮点误判。Gift96 原本的 `number` 源及 2^53 FAIL 见证不被修改，以保持不同实现、版本和证据的可比性。
