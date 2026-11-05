# globset 作者草稿的范围与未完成接口

本目录中 `candidate.module.json`、`glob.module.json`、`set.module.json` 与 `fnv.module.json` 是 ripgrep 固定源码 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的有界 Gift 作者候选，原始检出位于 `.tmp/whole-engineering-20261025/ripgrep-source`。对照 Q `7155f6408d370e699795dc75e954635abfaf08a6` 时 `crates/globset` 子树无差异；这不证明工程其余路径或依赖锁相同。本候选不是已运行的 globset，也不证明上游全部公开接口或全工程等价。parser 和 regex 的范围、证据及剩余事项分别见 [SOURCE.md](SOURCE.md) 和 [REGEX-SOURCE.md](REGEX-SOURCE.md)。

| 上游对象 | 当前作者草稿 | 已表达的主要行为 |
| --- | --- | --- |
| `Candidate`、路径辅助与 `Candidate::new/from_bytes` | `candidate.module.json` | 路径规范化、basename/extension、前后缀视图和三个 Cow 字段的分别克隆；入口保留上游 `AsRef<Path>` 或 `AsRef<[u8]>` 的 `P: ?Sized`、借入源区域；Debug 候选调用 bstr 的 `ByteSlice::as_bstr`。真实 witness 与借入源区域、Cow 视图区域仍待核。 |
| `Glob`、`GlobBuilder`、`GlobMatcher`、`Error`、`escape` | `glob.module.json` | builder 五个开关、解析、matcher、错误及字符串辅助；已有 Glob 的 AsRef、PartialEq/Eq、Hash、Display、FromStr，Glob/Matcher/Builder 的 Clone，Matcher/Builder 的 Debug，以及 Error/ErrorKind 的 Clone、PartialEq/Eq 和 Error 的 Debug 候选。`GlobEqual` 和 Hash 只使用原字符串及上游五个 options；Debug、表示与资格仍有下列缺口。 |
| `GlobSet`、`GlobSetBuilder` 与七种策略 | `set.module.json` | `GlobSetNew<I,G>` 保持 `I: IntoIterator<Item=G>` 和 `G: AsRef<Glob>`，peek 首项、逐项 AsRef，builder 传入实际借用迭代器。集合字段为 `len` 与有序 `strats: Vec<GlobSetMatchStrategy>`；空集使用空 Vec，非空在构建首项前申请容量 7，按扩展名、basename、literal、suffix、prefix、required extension、regex 顺序立即插入并遍历。Aho 使用重叠匹配；输出先清空、再收集、稳定排序及去重。集合和各策略有 Clone/Debug 候选，但并不证明 tuple struct 或所有外部 witness 已闭合。 |
| `fnv::Hasher` 与其 HashMap 别名 | `fnv.module.json` | Gift 中实际的 FNV-1a 初值、逐字节异或及 u64 环绕乘法；Default 和 Hasher 的实现体及标准 `HashMap<K,V,BuildHasherDefault<FnvHasher>>`。标准能力和上游 `Hasher(u64)` tuple struct 的目标表示仍需见证。 |

`RequiredExtensionStrategy::matches_all` 在当前扩展名对应的桶存在时只检查该桶所有 regex；不同扩展名的桶不参与这次检查。固定上游的真实代码如此，即使概述性注释容易使人猜成检查全表。regex 集合草稿通过 pool get、clear、which-overlapping 取得 guard；`matches_into` 显式 put，其他路径按 guard 的实际 Drop 返回。Pool 身份与异常清理仍依真实外部绑定和目标检查，不由引用名称证明。

## 精确尚未关闭

1. 上游 `Glob` Debug 在 Formatter alternate 时输出 `Glob { glob, re, opts, tokens }`，否则输出 `Glob(original)`；当前缺该实现和 `Formatter::alternate` 接合。`ErrorKind` 的 Debug/Display、`Error` 的 Display 与 `std::error::Error::description`、`ErrorKind` 的 `#[non_exhaustive]` 公开边界尚未闭合。同名返回文本的辅助函数不是保留 Formatter 的 trait；候选的 `DebugForGlobMatcher` 和 `DebugForError` 也依赖真实 Debug witness。`GlobSet::empty` 的上游 `const fn` 资格尚未证明。
2. `serde1 = ["serde"]` 是非默认 feature。P 的 Glob 序列化调用 `serialize_str(self.glob())`；Glob visitor 的 `visit_str` 调用 `Glob::new` 并将错误交给 `serde::de::Error::custom`；GlobSet visitor 按次序 `next_element`、add，首次读取或编译错误即返回，最后 build 并映射错误。这些 trait、visitor、feature 条件及 Serializer/Deserializer、SeqAccess、关联类型和生命周期当前均未实现或绑定。
3. 独立 `arbitrary = ["dep:arbitrary"]` feature 为 `Glob`、`GlobOptions`、`Tokens`、`Token` 派生 Arbitrary；按字段和变体生成可能出现 builder 不产生的组合，不能换成 `Glob::new`。P 锁文件记录 `arbitrary`/`derive_arbitrary` 1.4.2、`serde`/`serde_core` 1.0.229；版本本身不证明实际导入。默认 `log` feature 的逐 regex debug 和构建统计尚未表达；`simd-accel` 是原清单中的弃用 no-op。
4. 四个上游 tuple struct 策略当前表达为名义 record 字段 `0`，`FnvHasher` 仍是命名字段 record；现行 carrier 接受 `0`，但目标 tuple struct 身份、布局和析构尚未证明。`RequiredPattern` / `RequiredRegex` 仍为 `{index,regex}` record，上游分别是 `(usize,String)` 和 `(usize,Regex)`；`DebugForRequiredRegex` 只是当前 carrier 的候选体，不能代替标准 tuple witness。应先核已有普通构造与目标表示，不因这一处自动要求新语法。`BuildState` 聚合与上游分开局部变量的错误和 Drop 次序仍缺证明。
5. 非空集合需要将 `machine:VectorWithCapacity<T>(usize) -> Vec<T>` 精确绑定真实 `Vec::<T>::with_capacity`；空集的 `VectorNew`、借用迭代 `VectorIterStart` / `IteratorNext`、拥有迭代 `VectorIntoIterStart`、`UsizeVectorSort` 的稳定 sort、HashMap/Hasher、tuple 投影、`Arc<Pool<PatternSet, Box<dyn Fn...>>>` 及 regex/Aho/bstr 依赖均须真实输入和 witness。`RequiredCompileBucket` 已改为消费拥有的 vector，按次序编译并在首错返回；`RequiredBuild` 外层 entry 仍通过 tuple 字段 take，真实析构与捕获/清理须核。
6. `pair.head` / `pair.tail` 和 suffix 策略中多次 `suffix.suffix` 读取仍需实际 MathInt/Sequence 表示与拥有权证明；普通 `Expr.field` 不自动移动非 Copy 载荷。Str/scalar/Sequence、`PartialEq<str>`、`ByteFromInt`、Copy/Clone/Drop、Formatter、源 `expect`/`unwrap`、异常、平台 cfg、日志和真实分配失败/清理还需相交消费者验证。
7. 关联根、native selection、借用区域、effect、源到目标 lowering、真正的上下游消费者、原库独立差分、运行与发布尚未证明。不能把本目录存在、有限用例或静态计数写成实际 ripgrep 功能完成。

## 本次有界检查

任务辅助 `wave2/globset-vector-check.py` 读取实际 AST，以模拟叶子检查空集、七类策略顺序与短路、clear/sort/dedup、容量及逐策略插入、required/regex 首错、拥有式 required bucket 编译顺序，并检查 Clone/Debug 源形状；`globset-set-structure-check.py` 检查普通函数作用域和独占借用位置。`globset-generic-api-check.py`、`globset-public-api-check.py` 和 `globset-error-traits-check.py` 分别检查泛型入口、有限 Hash 轨迹和 Error 值情况。它们均不是 Gift Reader、类型/借用/effect 检查器、目标或原库运行证据。旧 focused/control 脚本绑定七个 Option 的前像，现在会因载体变化失败，不能复用为新向量证据。

检查脚本、patch helper、生成的 patch 和改写后的预期 JSON 是本次任务的辅助文件，保留在 `.tmp/whole-engineering-20261025/wave2/`，不属于作者源或长期第二语言实现。
