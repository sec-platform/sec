# 多表示真实作者工程与 SDK 协作校准

本材料是有限的**工程源码设计用例**，不是已经由 Gift 编译器运行的工程，不拥有源格式/ABI/Target 规范。实际合同在[统一作者源码协议](../../docs/10-作者与输入/作者源/工程源/统一源码工程与多表示作者协议.md)及[跨表示编译接合](../../docs/70-工程系统与演进/实现与装配/多表示输入与统一编译接合.md)；原工程由 `fixtures/author-workspace/Gift90/` 提供静态文件样本。

## 案例一：只有结构化作者源码的新工程

`structure-first/gift.project.json` 选择 `design/` 里的两个 `*.module.json`，`foundation` 提供可复用 Definition，`studio` 只导入其公开 `Settings` 并用 `use` 实例化。实际内容只有 `req:composite`、value 参数及默认的准确设计结构。没有 `src/main.gift`、`src/main.rs`、TypeScript Target、`gift.lock.json` 或 Runtime，是完全合法的**未形成目标的结构设计工程**。

正常消费顺序：`gift.project/1` 成立 → SourceProfile 选择严格 JSON → 结构外壳解码 → `req:composite`/default/Term 校验 → 公开 `foundation.Settings` 工作区绑定 → 取得 `StudioRoot` 的组合结构和未实现义务。只有实际取得本项目所用草案 dialect 的准确内容/读取器及真实语义检查时，才允许将它签成*语义合格*；历史外部 Python 检查器的 JSON Schema 通过只属于对应版本的局部结构验证。

这里 `maxAttempts=3` 是纯作者参数默认，没有 `Retry` 引擎、真实 IO 或 IDE 宿主。若明日修改默认到 `4`，本定义的使用者若未显式固定值，会在采纳新 Definition 后读取 `4`；显式固定 `3` 的消费者不跟随默认更新。不能用 JSON 文本相同的值推导两类消费者的作者选择相同。若某一次调整被 SDK 序列化，保存的仍是同一个 `foundation.module.json` 候选，禁止生成独立 `foundation.gift` 镜像。

## 案例二：已有 TypeScript 工程，Gift 只提供额外的独立要求

`native-existing/src/editor.ts` 是 `renameDocument` 函数真实唯一作者源；`package.json` 属于生态配置。`design/requirements.module.json` 只是独立 `ReleaseContract` 逻辑组合外壳，其 `terms` 为空，**并未声称声明“revision 永远递增”等任何性质**。若开发者随后要约束函数结果，必须补充真正的 `Rule`/谓词与带准确观察域的引用，不能把 `ReleaseContract` 这个名字当成可执行校验。

正常消费：保留 TS 原文件与其安装/构建规则；在被授权的范围内取得原生源码，按所选 TS 适配器实际支持的符号/签名/源码编辑能力形成 typed/partial view；独立要求由结构模块保存；做目标设计时聚合已有 API 与未知原生行为、资源和 Build 约束。只有真实 ABI/Method/目标被选中并通过对应检查，才允许声称产物完整。这里 `modules` 只注册实际结构模块，**不是说 TS 文件不存在、不可检查或应伪造为新 Gift Definition**。

若用户要求在 TS 项目内重构 `renameDocument`，修改 TS 文件，不同步更新一个 JSON AST 假函数。若用户要求设计一个 VS Code 级编辑器，源实例依然只覆盖一个小函数和空要求壳；不能借该样本的文件名声称 Extension Host、LSP、渲染和更新器已存在。

## 案例三：利用 Rust SDK 构造结构模块

工具作者可能提供 `ModuleDraft` builder：给定固定的 `moduleId`、`dialects.req` 和输入参数，创建上例 `foundation.settings`，然后输出 `gift.author-module/1` 字节。与人手写同一个逻辑结构时，两者可以取得相同的 Definition 意义；这只校验在**这个固定的有限 dialect** 中的结果，无法证明任意 Rust 程序与任意 `.gift` 程序等价。

SDK 三个时点独立：

1. Rust builder 在宿主内存构造数据（可以按纯 API 设计），尚未取得 Gift 持久作者写权；
2. 应用接受结果的固定字节和原 SourceRevision，生成可审查 Candidate，执行真实结构与 dialect 检查；
3. `apply` 比较当前前像、权限、相交不变量后，只写回原唯一 JSON owner，返回真实结果。

如果开发者直接运行一个读取时间、密钥、环境的 Rust `build.rs` 决定作者 JSON，则它是一次**外部构造操作**而非每次固定构建的隐含纯宏：要记录准确输入，获准运行，冻结输出并分离秘密。对它的宿主测试通过只证明 Rust 构造程序性质，不自动证明 Gift Requirement、目标或业务。

## 案例四：一个真正与原生语言独立的纯计算程序

开发者明确要求同一受支持算法在 TypeScript 与 Rust 两种目标下保持类型、错误、算术溢出和可观察返回关系，并有合格的中立语义与 Target 可用时，可选择 `.gift` 中立计算文本作为**真实程序作者源**。这不是因为 JSON 不好，也不是因为 Gift Core 必须自研完整语言，而是存在合理的目标中立语义保持收益。

此时 `.gift` 的类型/函数由其已选计算语言规则拥有，项目清单只记录 SourceProfile/公开根/Target，请求逻辑约束仍独立保存。若 Rust 与 TS 的实际整数表示或异步资源无法保持当前合同，必须限定输入域、选择合格 helper/适配或报告目标缺口；不能靠自称“图灵完备”解决。不需要同时维护中立 `.gift` 和一份人工可写 `.rs` 的同义主体。生成出来的 `src/lib.rs` 和 `src/index.ts` 是对应 ArtifactSet，不取得另一份作者权。

## 案例五：多个目标、部分合格和以后迁出

从同一 Requirement 与行为根，选择 `ts-esm` 与 `rust-native` 两个不同 Target。TS 有真实 Method、所需依赖和构建产物，Rust 因没有所需 Host API 而不可用：可以返回 TS 的完整产物以及 Rust 的准确 Need；如本次任务要求两目标**共同发行**，整体任务不能标记完成。用户决定只交付 TS 时，形成新任务目标/作者选择，不能把 Rust 失败静默抹去。

导出独立 TS 项目后，接收者可以不使用 Gift 持续维护源码；此后它成为真正的原生来源，原 Gift SourceMap/Revision 并不自动延续。想要在新的 Gift 工程里重新接管，必须走新的来源捕获或明确的有凭据迁移；没有原作者快照，不得从生成字节凭空恢复原 Requirements 的独立采纳身份。

## 六个样本共同的非等价反例

- 两种输入计算上图灵完备，不说明它们有同样的资源/权限/运行期约束。
- Rust 模块的 Builder 和 Rust 业务库是两个不同角色；生成结构定义与实际提供算法不是一件事。
- JSON 严格 Schema 验证与 Gift 精确 Requirement 解释是不同阶段。
- `targets:{}` 是未要求目标而非“编译成功的空项目”。
- `SourceProfile` 是物理源解释选择，不是 `gift/author` 的别名，不把不同源混合解释成同一段文件。
- 工程蓝图是随输入可重建的只读结果，不是永久作者模型，也不自动取得实施资格。
