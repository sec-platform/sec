# ripgrep printer 核心与行迭代作者源码

固定对照为 ripgrep commit `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`（P）。本目录只覆盖下表所列的源码切片，不表示完整 printer、searcher 或整工程已转换。七个模块含 67 个函数、7 个类型及 26 个 trait 实现定义；其中一些函数是保持组合与私有访问的内部辅助定义。实际 `extension:definition` trait 实现保存于 [traits.module.json](traits.module.json) 及条件 [serde.module.json](serde.module.json)；模块 export 是作者链接入口，不自动改变 P 的 Rust 可见性或证明 witness 已被生产编译器接纳。

| P 源与范围 | 作者模块 | 对应内容 |
| --- | --- | --- |
| `crates/printer/src/stats.rs`，SHA-256 `e3760c1a5cf842239311d5493a0e1553cdfeeb3dab6d06ad55d629132aacd632` | [stats.module.json](stats.module.json)、[serde.module.json](serde.module.json) | `Stats` 的构造、7 个 getter、7 个累加方法、owned/reference `Add` 和 `AddAssign`，以及 `Clone`/`Debug`/相等行为；feature 启用时的 `Serialize` 主体 |
| `crates/printer/src/counter.rs`，SHA-256 `94afcaf42fe66fe0202df715d64c679ddf64e4daE9788c6930221f5ad6cf5730` | [counter.module.json](counter.module.json) | `CounterWriter<W>` 的构造、读数、归零、所有权移动、`Write`、`WriteColor` 转发及 `Clone`/`Debug` 主体 |
| `crates/printer/src/util.rs:372-445`，整个文件 SHA-256 `ab791879d15b430d9585b5e00ce36d8142c870bdcfc209e0fb87b2e85439734f` | [duration.module.json](duration.module.json)、[decimal.module.json](decimal.module.json)、[serde.module.json](serde.module.json) | `NiceDuration` 的 Copy/Clone 值行为、计算、显示及条件序列化；`DecimalFormatter` 的定长十进制循环、切片和 Debug |
| `crates/searcher/src/lines.rs:16-107`，整个文件 SHA-256 `cb7426c19b5ad95ccc126bc687bee3c0a50ecc30c955145b5c736de1fa651414` | [lines.module.json](lines.module.json) | `LineIter`、`LineStep` 构造/推进及 Debug。`count`、`without_terminator`、`locate`、`preceding` 等后续函数不在本片 |

核心 trait 的 24 个实现按 P 的实际类型落源：`Stats` 的 Clone/Debug/Default/PartialEq/Eq 与四个 owned/reference Add/AddAssign；`NiceDuration` 的 Clone/Copy/Debug/Default/PartialEq/Eq/Display；`CounterWriter<W>` 在 W 满足对应 Clone、Debug、Write 或 WriteColor 约束时的实现；`DecimalFormatter`、`LineStep`、`LineIter<'b>` 的 Debug，以及 `LineIter` 的 `Iterator<Item=Borrow<ByteSlice,b>>`。方法主体调用各自唯一的已有 Gift 算法函数，保留参数、formatter 借用和泛型/区域；只给 P 的 `NiceDuration` 实现 Copy，不给 Stats 或 CounterWriter 增加 Copy。CounterWriter 的 Clone 约束和方法调用统一到共享 `machine:Clone`，不再依赖不存在的 `foundation:traits`。

条件模块另外写入 `SerializeForStats` 与 `SerializeForNiceDuration`：每个实现的 `serialize<S>` 原样使用 `S: Serializer`，接收 owned serializer，并委派同目录唯一序列化主体。P 的 `grep-printer` 默认 feature 包含 serde，关闭该 feature 时不可选择此模块。该选择需工程 SourceProfile 消费真实 Cargo features；模块 annotations 本身不执行条件选择。

## 保持的顺序与借用

- `Stats` 字段依 P 次序为 elapsed、searches、searches_with_match、bytes_searched、bytes_printed、matched_lines、matches。`AddAssign` 依序更改原 owner；检查溢出时已成功更新的前缀保留，后缀不更新。无符号加法仍须绑定原 Rust profile 的 checked/wrapping 选择。`Stats` 本身没有 Copy：`Clone` 从真实字段复制或 clone，不整值 `ReadCopy`。
- `CounterWriter::write` 先调用真实 writer，只有返回 `Ok(n)` 才累加 `n as u64`；writer 错误不更改计数，计数溢出发生在写入效果之后。`reset_count` 先 `total_count += count`，成功后才清零。`GetMut` 的 `BorrowFieldMut` 消耗父独占借用并返回同一区域的 writer 借用；`IntoInner` 用 `ConsumeField` 移出 writer，其他字段更新只使用短期 `WithFieldBorrowMut`。
- `NiceDuration` 先计算 `subsec_nanos as f64 / 1_000_000_000.0`，再加 `as_secs as f64`，然后以 6 位小数写入并写后缀 `s`。P 的零填充标志未指定宽度；这里输入是非负有限 duration，所需嵌套数值格式与 `write!(formatter, "{value:.precision$}")` 一致。`ToText` 要求标准 `format!("{}", value)` 的 Display 调用，不能先分别生成数值和后缀再拼接以改变拥有字符串的创建路径。
- 十进制写入把实际的 20 字节数组以短期独占借用交给 `ByteArraySet`；`n % 10` 使 byte 转换值域为 0–9。返回 slice 借用来自仍存活的 formatter 数组，不能通过临时数组或复制值替换。
- `LineIter` 保存原 bytes 借用区域 `b`，每次从当前独占 `LineIter` 短借 `stepper`，返回的切片仍属于 `b`。`LineStep::new` 的 P 注释声称 start 大于 end 时 panic，但实际构造没有检查；Next 先截取 `[..end]` 再截取 `[pos..]`，相应越界时序保持，成功范围包含终止符且非空。
- 六处 Debug 先创建实际 `DebugStruct`/`DebugTuple` builder；builder 保留 formatter 的独占区域 `f` 和 formatter 自己的 `data` 区域。每个 field/finish 操作通过 `WithBorrowMut` 短借同一个 builder。field 返回的 `&mut builder` 在回调内部丢弃，不逃逸或提前释放 formatter；字段名和次序与 derive 对应。最终必须使用标准 builder，保留 alternate/pretty 等 formatter 状态和错误累积。
- `StatsSerialize` 在 serializer 成功创建 state 后取得七个原始字段借用，按 P 顺序调用；`DurationSerialize` 依次借用实际 secs、nanos、human 临时值。每次独占 state 仅覆盖一次 `serialize_field`，遇到第一个 Err 即返回而不写后续字段或 end。条件模块及其两个 impl 必须只由 printer `serde` feature 选择；stats/duration 两个非条件模块没有导入 serde。`BorrowFields` 是内部链接辅助，必须保持原字段身份与 P 的私有可见性。

## 共享接口与尚未闭合的接合

这些是此源码的需求，不是供给已合格的证明。标准 trait 实现定义已经存在，但其他源、实际 feature 选择和 Target 消费仍必须闭合；不能把缺少的真实供给写成“只是尚未运行测试”。

1. 格式门面由共享 owner 装配真实类型与函数：`DebugStructBuilder<f,data>` / `DebugTupleBuilder<f,data>` 分别是 `std::fmt::DebugStruct<'f,'data>` / `DebugTuple<'f,'data>`；`DebugStruct` / `DebugTuple` 构造时保留该借用。`DebugField` 对应 `debug_struct_field`、`DebugFinish` 对应 `debug_struct_finish`，tuple 对应函数同理。field 的真实结果是同一个短借用，finish 接收短借用并返回 `fmt::Result`。名字相同不能让 type 与函数共用一个定义身份。
2. `WriteF64Fixed(formatter, f64, usize)` 与 `WriteText(formatter, str)` 分别对应 native-support 的窄标准格式操作；两者的 formatter 必须按调用短借并保留错误顺序。`DisplayToText<T: Display + ?Sized>(&T) -> String` 对应标准 `format!("{}", value)`；原生 `display_to_text` 与共享 `format:DisplayToText` 门面现在均有源码，`NiceDuration` 的 Display 实现也已由本目录写入，实际选择、coherence 与目标链接仍需消费这些对象。数值小数精度 6 来自作者主体，不应由实现固定为其他值。
3. **外部/共享源码缺口：** 当前工程尚无 ModuleId 为 `ripgrep:external:serde` 的作者或 native selection 模块，现有条件模块的 `Serialize`、`Serializer`、`SerializeStruct` 引用尚无法解析。需由共享 owner 基于锁定的 serde 1.0.229 真实 trait 声明及关联类型、`serialize_field<T: Serialize + ?Sized>`、静态字段名和 native 依赖创建唯一绑定；不得用只含这些方法的伪完整 serde trait 冒充外部库。`ripgrep:foundation:time`、`ripgrep:foundation:io`、`ripgrep:foundation:runtime`、`ripgrep:external:memchr`、`ripgrep:external:termcolor` 同样尚无对应模块/selection，需原共享 owner 补真实供给。`machine:Add` 和 `machine:AddAssign` 在本次核对的共享门面尚未导出；本目录四个操作符实现已写，但这些 trait 身份也尚未解析。以上为缺失源码/绑定，非单纯未执行测试。
4. 本片已给出上列 26 个 trait 实现，但它们仍须由真实 std/serde 声明和项目的 crate/feature 选择接纳；普通函数和同名方法不能代签 impl，这些作者定义也不能代签可见性、coherence 或 target 资格。
5. `Interval` 当前为结构化 `{start,end}`，P 的 `LineStep::next` 返回原生 `(usize,usize)`；目标表示关系与公共 API 必须恢复原 tuple，不能只因两值相同宣布 ABI 相同。`ByteSliceRange`、memchr、Duration、所有整数/overflow、数组与实际借用、分配和失败效果须由各自共享 owner、Reader/TypeChecker/Method/Target 证明。`LineIter` 字节保持零复制的资格也尚未获得。
6. SOURCE 检查点不是全工程完成：printer 的标准/JSON/summary/hyperlink/color 等，searcher 的其余行工具与调用方，以及 source profile、依赖选择和真实程序集成仍分别开放。本目录没有加入完整打印流水线。

## 本次定向证据及边界

针对当前七个模块运行任务内 structural sentinel：严格 JSON、重复键、LF/单末行、模块内及七模块间引用、局部变量/语义 binder、借用操作静态参数、唯一长独占字段投影和六处 builder 短借结构均通过。另对 24 个核心及两个 serde 实现核对 trait 名、已存在的算法主体、泛型 bound、formatter inout 和条件隔离；检查同时明确发现 machine 的 Add/AddAssign 导出缺失。该次只做本片结构检查，不重复根线程正在处理的 schema 图捕获；当前候选的 canonical schema 尚无本片合格结果。此前六模块快照的 schema 展开曾因 `place-operation.schema.json` 与 codec manifest 的内容修订不符而阻断，旧结果不能签发当前七模块通过。

任务内受限值模型运行了 1,213 个独立整数十进制期望、11 组 Stats 正常/溢出及前缀案例、20 组 Counter 状态/错误/转发观察、10 组 duration 数值/格式错误及相等案例、16 个 serde 顺序及首错案例、12 组行分割/越界观察和 6 个 Debug 字段组成检查；67 个函数均被有限案例调用。数值模型显式模拟 primitive 和 trait；Debug/serde/IO 的测试替身不是标准库、真实依赖或生产执行，Python 浮点格式也不证明 Rust 格式绑定。任务脚本和完整绑定结果位于 `.tmp/whole-engineering-20261025/printer-core/verify.py`、`result.json`、`audit.py`、`structural-result.json`、`traits-focused.py` 和 `traits-focused-result.json`，为本次辅助证据而非产品 compiler。

未运行真实 Gift Reader、生产类型/效果/借用/coherence、native 绑定、目标生成、Cargo 或端到端测试。共享供给、feature 选择和完整工程仍需按相应 owner 关闭；上述有限检查不证明生产实现或全输入等价。
