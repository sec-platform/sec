# grep-matcher 的开放 trait、默认算法与共享借用转发

本片在 [traits.module.json](traits.module.json) 与 [matcher-defaults.module.json](matcher-defaults.module.json) 写入固定 P `crates/matcher/src/lib.rs` 的 Captures/Matcher 结构候选、Matcher 默认主体、`Captures for NoCaptures` 和 `Matcher for &M`，不把整段搜索/替换藏入原生供应。公开回调按真实 F 类型参数及高秩 FnMut 约束表达；这是作者设计源码，实际类型器、trait witness、目标绑定、Rust 公开导出和生产运行尚未取得验证。

来源为 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`，`crates/matcher/src/lib.rs` 的 SHA-256 为 `56212862323457b60a008e8c45f92b2fc3d8590cb82d6d68dc0d31ac6ad97906`。P→Q `7155f6408d370e699795dc75e954635abfaf08a6` 的 matcher 源无差分；同一作者片适用于两检查点，P/Q 不参与运行分派。已有值层、Captures 三个默认算法及插值扫描分别继续由 [SOURCE.md](SOURCE.md)、[captures-defaults.module.json](captures-defaults.module.json) 和 [INTERPOLATION-SOURCE.md](INTERPOLATION-SOURCE.md) 指定的唯一源码承担，本片没有复制其算法。

## 源身份与实际结构

| 文件 / ModuleId | 实际内容 |
|---|---|
| `traits.module.json` / `ripgrep:matcher:traits` | 4 个 extension 定义：Captures、Matcher 两个声明；CapturesForNoCaptures、MatcherForBorrow 两个实现。Captures 5 个方法中 2 个 required、3 个 default；Matcher 25 个方法中 2 个 required、23 个 default；两个实现分别有 2、25 个真实覆盖主体 |
| `matcher-defaults.module.json` / `ripgrep:matcher:defaults` | 23 个 Matcher 默认算法函数、6 个私有 helper、1 个私有 IterationStep 类型；只导出 23 个被声明消费的默认函数 |

专业声明的载体是 `extension:definition`，`bodySchemaRef=urn:gift:design-schema:first-layer-trait-body`、`bindingRef=sem:InterpretTrait`；dialect 为 `gift.semantic-convergence` 的 `design-semantic-boundaries` 设计供给。Type.associated、Expr.trait-method 和 TypeParam.traitBounds 均沿当前候选的共同结构，未新造字段或复用端口 perform。准确语义 owner 是[开放 trait 结构画像](../../../../../docs/领域/计算基础/作者表示与实现分工.md#structured-trait-profile)；设计供给没有被冒充已安装解释器或已合格 witness。

trait 的 defaultBody 只接一个普通默认函数，实际算法只保存一次。默认函数用受约束的 M 和准确关联投影编写，所有原 `self.method(...)` 都通过 `Expr.trait-method` 选择同一个实现 witness 的对应方法，不能固定改成调用另一个 Default 函数。模块之间形成声明依赖环，按[模块 owner](../../../../../docs/作者/组合/模块封装与复用库.md)先收集签名；没有值初始化环或运行注册服务。公开 Rust 路径仍须恢复 `grep_matcher::{Captures,Matcher}`，不能把本片模块 export 自动扩成新的 crate 公开 helper 集合。

## Captures、关联类型与实现

`Captures` 对应 P 379–459：`len(&self)->usize`、`get(&self,usize)->Option<Match>` 必须由实现提供；as_match、is_empty、interpolate 分别接既有三个 Captures 默认算法。接合处的小 lambda 只形成同一个真实 trait witness 的 get/len callable，调用者不需要额外传一张供应表。as_match 仍调用 get(0) 并保留 unwrap panic；is_empty 仍恰调用一次 len；interpolate 保留名字回调、同一 haystack/replacement/dst 及既有插值规则。覆盖 get/len 后，默认算法必须观察覆盖；覆盖整个默认方法时不再执行默认主体。

`CapturesForNoCaptures` 对应 P 479–488，只覆盖 len/get，分别调用值层真实 NoCapturesLen/NoCapturesGet；另外三个方法由声明默认规则选择。没有凭空创建一个捕获容器构造要求，new_captures 的责任仍属于 Matcher。

`Matcher` 对应 P 546–1131：Self 与 method 参数独立。关联类型 Captures 约束为准确 Captures trait 加原 Rust 隐含 Sized；Error 约束为真实 `std::fmt::Display` 加 Sized。Error 没有被加强为 std::error::Error、Clone、Copy 或 Send。关联投影以同一个 Matcher 身份、Self 与成员确定；不能按字符串 Error/Captures 混同来自其他 trait 的类型。

Rust trait 的 Self 没有被默认加强为 Sized；实际 `impl<'a,M:Matcher> Matcher for &'a M` 的 M 则保留其原隐含 Sized。原回调 F 是按值传入的有大小 FnMut 值；公开声明、默认函数与转发现在各自声明 F，并约束真实 Sized、FnMut<Args> 和同一 F/Args 上 FnOnce 的 Output 等式。单参数用真实 Tuple1，双参数用真实 Pair；结果仍为原 Bool 或 Result<Bool,E>。合法覆盖可以观察 `size_of::<F>()` 或 `type_name::<F>()`，因此不能以结构箭头、函数指针、dyn 或装箱值替换实际 F；可失败回调的 E 仍显式保留 Sized。这些是公开回调仍须保持的观察。旧候选的高秩结构增量已撤回，当前接合回到[既有开放 trait owner](../../../../../docs/领域/计算基础/作者表示与实现分工.md#structured-trait-profile)与真实 Rust compiler；本页旧主体不因保存而继续取得已撤回的解释资格。

借用回调使用共同 TraitBound 的局部全称 Region，例如 `for<'r> F: FnMut(&'r Captures)`；同时借 captures 与 dst 的约束具有两个独立 Region。FnMut 和 FnOnce/Output 两条约束各自卫生绑定相应区域，不能将它们抬成调用者指定的单次区域或把回调环境写成额外公开生命周期。真正闭包类型及其捕获由实际 witness 给出，不能凭源码字段声称该 witness 已取得资格。

P 的开放 trait 没有对参数承诺一律 `noescape`：合法覆盖可保留普通值或派生地址，按值 F 也可以在真实类型和寿命允许时被保留或以 `mem::forget` 泄漏。高秩回调可以安全地 `mem::forget(Box::new(borrow))`，但这不使借用在原区域之后可合法使用；生命周期约束和不留存保证是不同事实。公开声明、`&M` 转发和默认入口不再给参数附加无依据的普遍不留存保证。具体默认体的局部行为另判：直接迭代默认体在自己的激活内调用 F，正常返回或展开时按原目标清理拥有的 F，abort 按原目标退出；四个非 move 适配器仍只借用其外层位置。调用被覆盖方法时须按该方法实际合同及捕获寿命检查。

`find_iter_at`、`captures_iter_at`、`replace` 和 `replace_with_captures_at` 的原非 move 适配闭包只借用外层 `mut matched/append`。四个对应默认函数先把按值取得的原回调移到本激活内唯一的 `var matchedCallback/appendCallback`，适配 lambda 按[存储寿命 owner](../../../../../docs/领域/对象与控制/控制流与存储寿命.md#名字存储与资源的寿命不是同一条线)捕获该位置；不会把回调值移入可由被覆盖方法提前丢弃的适配器。两个 `try_*_iter_at` 同样将按值回调移入自身可变位置，再将这个位置以 inout 交给逐次处理 helper；普通不可变参数本身不能充当这个可变位置。覆盖方法即使先丢弃适配器再观察 DropFlag，原回调也仍由外层默认函数保有。布尔路径的外层 Err、内层 unwrap 与其 Fault/展开，以及替换路径的成功后缀、Err 和 Fault 均先完成各自原出口计算，再沿原目标 cleanup 处理原回调；不新增 Clone/Copy、装箱、共享服务或更早的析构点。

两个替换实现还在外层持有 `var destinationBorrow`；迭代适配器按位置捕获此独占借用，结束后同一位置用于追加后缀，不能按值捕获并消耗原借用。这里要求类型器和目标证明 `inout destination` 的本地借用资格、适配器期间的独占访问以及调用结束后的恢复；尚未取得该运行证据。

`MatcherForBorrow` 对应 P 1133–1381，准确 Self 为 `Borrow<M,referentRegion>`。方法 receiver 是外层 `Borrow<Borrow<M,referentRegion>,selfRegion>`；ReadCopy 只读取可复制的内部共享借用，绝不复制 M、捕获对象或带 Drop 的记录。全部 25 个方法逐项转发至 M 的对应方法，包括原默认方法和所有捕获/替换/迭代方法，不能只实现 required 两个方法然后重新落到 `&M` 的默认主体。两个关联类型直接投影自 M；non_matching_bytes 的返回借用仍受实际 receiver 寿命约束，内部较长借用只能在合格 outlives 条件下弱化。

## Matcher 的全部方法映射

下列行号均指固定 P 的 lib.rs；每个 default 入口在源码中均有实际主体。

| 原方法 / P 行 | 主体与必须保持的调用 |
|---|---|
| find_at 571–575、new_captures 583 | required，没有伪造默认结果或原生整算法供应 |
| capture_count 597–599 | 返回 Usize 0，不访问捕获容器 |
| capture_index 611–613 | 返回 None，不自行解释名字 |
| find 621–623 | 调用该 witness 的 find_at(haystack,0) |
| find_iter 629–638 | 调用 find_iter_at(haystack,0,matched) |
| find_iter_at 648–659 | 给 try_find_iter_at 传 `m→Ok(matched(m))`；外层 Err 原样传播，内层 Result<Unit,Unit> 仍 unwrap |
| try_find_iter 669–678 | 调用 try_find_iter_at(haystack,0,matched)，保留两层 Result |
| try_find_iter_at 692–732 | last_end/last_match 循环；原 find_at 分派、空匹配推进与相邻空匹配过滤；回调 false/Err 分别停止 |
| captures 740–746 | 调用 captures_at(haystack,0,caps) |
| captures_iter 753–763 | 调用 captures_iter_at(haystack,0,caps,matched) |
| captures_iter_at 774–786 | 给 try_captures_iter_at 传 `caps→Ok(matched(caps))`；保留 Unit 错误的 unwrap |
| try_captures_iter 796–806 | 调用 try_captures_iter_at(haystack,0,caps,matched) |
| try_captures_iter_at 820–861 | 原 captures_at 分派；成功后实际 get(0).unwrap；与 find 路径相同的空匹配控制，回调接收同一个 captures 的短共享借用 |
| captures_at 887–894 | 默认 Ok(false)，不调用 find_at，不创建/修改 captures |
| replace 902–919 | 调用 find_iter；每次先追加未匹配前缀，再更新 last_match，再调用 append；成功迭代结束后追加后缀 |
| replace_with_captures 926–937 | 调用 replace_with_captures_at(haystack,0,caps,dst,append) |
| replace_with_captures_at 948–968 | last_match=at；调用 captures_iter_at；回调内另一次 get(0).unwrap、追加前缀、更新位置、append；成功后追加后缀 |
| is_match 974–976 | 调用 is_match_at(haystack,0) |
| is_match_at 987–993 | 调用 shortest_match_at 并将 Option 映成 Bool；不改为 find_at |
| shortest_match 1010–1015 | 调用 shortest_match_at(haystack,0) |
| shortest_match_at 1036–1042 | 调用 find_at，None 不变，Some 映成 Match.end |
| non_matching_bytes 1065–1067 | 默认 None；覆盖方法可返回真实借用 ByteSet |
| line_terminator 1082–1084 | 默认 None，不增加平台终止符默认 |
| find_candidate_line 1125–1130 | 调用 shortest_match，Some 映为 Confirmed；不返回 Candidate、不偷偷验证一次 find |

6 个私有 helper 只有 UnwrapUnitResult、MatchStartValue、MatchEndValue、CapturesGetZero、ProcessFoundMatch、ProcessCapturedMatch。前两个 Match 字段读取 helper 通过真实受限借用调用值层 getter，不越过 opaque 表示权；GetZero 恰调用 trait.get(0)，不能改成可能被覆盖的 as_match。两个 Process helper 是循环内控制分解，IterationStep 只是当前激活内的返回记录，不是持久状态、调度器或接口表。

## 循环、错误层和可观察顺序

初始 last_end=at、last_match=None。只有 last_end>haystack.len() 才先返回成功；等于长度仍允许末尾空匹配。搜索错误返回外层 `Err(MatcherError)`；无匹配返回 `Ok(Ok(Unit))`。对空 Match，先计算 end+1，再检查 Some(end)==last_match；相同则跳过回调并保留原 last_match。非空 Match 将下次起点设为 end。接受的 Match 把 last_match 更新为 Some(end)，然后才执行回调：Ok(true) 继续，Ok(false) 成功停止，Err(e) 返回 `Ok(Err(e))`。

推进单位是一个**字节**，不是 Unicode 标量或码点。正常且满足 Matcher 范围合同的有限输入，在被调用方法和回调正常返回时能够推进；任意恶意/错误覆盖方法可以破坏进度或产生范围外 Match，因此本片明确声明 partial，不声称任意下游实现都终止。UsizeAdd 必须消费原 target/profile 的 `usize + 1` 规则；对于不满足原方法合同的 `end=usize::MAX`，不能把原 debug/release 的溢出差异擅自改为永远 checked、饱和或无条件正常结束。

Process helper 在不可被外部回调访问的局部记录中计算 nextEnd/nextMatch，再在回调正常继续后提交到外层两个普通整数槽。原槽没有用户 Drop 或别名观察，回调不捕获这些槽，因此该控制分解不改变业务观察。两个 try 迭代函数在 step.done 出口调用 `ConsumeField<IterationStep<M::Error,E>,"result">(step)`，消费完整拥有的局部 step 后移动其结果字段；其余 Bool/Usize/Option<Usize> 字段按真实聚合清理见证结算，不使用只允许可复制/共享 payload 的普通 Expr.field 读取泛型错误，也不增加 E/M::Error 的 Copy 或 Clone 约束。替换回调中的 last_match 则是实际被闭包捕获的可变位置，源码恰在 append 前 set，不能套用前述局部不可观察条件延后。

`try_*` 的源码注释称搜索错误转换为 E，但真实签名和 `?` 明确将它保留在外层 Self::Error。本片依真实主体保留 `Result<Result<Unit,E>,Self::Error>`，没有照错误注释扁平化。布尔适配的 unwrap 也不能因默认 wrapper 只产生 Ok 就删除：下游覆盖的 try_find_iter_at/try_captures_iter_at 可以直接返回 `Ok(Err(()))`，此时原布尔方法会 panic。UnwrapUnitResult 保留 ``called `Result::unwrap()` on an `Err` value: ()`` 消息；CapturesGetZero 保留 Option::unwrap 的 None panic，均走 Target Fault/panic 责任，不变成业务 Err。

captures_at 返回 false 时，不读取或重置 caps；其内容原本 unspecified。成功时循环实际读取 get(0)，缺失则 panic。默认 replace_with_captures_at 路径中，迭代控制读取一次 get(0)，替换回调又读取一次；get 允许合法 interior mutation，因此两次调用不能合并或把第一次 Match 缓存给第二次。二者都通过同一个 Captures witness 分派。

replace 的 append 收到同一个 dst 和当前 Match；captures 版本的 append 收到同一个 captures 的短共享借用与同一 dst。每轮先追加 `[last_match..start]`，然后记录 end，再调用 append；append 返回 false 后仍追加从该 end 开始的剩余后缀。搜索返回外层 Err 时不执行最终后缀追加，但已发生的前缀/append 写入保留。append panic、分配失败、用户 Drop 和 unwinding/abort 仍按原运行行为结算，不回滚。`replace_with_captures_at` 从 at 开始，初始不复制 `[0..at]`；at 超过长度时，默认迭代可以无调用地成功返回，但最终切片仍会按原范围检查失败，不能一并改成无事发生。

所有切片使用原 haystack 与半开范围，绝不截成 haystack[at..] 后改变绝对偏移或锚点上下文。默认算法不创建新 captures，不隐式 new_captures，也不做字符串解码。

## 借用和效果的准确共享边界

普通共享身份仍是 `ripgrep:foundation:machine`。以下为实际额外需求及相交旧需求，不是假定已经存在的安装或资格。

| 共享导出 | 精确用途与约束 |
|---|---|
| Sized、Display | 真实 Rust `Sized`、`std::fmt::Display` 的 trait 身份及签名；只用于准确约束/关联解，不用同名端口模拟 |
| WithBorrow | 对调用者本地拥有值的真实 Place 建立共享借用，在由合格 Method 引入的新 Region 中调用同步、不保留的 callback；结果不得含该新 Region。本片仅从本地 Match 读取 Usize；不得用普通按值传参借出临时地址，也不接受调用者任填长寿命 r |
| 调用中的共享重借 | `get` 与用户 FnMut 的形参要求共享借用时，直接以 `captures` 为实参，由共同调用合同检查从父独占借用形成短共享 reborrow；调用期间禁止父位置独占访问，最后一次合法使用后恢复。该关系不附加 callback noescape，也不增加手写原生 helper；真实 Region、重借与目标资格仍待验证 |
| ConsumeField | 以完整 `R,N` 选择 IterationStep 的 result 字段并消费其拥有值；没有整体自定义析构/活借用/固定地址禁移义务，保留非 Copy 错误的唯一移动和剩余字段清理 |
| BorrowField | 值层 LineTerminatorAsBytes 用完整 `R,N,r`，其中 N 为真实 byte 字段，结果 payload 从字段推导；不再额外传一个可与真实字段分歧的 T |
| ReadCopy | 此处仅 `<Borrow<M,a>,s>(Borrow<Borrow<M,a>,s>)->Borrow<M,a>`，读取内部共享引用，保持原指向与寿命；不复制 M 或任意不可复制记录 |
| Usize / UsizeFromByte / UsizeEqual / UsizeLessEqual / UsizeAdd | 准确 target_pointer_width；转换仅 0/1；比较无符号；Add 保留实际 Rust profile 溢出行为，不能使用数学 Int 或硬编码 u64 |
| ByteSliceLength / ByteSliceRange / ByteVectorExtend | 同一原生 `[u8]`、`Vec<u8>` 身份；字节长度、半开范围与原生越界失败、原对象顺序追加及 alloc/OOM |
| Borrow / BorrowMut / ByteSlice / Str / ByteVector / Panic | 与既有值/捕获/插值层完全相同身份；保留 unsized、outlives、短独占重借、别名和目标 panic/unwind/abort/cleanup |

MatchStartValue/MatchEndValue 的 WithBorrow 返回纯机器整数，其具体 adapter 只调用本模块的字段读取，不对开放用户函数声称 noescape。WithBorrow 的完整静态头为 `T,U,Fx`，调用省略整个 semanticArguments，请求唯一推导完整静态参数；其原生供应选择仍由共同 owner 按用户限定重新接合，不能以手写 Rust helper 冒充 Gift 目标能力。两个 capture 路径直接将 `captures` 传给 CapturesGetZero 和用户 matched，消费共同调用规则的合法短共享重借；不把开放函数包装成要求 callback noescape 的 WithSharedBorrow，也不新增手写 Rust helper 依赖。开放 F 的捕获从真实类型推导，参数域则由 bound 局部 name/capture/write Region 量化；这不是对用户回调本身或其输入添加 noescape。Region 拼写不是生命周期证据；实际短重借、别名排斥和类型推导仍需真实 compiler/类型器验证，不能静态选取父借用的长期区域或复制独占借用。

旧候选曾使用十个非 raise class 的保守上界，并把 selector 省略解释为静态不限。该新增解释及其绑定已撤回；本页保留其历史记录，不能继续据此声称未知回调已经完成分类、纯度或目标接合。既有[效果合同](../../../../../docs/领域/计算基础/文法类型与求值.md)仍要求真实作用、调用效果与声明上界相符；未知或不可分类的导入保留准确 Need。公开 API 中具体 F 的身份、捕获、Drop 和调用关系仍须保持，不能为补缺口另加伪 Fx 参数；Rust panic 继续归 Fault/Target。

默认普通函数的 effects 省略后由完整主体推导，再检查不超过 trait 声明上界。原普通 Rust FnMut 可以有 interior mutation、I/O 或 panic，所以没有将 &self 或 callback 错误地声明为空效果。所有声明为 partial；无副作用、正常终止、runtime authority 及运行成功分别判断。

## 逐项审查与剩余义务

前一源码修订的有界哨兵检查了五个 matcher 模块的严格 JSON、LF 和单终止换行，以及所修回调位置、错误字段移动、错误分支、unwrap 和替换前后缀的指定结构；检查次数包含逐键重复性检查，不是同等数量的独立行为测试。那次共同 codec graph 因 `schema/author/first-layer/place-operation.schema.json` 的内容修订与清单不匹配而拒绝展开，后续 Schema 检查没有运行。检查记录保留在 `.tmp/whole-engineering-20261025/wave2/matcher-audit-result.json`，绑定的是此前源码和共享输入，不能自动延续到本次修订。本次针对回调留存合同做有界结构核验；最终 codec、Schema、类型和目标资格仍按实际冻结输入取得。下列期望来自固定 P 的分支与调用关系，尚未计为已执行 Gift 向量：

上一轮对两个模块做严格 JSON 与精确逆向前像核验：恢复 34 个按值回调位置的原 `noescape` 后，文件哈希分别回到当时前像。另以现成 `grep_matcher` rlib 编译了包含 `size_of::<F>()`、`type_name::<F>()` 和 `mem::forget(F)` 的覆盖实现；这是 Rust 接口反例，不是 Gift 类型或运行证据。本轮回调迁移的有界哨兵覆盖 43 个 F/A/N 泛型的 Tuple1/Pair、FnMut、FnOnce/Output、局部 Region 与公开参数留存结构；正常化比较保留原主体，除插值 A/N 新增可变位置、两个 capture 短重借和必要静态实参更新外无算法主体变化。检查项含 JSON 逐键核验，不是等量的行为测试；生产 witness、类型、目标及运行仍未验证。

- 覆盖 find_at、find_iter_at、try_find_iter_at、captures_at、captures_iter_at、shortest_match_at、shortest_match 后，相关默认方法和 `&M` 的实际分派必须命中覆盖，不能退回默认实现；NoCaptures 使用声明默认的三个方法。
- at>len 不执行搜索；at==len 仍可产生末尾空匹配；连续空匹配按字节前进；紧随已接受 Match 的相同 end 空匹配被跳过。非空 `[0,2]` 后的空 `[2,2]` 不调用 matched，下一次起点为 3。
- 搜索错误仅外层 Err；回调错误仅 Ok(Err(e))；false 是 Ok(Ok(Unit))；覆盖 try_* 直接给 Ok(Err(Unit)) 时，布尔 wrapper 仍 panic。错误值和闭包不被额外 Clone。
- 覆盖实现以 `mem::forget(F)` 泄漏按值回调，或依据真实 `F` 的大小/类型名选择结果时，公开声明与转发仍须容许并保持原行为；源码已表达泛型 F 和约束，真实 witness 和目标证据仍需取得。
- E 和 M::Error 可以是带唯一 Drop 责任的非 Copy 值：两处 step.done 必须消费 step 后移动 result。覆盖迭代方法提前丢弃所收适配器后仍可观察原回调未析构；原回调的析构顺序还须覆盖正常返回、外层 Err、内层 unwrap Fault、append Fault 与最终后缀切片/追加失败。
- captures_at false 不调用 get；true 但 get(0)=None 保留 panic。default captures replacement 中两次 get(0) 必须都发生，且可独立观察合法 interior mutation。
- append 前的前缀与 last_match 更新顺序保持；false 后仍追加尾部；搜索错误和 panic 后不追加尾部；at 起点不补复制前缀；错误范围保留切片失败。
- default non_matching_bytes/line_terminator 是 None；候选行调用 shortest_match 并只产生 Confirmed。共享借用转发的返回视图不能延长原寿命。

生产 Trait Decoder/类型器、真实机器/格式 trait 声明、coherence/开放下游实例、具体回调泛型 F 的绑定和调用 witness、公共 Rust 路径与泛型 ABI、效果上界、WithBorrow Method 的目标供给、调用处短重借、inout 借用在捕获期间的独占与恢复、闭包/资源清理、编译和运行仍需对应 consumer 完成。原值层的其他 Clone/Copy/Debug/Eq/Index 等协议装配也没有被这两个 trait 代签完成；全工程 CLI/九库的其他源码范围不因本片的 25 方法而被冲销。

本片未运行 Cargo、联网、完整 Gate、生产 Gift 编译/程序或第二次修改运行对照，没有提交或修改共同 schema。源文件采用 LF、单个终止换行；紧凑 JSON 排版只改变呈现体积，不作为作者语义压缩率或性能证据。captures-defaults、interpolation 及其说明已同步本轮回调与留存修订；values 只修正 LineTerminatorAsBytes 的 BorrowField 静态参数序列。
