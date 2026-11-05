# 直接原生导入画像

本文件定义全 Gift 作者工程所需的 `example:ripgrep-standard-rust@design-1` 的直接导入部分；它是可实现的案例合同，不是已安装 Reader、已生成 binding lock 或已完成的全工程 SourceProfile。旧 [PROFILES.md](../../PROFILES.md) 的混合产品根不进入这里。作者算法、共同借用操作及目标生成 helper 都不是本画像的原生应用输入。

## 已确定的普通公开接口

| 逻辑 ModuleView ID | 真实来源与选择 | 本例消费者 |
| --- | --- | --- |
| `rust:dependency:memchr` | 当前构建实例的 Cargo 解析图中，ignore 的 `memchr` 依赖发生点所绑定的 crate 根；当前固定 P 的 Cargo.lock 为 memchr 2.8.3 | `memchr.module.json` 直接转导真实 `memchr`、`memrchr` |

ModuleView ID 只提供稳定引用，不包含或证明版本、内容、feature 或实例身份。Reader 按以下次序形成视图：

1. 固定本次 P/Q 源版本、作者 Project、Cargo manifests/lock、host/target、features/cfg、工具链及实际依赖解析输入。用实际依赖发生点查原 Cargo 解析结果，不按 crate 名全局挑第一个包，不自己重做 semver 求解。
2. 对表内逻辑 ID 查到唯一来源实例；读取其已捕获声明/内容及真实前端模块图，保留导出终端、重导出、可见性、参数、类型、效果和借用。来源缺失、多个实例无法唯一对应、配置不匹配分别返回具体 Need 或歧义，不能从本机搜索路径补齐。
3. 沿原 `gift.binding-lock/1` 的发生点→node、内容与 dependencies 固定 ModuleUse。`imports.native.locked` 解析这个视图，沿普通 exports 转导真实公开成员；无需 native selection，也不生成同义 Rust 转发函数。
4. 每个调用点检查真实参数、结果、区域及表示。memchr 的 byte、借用 byte slice 和 `Option<usize>` 必须接到同一真实类型与构造器；现有 `Byte`、`Usize`、`Bytes` 门面仍未完成这一步，直接导入本身不签发调用合格。
5. 保存/再次编辑时作者仍修改普通 import 或 Gift 主体，派生锁和视图不能回写一份函数体。依赖、工具链、cfg、公开声明或选择发生点改变时使相交消费者失效；读取和解析不执行依赖构建脚本或取得安装权限。

memchr 是外部成熟 byte-search 库；保留它的实现与原 ripgrep 采用的依赖边界一致。此处不把 ripgrep 自有库划为外部供应者，也不使用手写 `native-support/memchr.rs`。原 selection 和 wrapper 的准确前像只保留在任务恢复材料中。

## 尚待闭合的接合

标准库来自真实工具链视图，不能占用 Gift 保留别名 `std`；选定后使用普通显式别名。公开固有成员的有类型 owner/member 选择尚需共同载体；任意公开名可以含 `::`，所以不能偷偷把普通 export 字符串改解释成目标语言路径。trait 方法继续走既有 `Expr.trait-method`，接收者、Self 与 witness 都不能被自由函数名替代。primitive、借用、tuple/array/slice、格式化构造及必要 helper 则由共同语义/合格 Target 负责。

机器、路径、格式、IO、时间、termcolor、serde 等门面仍有未退出的旧候选映射，尚未迁到本画像；不能因这里存在一个可直接导入的 crate 就称它们已绑定。完整工程还缺条件源码选择、crate/可见性与 coherence 装配、实际锁输出和目标配置。生产 Reader、类型/借用检查、Rust 生成编译及平台运行均未验证。
