# Ignore 核心、gitignore 与 override 草稿的来源和未决

本目录是进行中的作者设计，**不是已经编译或完成的移植**。来源是固定 P
`4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 `crates/ignore/src/`：
`lib.rs` SHA-256 `ae54b28b3c9645c048a020155deec87e72f9bcbc23d702b4054902c3c013ed4c`；
`gitignore.rs` 为 `cbe37c83ce9cd549f30bcc2d6b6ecc07d88cdbb3258ab22019b2f9cd7f5deb1b`；
`overrides.rs` 为 `5fcc48eff6f3548a2f2e6569d42b72c3c515273038fc6db931ccab92956c7c4b`。
不将本片的范围扩展到 `dir`、`walk`、`types` 或整个工程。

## 对应范围

| P 来源 | 目前作者内容 | 对应接口和主要行为 |
| --- | --- | --- |
| `lib.rs` 的 `Error`、`PartialErrorBuilder`、`Match<T>` | `core.module.json`，41 个定义 | Error 的九类、clone 主体、is_partial/is_io/io_error/into_io_error/depth、路径/深度/行标记、walkdir 转换；部分错误收集和 Match 的查询、反转、inner、map、or |
| `gitignore.rs` | `gitignore.module.json`，60 个定义 | Glob 元信息、行解析、Gitignore 的 new/global/empty/path/计数/匹配/逐级父路径、builder 的 new/build/build_global/add/add_line/选项，以及配置路径与 excludesFile 提取 |
| `overrides.rs` | `overrides.module.json`，25 个定义 | 空 matcher、计数翻转、匹配翻转与未命中文件默认 ignore，builder 的创建、构建、添加和两项设置 |

`MatchIsNone/Ignore/Whitelist` 查询使用共享 `Borrow<Match<T>,r>`；需要随后移动
结果的调用先做有界共享借用。`BuilderAddLine` 的草稿顺序为解析、编译、短时借用
set 完成 add、结束借用、push 元信息。文件读取草稿只在第零行移除 UTF-8 BOM，读
失败时收集带路径及行号的错误并停止；配置搜索按 P 表达 environment、home、XDG、
system、default 次序。这些是源码中可检查的意图，并不证明实际 Reader/目标运行。

`Error::WithLineNumber`、`WithPath`、`WithDepth` 的递归字段现已显式表达真实
`Box<Error>`，构造时使用 `BoxNew`，借用时使用 `BoxBorrow`，按值取出时使用
`BoxIntoInner`。当前共享 machine 门面已有相应标准泛型身份与操作的暂定选择；root
仍须按直接导入或生成降低收敛其来源。有限布局、实际分配及销毁顺序不能由 JSON
结构本身证明。

本片还给出 21 个实际 `Clone`、`Debug`、`Display`、`Default` 的专业实现主体：
Error 三项、PartialErrorBuilder 两项、`Match<T>` 两项，Gitignore 的 Glob、
Gitignore、GitignoreBuilder 各两项，override 的 GlobInner、Glob、Override、
OverrideBuilder 各两项。泛型 Match 的原 Sized 及 Clone/Debug 约束分别保留。
Debug 使用原 Formatter 的 struct/tuple builder 与短独占借用；Error Display 的
WithDepth 和 Io 直接转发原 Formatter，其余嵌套项使用默认格式。文本入口回到同一
Display witness，不再拥有第二份错误格式算法。PartialErrorBuilder 的四个更新入口
现在消费其现有独占借用并原位更新 Vec，对应 gitignore 调用点也同步改为短借用。

override `Glob<'a>` 是含 `GlobInner<'a>` 的包装，后者的 Matched 只持有
`&'a gitignore::Glob`；clone 复制引用而非克隆被引用 Glob。Gitignore 的克隆对 Arc
使用其真实 Clone，builder 构造 matcher 对 Glob Vec 使用 Vec 的 Clone。仅声明这些
主体和标准 witness 不代表实际 trait 解析、编译或运行已合格。

## 明确未闭合

- 共享接口尚不齐。`StaticStr` 属于共享 Gift 语义；Error Display 暂以
  `PathDisplay<'r>`、`DisplayValue(&'r Path) -> PathDisplay<'r>` 指代标准
  `Path::display()` 的借用视图，当前这两个名字没有绑定。根 owner 须按直接导入或
  生成降低规则收敛身份，而不要求新增手写 Rust 包装；不能使用当前提前分配 String
  的 `path:Display` 冒称保持。`walkdir`、`os`、`regex`、`pool`、
  `sync`、`log` 的相交 workspace 模块及 `pathutil:StripPrefixText` 尚未
  全数接入。`std:TextConcat` 是固定保留基底，不需要工作区导入；其 Text 与标准
  String 的准确表示关系仍需实际目标解释。
  `walkdir:IntoIoError` 必须核实是否实现 P 使用的 `std::io::Error::from(err)`，
  不能把返回 `Option` 的不同操作误当相同转换。仅文件存在或符号拼写不签发资格。
- `BuilderAddLine` 的错误分支借用 `glob:ErrorKindBorrow` 的结果并交给标准
  `format:DisplayToText`；`BuilderBuild` 同样借用完整 glob 错误进行格式化，
  两处都没有为取得按值参数额外 Clone。该格式原语有暂定 format 门面；globset 的
  `Display for ErrorKind`/`Display for Error` 及 GlobSet/GlobSetBuilder 的 Clone/Debug
  真实 witness、pool 等依赖尚待对应 owner 接入。Error 的 `std::error::Error` 和
  `From<std::io::Error>` trait 接合也依赖共同 trait 声明，不能由普通函数代签。
- P 公开的 `new/global/build_global` 返回 Rust 元组；作者返回型现使用已选择的
  `machine:Pair<Gitignore,Option<Error>>`，暂用未绑定的 `machine:PairNew` 表达
  按左至右求值构造原生 `(A,B)`；根 owner 须以直接导入或生成降低消除该未决，
  目标公开 ABI 仍未闭合。
  Error Partial Display 现按 P
  表达 `iter().map().collect::<Vec<_>>()`，再 join 和写出；其中通用标准
  `machine:IteratorMap` 与 `IteratorCollectVector` 是未绑定的准确泛型调用占位，
  root owner 须以真实标准方法直接导入或生成降低形成闭包见证与来源。不能把引用
  本身当作真实供给，也不把 ignore 业务算法藏进专用 native helper。
- 尽管已写 trait 与独占更新主体，全部借用区域、callback 捕获、短 reborrow、
  非 Copy 移动、格式结果、静态单例、trait coherence、效果、fault、外部库身份和
  真实目标公开 ABI 仍待 Reader/类型器/Method/Target 与消费者验证。

## 本轮证据

本轮保留原草稿并先修正递归 Box 形状，随后仅对当前 JSON 的指定定义和新增 witness
施加结构化补丁；没有重跑旧生成器覆盖新源。三个 JSON 均可解析、无重复键，使用 LF
和单个末尾换行。任务临时目录的
`wave2/ignore-focused-check.py` 对 19 个手写行解析向量、Match/override 分类、递归
Box 结构、add 顺序、借用错误格式调用及 BOM 引用执行了 74 项有限断言。该 evaluator 明确模拟字符串和
借用原语。`wave2/ignore-traits-focused.py` 另执行 1144 项有限结构、词法作用域及泛型
binder 断言，覆盖 21 个 witness、关键格式路径、错误收集借用及 override 包装。这些检查**没有**
执行 Gift Reader、类型/借用检查、效果、真实标准绑定、目标程序或 Cargo 差分；不能把
断言升级为完整等价证明。

原 `ignore-rules/.construct.py` 是生成辅助文件，已移出作者源并按原字节保留到
任务临时目录 `wave2/retired-author/ignore-construct.py`，不构成第二作者真源。
同一任务临时目录保留 `ignore-rebuild/`、
`ignore-focused-check.py`、`ignore-traits-focused.py`、`ignore-traits-build.py` 和
`ignore-native-needs.md`，分别用于重建对比、有限检查、受前像保护的本轮补丁与共享
接口交接；这些都不是产品源码或完成证据。
