# ignore pathutil 的作者源与实例边界

本目录表达固定 ripgrep P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 `crates/ignore/src/pathutil.rs` 全部五个入口，以及 Q `7155f6408d370e699795dc75e954635abfaf08a6` 对 Unix `file_name` 的唯一实际算法差额。这里是 Gift 作者候选，不把原 Rust 的项目逻辑登记成 native supplier，也不声称 Reader、Target 或完整应用已经执行。

## 模块与源实例选择

`api.module.json` 是现有消费者的 `ripgrep:ignore:pathutil`；`common.module.json` 保留真实泛型入口、共有的 `is_hidden_path_only` 和对应引用。其余文件表示原 Rust 编译期条件。它们在不同源实例下共享真实 ModuleId，同一实例必须每组只发现一份；不能把所有变体同时放进同一 ModuleIndex，也不能在运行时比较 P/Q 版本字符串。

| 实际选择条件 | filename 模块 | strip 模块 | is-file-name 模块 | hidden 模块 |
| --- | --- | --- | --- | --- |
| Unix、P | `P/filename.module.json` | `unix/strip.module.json` | `unix/isfilename.module.json` | 按真实 windows cfg 选下述 hidden 分支 |
| Unix、Q | `Q/filename.module.json` | `unix/strip.module.json` | `unix/isfilename.module.json` | 按真实 windows cfg 选下述 hidden 分支 |
| 非 Unix、P 或 Q | `nonunix/filename.module.json` | `nonunix/strip.module.json` | `nonunix/isfilename.module.json` | 按真实 windows cfg 选下述 hidden 分支 |
| Windows | 沿实际 Unix 条件独立选择 | 沿实际 Unix 条件独立选择 | 沿实际 Unix 条件独立选择 | `windows/hidden.module.json` |
| 非 Windows | 沿实际 Unix 条件独立选择 | 沿实际 Unix 条件独立选择 | 沿实际 Unix 条件独立选择 | `nonwindows/hidden.module.json` |

P/Q 两个 filename 文件具有同一 ModuleId、相同的声明和导出，实际差额在 `FileNamePath` 函数体。它们只供不同实例的明确来源选择；旧 `models/P`、`models/Q` 和 `methods/P`、`methods/Q` 是历史模型/独立对照，不是本目录运行时供给。SourceProfile 及具体源文件发现／条件选择尚由工程根完成，不能仅凭目录名或表格推定它已生效。

## 原源码逐项对应

| 原函数及其内部条件 | 作者定义 | 精确行为与资源边界 |
| --- | --- | --- |
| `file_name<'a, P: AsRef<Path> + ?Sized>(&'a P) -> Option<&'a OsStr>` | `common:FileName`，再调选定的 `filename:FileNamePath` | 保留真实 `AsRef<Path>`、可 unsized 的 P、共享输入及返回区域；不将结果复制成拥有字符串。Unix 直接借用 `OsStrExt::as_bytes`、查末斜杠、返回同一存储上的 `OsStr::from_bytes` 视图。P 先保留原空输入、单点、末点和双点尾检查，再搜索斜杠；Q 先搜索末分量，仅排除恰为 `.` 或 `..` 的分量。路径以 `/` 结束时，非空路径仍可得到 `Some` 空视图。非 Unix 原样调用 `Path::file_name`。 |
| `strip_prefix<'a, P: AsRef<Path> + ?Sized>(&'a P, &'a Path) -> Option<&'a Path>` | `common:StripPrefix` 和选定 `strip:StripPrefixPath` | 两个实参及结果保留原共同 `'a`。Unix 先核字节长度，再将 prefix 与原路径前缀作字节相等比较；成功时从原路径对应偏移借用剩余 bytes，经 `OsStr::from_bytes` 和 `Path::new` 返回原存储视图。前缀无需是完整路径分量。非 Unix 调真实 `Path::strip_prefix`，将 `Ok` 变 Some、`Err` 变 None，并保留错误值的真实清理。 |
| `is_file_name<P: AsRef<Path>>(P) -> bool` | `common:IsFileName` 和选定 `isfilename:IsFileNamePath` | 按值接收隐含 Sized 的 P，短借用传给 `AsRef`，拥有值按原函数退出路径清理。Unix 在 `as_encoded_bytes` 上调用真实 `memchr(b'/')`、返回是否不存在；空输入为 true。非 Unix 读取 `Path::parent`，仅父路径存在且其 OsStr 为空时为 true。 |
| `is_hidden_path_only(&Path) -> bool` | `common:IsHiddenPathOnly` | 使用同一选定实例的 `FileName`，None 为 false；Some 使用 OsStr 原 `as_encoded_bytes` 的首字节判断是否为 `.`。单字节点的 `ByteSliceFirst` 和比较与原 `starts_with(b".")` 在每个字节切片上等价，不分配、不把路径转换为 Unicode。 |
| `is_hidden_path(&Path) -> bool` | `hidden:IsHiddenPath` | 非 Windows 直接调用 hidden-only。Windows 先执行 `Path::metadata`，成功后读取真实 `MetadataExt::file_attributes` 并传给锁定 `winapi_util::file::is_hidden`；结果为 true 就返回 true，错误或 false 才执行 hidden-only。元数据或错误载荷在回退前结束所属匹配作用域，仍由实际目标保证 Drop/效果顺序。 |
| `is_hidden_entry(&DirEntry) -> bool` | `hidden:IsHiddenEntry` | 非 Windows 直接由真实 `DirEntry::path()` 得到路径，再调用 hidden-only。Windows 先调用真实 `DirEntry::metadata()`（返回 `Result<Metadata, ignore::Error>`），属性为 hidden 时不调用 `path()`；错误或非 hidden 后才取得路径并回退。它不是替换成额外 `Path::metadata` 调用，遍历器已有缓存及错误行为须保留。 |

P 的原双点尾检查处于末字节为点的提前返回之后，实际不可达；作者体仍保留它的次序，并用长度保护后的逐字节比较表示同一双点比较。Q 的点和双点比较也以长度与受保护的字节读取表达；两者不引入新分配、Unicode 解码或 runtime 版本分支。各索引、借用、panic、无额外包装及实际编译结果仍须由真实 TypeChecker/Target 检查。

## 需要共享拥有者接合的真实能力

以下是本次作者使用点的待接合接口，不是本目录已定义的产品替身，也不是手写签名对 compiler 的覆盖：

当前 `machine`、`path`、`unix` 等引用只是定位所需语义；现有 `native-support` 中同名 Rust 包装不能因名称吻合就成为本作者源的供给或目标产物。协调 owner 须从真实标准库／外部依赖的原生声明、既有 Gift 构造和 Rust Target 降低中取得准确方法、泛型、借用与作用资格；找不到时保持明确缺口，不为本模块新造 Rust 包装。

| 引用 | 真实来源与所需关系 |
| --- | --- |
| `path:OsStrAsEncodedBytes` | `std::ffi::OsStr::as_encoded_bytes(&self) -> &[u8]`，结果借用 OsStr；不得统一换成 lossy bytes。 |
| `path:FileName` | `std::path::Path::file_name(&self) -> Option<&OsStr>`，仅非 Unix 文件名变体消费。 |
| `path:StripPrefix` | `Path::strip_prefix<P: AsRef<Path>>(&self, base: P) -> Result<&Path, StripPrefixError>`，在此实际 P 为 `&Path`；结果区域来自 self。 |
| `path:PathFromOsStr` | `Path::new(OsStr)` 的真实标准借用关系：`&OsStr -> &Path`，不得重新分配或转文本。 |
| `machine:ByteSliceEqual` | Rust `[u8]` 的真实 `PartialEq` 比较：`(&[u8], &[u8]) -> bool`，用于 Unix 原始前缀比较。 |
| `machine:U32AsU64` | Rust `u32 as u64`，无损并保持原 Windows 属性处理值。 |
| `memchr:Memchr`、`memchr:Memrchr` | 原 `memchr` 2.8.3 的真实 `(u8, &[u8]) -> Option<usize>`；前者找首匹配、后者找末匹配，索引相对输入。 |
| `fs:Metadata`、`fs:PathMetadata`、`windows:MetadataFileAttributes` | 标准 `std::fs::Metadata`、`Path::metadata -> Result<Metadata, std::io::Error>`，Windows 上 `MetadataExt::file_attributes(&Metadata) -> u32`。真实 OS 查询与文件类型/符号链接行为不可用布尔包装取代。 |
| `winapi:IsHidden` | 原锁定 `winapi-util` 0.1.11 的 `file::is_hidden(u64) -> bool`；只消费属性，不重新实现成 ignore 产品函数。 |
| `walk:DirEntry`、`walk:DirEntryPath`、`walk:DirEntryMetadata` | ignore 自有 `walk::DirEntry` 的真实类型与方法；`path(&self) -> &Path` 借用 entry，`metadata(&self) -> Result<Metadata, ignore::Error>`；不能改接外部 `walkdir::DirEntry` 或独立 filesystem 查询。 |

现有 ignore-rules 草稿调用 `pathutil:StripPrefixText`，而原接口是 `StripPrefix<P: AsRef<Path> + ?Sized>`。这里不新增按值 Text 的同义产品 helper：上游 `"./"` 和 `"/"` 应以实际静态 `&str` 借用进入原泛型调用，不能从局部拥有字符串构造越过其销毁的返回借用。该消费者改接、StaticStr、SourceProfile 的选择，以及本目录与其余 walk/types/incremental 的真实连通由协调 owner 完成。

`IsFileName` 为拥有的泛型 P 建立短借用目前使用共同 `WithBorrow` 表达；其 callback 有受限 noescape 合同，而原公开 `P: AsRef<Path>` 不声明 `AsRef` 实现是纯的或不泄漏。因此真实 TypeChecker 必须证明这一调用对所有原本合法的 `AsRef` 实现不增加前提；如果不能证明，应由共同借用/调用 owner 恢复原 Rust 按值与借用表达，而不能把 P 的合法实现排除在外。有限 mock 不证明该开放泛型资格。

## 有界核对与证据边界

`.tmp/whole-engineering-20261025/wave2/pathutil-oracle.rs` 使用现有锁定 memchr rlib 编译，执行 [P 方法](../../methods/P/path_policy.rs)与 [Q 方法](../../methods/Q/path_policy.rs)；这两份方法分别对应已读取的真实 P/Q 源算法。`pathutil-focused.py` 直接读取本目录实际 Expr，使用独立 Rust 方法输出对比 1,365 个由 `.`、`/`、`a`、`0xff` 组成、长度至五的输入，检查 P/Q 的 None/Some、视图原存储和偏移、隐藏判定及 Unix filename 判定；另外比较 7,225 对短 Unix 字节前缀。它也用模拟的非 Unix Path 方法和 Windows 元数据结果检查分支、调用先后与失败回退，合计 **20,623 个有界断言**。测试涉及自己的 evaluator 及 native 叶子 mock，不是生产 Gift 解释器或全域证明，不能外推实际 Windows/Unix 文件系统、Borrow/Drop、target 或性能。

源码严格 JSON、候选模块身份、局部引用、P/Q 声明一致和 `AsRef`/Sized 泛型头也在该 focused 脚本检查；未运行完整 schema capture、完整 Rust 测试或外部 CI。此项核验中的 `pathutil-oracle.rs` 是用户最新限制到达前创建的临时测试驱动，仅调用既有 P/Q 对照方法，不是 native 产品包装；它与 exe、辅助构建脚本、focused 脚本保留在 `.tmp/whole-engineering-20261025/wave2/`，不是产品作者源。实际 compiler 输入闭包、P/Q 实例选择、外部依赖绑定、静态检查、真实跨平台运行、消费者接线及整体工程保持均仍须各自证据。
