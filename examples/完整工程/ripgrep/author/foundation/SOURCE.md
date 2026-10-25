# 共享基础与 FNV 作者源码

本页的FNV算法源是`fnv.gift`，使用[既有计算文本词法与文法](../../../../../docs/领域/计算基础/文法类型与求值.md)，不把Rust源码包成字符串或新DSL。其模块逻辑身份为`ripgrep:globset:fnv`；文件定位与此身份的SourceProfile绑定尚未接入最终工程，不能按文件存在自报已链接。另有[共享文本转换源码](text/SOURCE.md)供glob渲染消费，其准确有限范围单独说明。当前全工程源仍进行中。

## FNV 已写主体与准确映射

上游P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的`crates/globset/src/fnv.rs`拥有Hasher和HashMap类型别名。Gift主体完整给出三个常量、初始状态、finish和逐字节write；`XorBits`与`ByteDomain`为显式共享语言算法，没有假设`std:UIntXor`存在。类型`Hasher`隐藏表示；外部只能由Default/Write取得值，因此其state始终在0..2^64−1。`Write`的实际使用域是有限0..255字节序列，ByteDomain不会把Rust不可能的u8值域扩展成原接口的新行为。

FNV每步先按位异或，再乘1099511628211并模2^64。XorBits每轮观察两个非负整数的最低位、右移一位并减少remaining；恰64轮给出完整u64异或。WriteState逐次缩短有限序列，维持state合法域；空write原状态不变，分段Write与拼接Write一致。数学乘法后模2^64与原wrapping_mul普通值一致，不能改成checked乘法或饱和。Finish没有再hash或增加随机种子。

目标责任仍开放：原`Hasher::write(&mut self, &[u8])`就地更新状态；Gift模型返回新Hasher值。Rust Target须把这一状态转移绑定到唯一原Hasher实例的可写位置，保持调用顺序、u64返回与std::hash::Hasher接口，不能偷偷更换HashMap种子或键相等关系。原HashMap<K,V>仍需映射到外部std集合及BuildHasherDefault；这条类型/trait接合未完成，不能把整个fnv.rs或globset标记迁移完成。生成选择应使用已证明的u64异或/回绕乘法与循环，不能把数学Int递归直接称作已保持原成本。

当前是完整纯算法设计与结构论证。基础`.gift`生产解析、类型/效果、目标降低、ABI/trait、零分配及运行性能均未执行；本文件不提供这些资格。

std::hash::Hasher 的默认 `write_u* / write_usize`、Hash 调用分段及目标字节序也属于实际使用点合同；逐字节fold保持不能代签全部键类型的hash布局。必须保留同一写入协议，不能以分段可合并为由改变外部Hash输入或其字节序。

## 共用机器与路径边界的未闭合接口

以下模块是全工程必须由同一owner闭合的依赖，当前尚无可冒称已安装的实现或完整作者文件：

| 模块 | 已有真实消费者与所需语义 | 原生保留理由与限制 |
| --- | --- | --- |
| `ripgrep:foundation:machine` | Matcher/flags/command的Usize、U64、Byte；常量UsizeZero/UsizeOne与ByteZero/ByteOne/ByteTwo；准确比较、checked算术、位运算及字节借用 | Rust目标的机器宽度、原语操作、借用与ABI须由实际工具链/Target解释。不能写死Usize=u64，也不能把Math Int上的运算偷偷扩到所有定宽类型。仅基础原语可有native供给，Matcher/FNV/业务算法不可隐藏其中 |
| `ripgrep:foundation:path` | OsString/PathBuf、原生编码、借用ToUtf8及准确路径组成 | Unix任意bytes与Windows路径表示无法统一成无损Text；保留平台表示原语，所有项目选择、筛选、规范化和错误政策仍须有Gift主体 |
| `ripgrep:foundation:text`及字节方法 | `text/conversions.module.json`已提供标量到UTF-8、ASCII单字符和两位hex；仍须补glob Text入口、ignore名称分类/排序、trim及真实借用/owned转换 | 可选择实际已锁定标准库/数据表；算法与适用域须明确，不允许把整个glob parser或Types包装成一个native函数 |

这些接口尚待作者声明、内容身份、具体供给和Target使用点一起闭合。当前各模块SOURCE内的精确签名需求是待整合输入，不是第二个已生效的函数注册表。遇到同义需求应合并到这里的真实模块，不能各片再建Args/Effects/Supply回调海。
