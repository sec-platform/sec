---
title: SEC 复用审查 1至22
status: historical
domain: external-provider
---

# SEC 复用审查 1至22

本文件是冻结研究裁决，不是 live Provider 状态。通用限制、来源层级和执行路径见 [README](README.md)。


## R01 CLI 语法与终端展示

消费点：`package.json`；`src/interface/cli`；证据层级：`manifest-and-tree`。

方案：commander；ora；picocolors；裁决：`retain-existing`。

机制/依据：已声明三种专业库，不再另建通用参数解析器、颜色库或 spinner。命令语法与执行许可是不同层。

保留：惰性命令加载、稳定 machine JSON、退出码、stderr 隔离与已有领域命令 owner。

退出：仅清除经过调用链证实重复的参数/展示胶水；不删除领域校验。

验收：帮助与错误路径、非 TTY、管道、Windows argv、JSON 无 ANSI、取消后 spinner 结束。

反转：只有真实兼容性或启动闭包问题证实当前库不适用才替换，不因另一 CLI 品牌流行迁移。

原始来源：[1](https://github.com/tj/commander.js)；[2](https://github.com/sindresorhus/ora)；[3](https://github.com/alexeyraspopov/picocolors)。


## R02 TypeScript 解析、构造与打印

消费点：`src/compiler/codegen/code-builder.ts`；`src/brownfield/source-program-model/typescript.ts`；证据层级：`source-read`。

方案：TypeScript compiler API；ts-morph；裁决：`retain-existing`。

机制/依据：代码已经用 TypeScript factory、printer、scanner 和 parser；不是自写 TS 编译器。ts-morph 只在大量复杂可变 AST 操作证明减少胶水时试点。

保留：片段必须为预期 AST 形状、诊断、目标版本、符号与项目身份；类型检查 CLI 和程序化 API 分别绑定。

退出：不能把现有 factory 封装一对一换名；若试点 ts-morph，删除相同 AST 编辑实现而不新增第二个 Program。

验收：泛型/装饰器/JSX/声明文件/注释、非法片段拒绝、输出复解析；精确 API 版本与峰值内存。

反转：只有新编辑操作无法用现有 API 简洁可靠表达且 A/B 有净收益时扩大封装。

原始来源：[1](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)；[2](https://ts-morph.com/)。


## R03 CompilerHost 与虚拟文件系统

消费点：`src/brownfield/source-program-model/typescript.ts`；`src/toolchain/dependencies`；证据层级：`source-and-inventory`。

方案：TypeScript Program/CompilerHost；@typescript/vfs；裁决：`pilot-if-consumer`。

机制/依据：复用编译器项目加载与增量 API；VFS 只候选接管可替代的内存输入胶水。现有项目模型保留源版本和事实分片，不能被 VFS 的 Map 代替。

保留：实际 tsconfig、依赖/type roots、loader 身份和权限；变化闭包与旧事实失效。

退出：通过同项目差分后删除重复虚拟 host，不建立第二份不失效索引；禁止示例中的隐式 CDN 下载。

验收：project references、缺失依赖、路径别名、大小写、文件删除、cold/warm/full rebuild；离线零隐式获取。

反转：现有 host 已足够且引入更多复制/内存时维持原生实现。

原始来源：[1](https://www.typescriptlang.org/dev/typescript-vfs/)；[2](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)。


## R04 既有源码保格式变换

消费点：`src/brownfield`；`src/change-management`；`src/compiler/codegen/code-builder.ts`；证据层级：`source-and-inventory`。

方案：Recast；TypeScript factory/printer；裁决：`pilot-if-consumer`。

机制/依据：新生成源码继续 compiler printer；对用户已有源码的最小编辑，Recast 可候选保留未改节点格式，不强求生成器承担 round-trip 编辑。

保留：变更范围、注释/格式与业务语义、source map、唯一 patch owner。

退出：适配同一编辑入口；不得同时维护两套格式保真补丁；不能把直接创建的 AST 假定为带 Recast original 关联。

验收：无修改字节一致、局部改动保留邻近注释、CRLF、Unicode、解析器版本及失败零发布。

反转：只生成新文件或已有 printer 已满足合同，不接入 Recast。

原始来源：[1](https://github.com/benjamn/recast)。


## R05 跨语言快速语法发现

消费点：`src/brownfield`；`src/semantic/projection`；证据层级：`inventory-and-provider-design`。

方案：Tree-sitter；裁决：`watch-with-trigger`。

机制/依据：新语言出现真实消费者时使用现成 grammar 做增量语法/结构发现；这避免自写每种语言 lexer，但树不等于符号解析或完整语义。

保留：语言/grammar/文件版本、错误恢复节点、coverage/unknown、SEC 实体与关系身份。

退出：同语法能力经 old-only 差分后退役旧扫描器，不能删除类型/数据流 owner。

验收：不完整编辑、预处理/宏、动态导入、Unicode offset、grammar ABI、native/WASM 安装与内存。

反转：编译器 API 已提供同输入的全部所需事实时不要增加重复 parser。

原始来源：[1](https://tree-sitter.github.io/tree-sitter/)。


## R06 符号索引与 IDE 协议

消费点：`src/brownfield/source-program-model/typescript.ts`；`src/external-capabilities`；`src/semantic/identity`；证据层级：`source-and-inventory`。

方案：LSP；SCIP；裁决：`watch-with-trigger`。

机制/依据：用语言服务器提供交互符号查询，用 SCIP 交换持久索引；协议不是统一语义引擎。SCIP 上游地址已重定向至 scip-code/scip。

保留：源快照、workspace 配置、provider identity、字段覆盖与陈旧索引；SEC 负责 canonical identity。

退出：有必要消费者后替换相应索引传输胶水；不用 LSP 文本状态维护第二个 canonical graph。

验收：重命名、外部符号、生成文件、版本变更、服务重启、部分索引与协议失配。

反转：仅本地已绑定 compiler API 查询就能完成时不启动服务。

原始来源：[1](https://microsoft.github.io/language-server-protocol/)；[2](https://github.com/scip-code/scip)。


## R07 Java 前端

消费点：`src/brownfield`；`src/external-capabilities`；`src/semantic/engineering-ir`；证据层级：`target-expansion-design`。

方案：Eclipse JDT ASTParser/bindings；裁决：`watch-with-trigger`。

机制/依据：Java 支持应复用 JDT 的 AST 与按需 bindings，不从 TS 语法类比实现 Java 类型系统。绑定解析默认不是开启状态。

保留：classpath/module path/JDK、source level、annotation processor Effect 与语义 coverage。

退出：新语言 admitted 后删除被其覆盖的临时 Java scanner；不删跨语言 IR。

验收：多模块、泛型、重载、缺失 classpath、工作副本、绑定失效、批量加载和内存。

反转：只有语法轮廓需求时不用昂贵 bindings；无 Java workload 前不宣称已支持。

原始来源：[1](https://help.eclipse.org/latest/ntopic/org.eclipse.jdt.doc.isv/reference/api/org/eclipse/jdt/core/dom/ASTParser.html)。


## R08 C#/.NET 前端

消费点：`src/brownfield`；`src/external-capabilities`；`src/semantic/engineering-ir`；证据层级：`target-expansion-design`。

方案：Roslyn；裁决：`watch-with-trigger`。

机制/依据：复用 Roslyn syntax/compilation/semantic model；环境和构建项目事实仍须绑定，不能只解析一个文件就报项目完整。

保留：.NET/SDK、MSBuild inputs、conditional symbols、source generators 与执行权限。

退出：替换具体 C# 语法/符号采集，不另造通用 AGI 或覆盖 SEC 语义裁决。

验收：多 target framework、partial class、generated source、conditional compilation、cancel、unsupported。

反转：无 .NET target 的实际实施许可时只保留触发条件。

原始来源：[1](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/)。


## R09 Go 前端

消费点：`src/brownfield`；`src/external-capabilities`；`src/semantic/engineering-ir`；证据层级：`target-expansion-design`。

方案：go/ast；go/types；golang.org/x/tools/go/packages；裁决：`watch-with-trigger`。

机制/依据：go/packages 可按 LoadMode 取得包、语法与类型事实，避免自写 module/build-tag resolver；默认会委托 go 工具。

保留：GOOS/GOARCH/build tags/module/workspace、工具派生进程与网络许可、加载深度。

退出：先限定事实集合再替换 Go scanner，不将包加载成功当全部运行关系已知。

验收：replace/work/vendor/cgo、生成文件、不可下载依赖、部分加载、准确配置摘要。

反转：只需词法定位时不加载完整类型图；无真实 consumer 不安装 Go。

原始来源：[1](https://pkg.go.dev/golang.org/x/tools/go/packages)。


## R10 Rust 前端

消费点：`src/brownfield`；`src/external-capabilities`；`src/semantic/engineering-ir`；证据层级：`target-expansion-design`。

方案：rust-analyzer；Cargo metadata；裁决：`watch-with-trigger`。

机制/依据：复用 Cargo 工程事实与 rust-analyzer 语言能力，宏展开和 build scripts 不是无副作用读取。

保留：toolchain/target/cfg/features、proc-macro 执行许可、来源与覆盖。

退出：替换具体 resolver/索引胶水；保留 SEC provider/admission owner。

验收：workspace、features、宏、缺失 crates、build-script sandbox、重启和陈旧符号。

反转：未授权宏执行必须 unknown，不能为了完整索引自动执行不受信代码。

原始来源：[1](https://rust-analyzer.github.io/book/)。


## R11 Python 结构与源码变换

消费点：`src/brownfield`；`src/change-management`；证据层级：`target-expansion-design`。

方案：LibCST；Python ast；裁决：`watch-with-trigger`。

机制/依据：ast 可取得标准语法，LibCST 为保注释/空白变换提供 CST。动态运行时不能因有 CST 就强行声明调用图完整。

保留：Python grammar/version、解释器环境、imports 效果与字段级 unknown。

退出：替代 Python 文本重写，不建立第二份自维护 Python parser。

验收：编码、indent、f-string、type annotation、comment-preserving no-op、动态 import。

反转：只抽取不变结构且 ast 满足时不增加 CST 运行闭包。

原始来源：[1](https://libcst.readthedocs.io/en/latest/)。


## R12 C/C++ 前端

消费点：`src/brownfield`；`src/external-capabilities`；证据层级：`target-expansion-design`。

方案：Clang LibTooling；裁决：`watch-with-trigger`。

机制/依据：采用 compile commands 与 Clang 工具采集 AST/符号；头文件、宏和 target ABI 决定事实，不能靠文件后缀推语义。

保留：编译命令、sysroot/includes、编译器版本、native loader 与预处理配置。

退出：经目标语料验证后去掉被覆盖的结构扫描器；不去掉 unsupported coverage。

验收：宏、模板、跨 TU、生成头、不同 ABI、缺失 compilation database 与受限资源。

反转：无目标工具链时不把 Tree-sitter 语法结果升级成已类型解析。

原始来源：[1](https://clang.llvm.org/docs/LibTooling.html)。


## R13 结构搜索和简单 codemod

消费点：`src/brownfield`；`src/change-management`；`tests`；证据层级：`inventory-and-provider-design`。

方案：ast-grep；裁决：`pilot-if-consumer`。

机制/依据：对语法模式定位和机械替换使用成熟 AST 查询，避免把同类规则重复写成正则；命中仅为候选事实。

保留：命中源 witness、目标语言/grammar、允许编辑区和 Effect/readback。

退出：删除同用途 regex scanner；不把 ast-grep matcher 做成新的 semantic compiler。

验收：假阳性、缺失匹配、comment/string 同词、限定多文件变更与 no-op。

反转：需要跨过程类型或数据流时使用对应 provider，不能堆模式假装深分析。

原始来源：[1](https://ast-grep.github.io/guide/introduction.html)。


## R14 深度数据流与安全分析

消费点：`src/brownfield`；`src/verification`；`src/external-capabilities`；证据层级：`inventory-and-provider-design`。

方案：CodeQL CLI；裁决：`watch-with-trigger`。

机制/依据：针对实际 taint/flow 缺口评估 CodeQL，不自写完整多语言污点引擎；私有仓库使用权和 CLI 平台兼容必须先验明。

保留：查询/数据库/source/compiler 版本、false positive、coverage、授权与零默认上传。

退出：只有特定旧 findings 被逐项覆盖后删除旧规则；安全扫描绿色不是完成证明。

验收：private use license、native host、生成数据库成本、查询时限、失败结果和漏报反例。

反转：本仓库未取得适用使用许可或无必要查询时不得运行/采用。

原始来源：[1](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-cli)。


## R15 SEC 意图文本的 grammar 与编辑器支持

消费点：`src/compiler/parse`；`src/semantic`；`src/interface`；证据层级：`target-expansion-design`。

方案：Chevrotain；Langium；裁决：`watch-with-trigger`。

机制/依据：若设计确定独立意图文本面，语法/错误恢复/编辑器服务可复用；不先决定 .sec.ts，再把语言无关需求挤进 TS。

保留：语言无关实体/事实/逻辑、语义与 authority 定义；grammar 不决定业务 meaning。

退出：先确定语法合同和实际作者工作流，再替换 parser/editor 胶水，不建设第二语义状态库。

验收：错误恢复不授权执行、定位、递归/歧义、增量失效、人/AI round-trip 与可表达性。

反转：当前数据格式足够则不为使用 DSL 框架创造新语言；两候选互斥试点。

原始来源：[1](https://chevrotain.io/docs/)；[2](https://langium.org/docs/)。


## R16 严格 YAML 入口复用

消费点：`src/system-architecture/foundation/runtime/yaml.ts`；`src/compiler/parse/load-plan.ts`；`src/compiler/parse/load-manifest.ts`；证据层级：`source-read`。

方案：现有 yaml 2.9.0；Bun.YAML；裁决：`reuse-existing-first`。

机制/依据：已有统一 strict/uniqueKeys/byte/alias/warning 入口，但 Plan/Manifest 直接 YAML.parse。优先把真实输入合同接到已有成熟引擎，不新增第二 YAML 库。

保留：每域输入上限、单文档要求、诊断码、默认值时点、AST 所有权和 source digest。

退出：迁移调用者后删直接解析旁路；Bun.YAML 只有证明等价子集才候选，不能丢 AST/token/warning。

验收：重复 key、别名/循环、非有限值、multi-document、BOM、未知字段、边界字节和错误码兼容。

反转：不同域明确容忍不同语法时共享引擎而分离策略；不是全仓机械套同一配置。

原始来源：[1](https://eemeli.org/yaml/)；[2](https://bun.sh/docs/runtime/yaml)。


## R17 结构 schema 复用

消费点：`package.json`；`src/control/documentation/authority.ts`；`src/compiler/parse/load-plan.ts`；`src/compiler/parse/load-manifest.ts`；证据层级：`source-read`。

方案：现有 Zod；Ajv standalone（JSON Schema 域）；裁决：`reuse-existing-first`。

机制/依据：Zod 已声明，先用它收敛纯 DTO/exact-key/enum 验证；已有 JSON Schema 外部合同才比较 Ajv，不叠加第三套 schema authority。

保留：跨记录唯一性、拓扑、opaque capability、品牌来源、领域默认值和 SEC 错误 taxonomy。

退出：类型从一个结构源推导，删同义 guard；不得只加 schema 留下旧独立类型和 validator。

验收：unknown keys、optional/null、refinement、递归深度、coercion 禁用或显式化、trusted/test origin。

反转：opaque运行身份/授权不是结构检查；这些原有 owner 不能被 Zod parse 删除。

原始来源：[1](https://zod.dev/)；[2](https://ajv.js.org/standalone.html)。


## R18 Exact JSON 扫描与重复键

消费点：`src/system-architecture/foundation/runtime/exact-json.ts`；证据层级：`source-read`。

方案：jsonc-parser scanner/visitor；现有 exact-json；裁决：`pilot-with-byte-parity`。

机制/依据：现有 iterative scanner 有明确拒绝 decoded duplicate key 与 UTF-8/BOM 边界。jsonc-parser 可试点接管通用词法，不可直接用其容错 parse 后再 Zod。

保留：重复键发生在对象构造前、深度/字节限制、fatal UTF-8、精确键、错误分类。

退出：先把所有字节/非法输入向量差分；通过后删自有语法状态机，保留入站策略。

验收：a 与 \u0061 重复、注释/尾逗号拒绝、孤立转义、空文档、深嵌套与大输出。

反转：新实现无法及时终止、接受范围扩大或性能/栈不达标则保留当前已加固扫描器并记录差距。

原始来源：[1](https://github.com/microsoft/node-jsonc-parser)。


## R19 精确数字的外部 JSON

消费点：`src/system-architecture/foundation/runtime/exact-json.ts`；`src/external-capabilities`；`src/semantic`；证据层级：`source-and-inventory`。

方案：lossless-json；显式十进制文本/BigInt DTO；裁决：`watch-with-trigger`。

机制/依据：只有外部规范或 target 存在超出 Number 范围且必须保真的数字时启用专门值模型；不把整个 SEC canonical object 变成 LosslessNumber class。

保留：schema 的数值域、序列化、clone、hash、跨进程 DTO 和输出精度。

退出：为该 consumer 删除有损 parse/format；不能与 native parse 在同一字段静默混用。

验收：64位边界、指数/小数原文、不可表示数、round-trip 和版本迁移。

反转：合同明确只允许安全整数/有限 number 时严格拒绝越界即可，不必引入宽数值类型。

原始来源：[1](https://github.com/josdejong/lossless-json)。


## R20 规范字节与签名兼容

消费点：`src/system-architecture/foundation/runtime/canonical.ts`；`src/semantic/identity`；`src/semantic/provenance`；证据层级：`source-read`。

方案：native crypto；RFC 8785/JCS；裁决：`retain-current-epoch`。

机制/依据：现有规范化/hash 已迭代化。其对象整数样式键的枚举次序与 RFC8785 字典序不是当然相同；换 stable-stringify/JCS 会改变证据和身份。

保留：现有 canonical bytes、-0/undefined/array hole/prototype/accessor/Unicode 语义、历史摘要。

退出：只收敛同一 epoch 的重复 serializer；新跨系统 JCS 使用独立版本并迁移，旧证据不重签成“原结果”。

验收：数字样式 key、深层/循环、无 toJSON hook、lone surrogate、hash与bytes同一性、历史goldens。

反转：跨系统签名确需 JCS 时开明确新epoch，不通过改一个库名隐式升级。

原始来源：[1](https://www.rfc-editor.org/rfc/rfc8785.html)。


## R21 Markdown 链接、标题与片段

消费点：`src/control/documentation/doctor/shared.ts`；`src/control/documentation`；证据层级：`source-read-plus-isolated-probes`。

方案：remark/mdast；Bun.markdown；裁决：`priority-pilot`。

机制/依据：隔离探针确认引用式链接缺失、fence示例被当链接、Setext H1不识别。语法事实交 mdast；Bun当前文档提供 render callbacks，但不能假定它提供所需源码位置/CST。

保留：文档 profile、Clause身份、canonical links/fragment规则、root containment、authority registry。

退出：同一 AST 遍历代替多个正则语法解析器；明确保留的项目内联定位规则不重写 Markdown 语法。

验收：reference/inline/escaped/balanced link、code fences、Setext、重复标题与fragments；old-only/both/new-only。

反转：若规范明确限制为特定子集，先验证是否应拒绝，而不是无条件扩大语法；无Bun1.4.0验证不直接使用最新原生API。

原始来源：[1](https://github.com/remarkjs/remark)；[2](https://bun.sh/docs/runtime/markdown)。


## R22 frontmatter 边界与值解析

消费点：`src/control/documentation/doctor/shared.ts`；`src/system-architecture/foundation/runtime/yaml.ts`；证据层级：`source-read-plus-isolated-probes`。

方案：现有 yaml strict Document；裁决：`priority-pilot`。

机制/依据：探针中两个 status 行由 helper 选择第一个。frontmatter 外层分隔可做小型边界识别，内部 key/value 交现有 YAML 再过领域 schema。

保留：允许状态、metadata结构、引用类型、单一owner；不以模板执行器解释头部。

退出：删除逐字段正则读取器，错误明确传递到 docs doctor；不为头部再安装另一个 YAML 包。

验收：重复键、quoted/multiline值、CRLF、未闭合分隔、alias上限与非法状态。

反转：若正式合同故意不是YAML，必须命名独立受限格式并明确拒绝歧义，不能边称YAML边自定子集。

原始来源：[1](https://eemeli.org/yaml/)。
