# 意图到 TypeScript：有限参考编译器与可扩展方法供给（原 Gift98 实验说明）（历史研究说明）

**Status: historical research description; the implementation and its runtime evidence are not included in this package.** The original experiment described a bounded compile path from small author expressions to a multi-file, strictly typed TypeScript ESM project. The experiment allowed the author to use the **experimental optional `.intent` text editing profile** or its equivalent strict JSON author profile; the earlier experimental `.gift` suffix is **explicitly rejected with `SOURCE_PROFILE_COLLISION`** by the historical reference CLI, because `.gift` belongs to a separate optional computation language and must never silently select this intent parser. Either input is the **one editable author source** for a given project; never save both as independently writable parallel project authorities. Generated TypeScript is a derived artifact, not another input that must be manually maintained.

The `.intent` syntax subset is **not** the general computation `.gift` grammar / full future `gift.author-text/1`, and the JSON schema is **not** a published production author source protocol. Both merely lower to the same finite checked source model, which is projected *in memory* as the then-used `gift.author-module/1` plus `req:composite/use` terms. That projection is a semantic witness, not the complete production semantics evaluator.

## 1. Historical author inputs

The original `examples/board.intent` contained (optional author-visible text, NOT a required Gift language):

```gift
module example.board
target typescript-esm
storage volatile
module-format esm

record Task key id {
  id: Text[1..64]
  title: Text[1..120]
  done: Bool
  stage: Enum[todo, doing, done, cancelled]
}

flow TaskFlow initial todo {
  states: todo, doing, done, cancelled
  todo + start -> doing
  todo + cancel -> cancelled
  doing + complete -> done
  doing + cancel -> cancelled
}

compose TaskActions = Task.stage via TaskFlow
```

This states only author-owned product facts: the named record and fields, exact key identity, allowed workflow transitions, the relationship between record state and transitions, and the requested target and environment. The developer does **not** specify `Map`, schema validator internals, `bigint`, CAS logic, `OperationId` receipt management, transition lookup indexes, or TypeScript file boilerplate. These are owned by qualified method implementations and the emitter.

The equivalent structured source is `examples/board.intent.json`; `examples/inventory.intent` and `.intent.json` supply a second distinct author project with a developer-authored **declarative business policy**:

```gift
policy StockAvailable on Stock {
  quantity >= 1
  active == true
}
```

The source directly compiles `checkStockAvailable(candidate: StockInput): boolean` and reuses a checked, side-effect-free policy runtime. Invalid field names, comparator/type combinations, and enum literals are compile-time errors; no dynamic `eval` or unknown business-code synthesis is involved. File extension chooses the **reference CLI's** input codec. In a real Gift workspace, SourceProfile resolution must come from the governed project manifest rather than guessing from a suffix. The reference CLI intentionally does NOT implement this general workspace negotiation; it chooses a narrow codec from the local sample filename.

## 2. Historical build and runtime boundary

The original environment required Python 3.10+, Node.js 20+ and TypeScript `tsc` 5.8 on PATH. These dependencies and the compiler are not supplied here. Explicit `--out` materialization required a fresh directory and refused overwrite.

The original generated project included `src/Task.ts`, `src/TaskFlow.ts`, `src/TaskActions.ts`, `src/gift-runtime/record.ts`, `src/gift-runtime/workflow.ts`, `src/index.ts`, a strict `tsconfig.json`, `package.json`, plus `gift-artifact.manifest.json`. The manifest pins source, compiler and method files, selected methods and emitted members by SHA-256. No network dependency installation is required by this fixture; TypeScript itself must be available in the environment.

At runtime, `createTaskStore({maxRecords,maxReceipts})`, `nextTaskFlow(state,event)`, and `applyTaskActions(store,opId,key,expectedRevision,event)` were callable exports in that original output. An unauthorized transition returns a typed rejection; successful CAS increments an exact uint64 revision with canonical string representation and replays a *process-local* success receipt for identical `opId` and request.

The historical acceptance process:

The original process ran compiler rejection/equivalence/update/recovery tests, compiles two `.intent` examples and one JSON example using `tsc --strict`, executes one baseline Node property/behavior run (>8,000 assertions) plus focused acceptance for the other projects, performs a second source revision, guarded update, strict rebuild and a **targeted new-transition assertion**. It does **not** repeat the unchanged baseline property loop merely to inflate the test count. Package documentation/link/knowledge checks are a separate release gate, not a per-author-edit obligation.

## 3. Historical second-revision and recovery conditions

The second author revision added this transition within `flow TaskFlow`:

```gift
  done + reopen -> doing
```

That update applied only to a directory previously generated by the same reference compiler; it did not authorize overwriting an unrelated human-maintained codebase.

The reference reconciler compares every tracked preimage byte with its ownership manifest. If you changed only that transition, `src/TaskFlow.ts` is the **only** generated source file whose bytes change. It does not overwrite unrelated human files. If any tracked generated file has been manually changed, update returns `OWNED_FILE_MODIFIED` and refuses to clobber it. A new member colliding with an unmanaged file returns `UNOWNED_PATH_COLLISION`.

The update is a **limited single-writer, multi-file operation**, not a globally atomic filesystem or durable database transaction. Before modifying any output, it stages the new files and retains original byte preimages under `.gift-reconcile/`; the manifest is written last. If interrupted after a complete journal exists, the next update fails `RECOVERY_REQUIRED`, requiring an explicit recovery operation.

`--recover` either finds the committed output intact or rolls the generated members back to their saved preimages. Unexpected concurrent modifications or corruption cause an explicit recovery error rather than overwrite. A `.gift-reconcile` directory **without a valid journal must not be deleted automatically**: `UNOWNED_TRANSACTION_DIRECTORY` preserved its bytes for deliberate operator inspection. An automatic deletion on missing journal in the previous fixture was an unsafe behavior and has a regression test. This mechanism has tests for simulated interruption; it does **not** provide isolation against an uncooperative concurrently writing process, process effects already invoked by a consumer, distributed effects, or hardware/fsync durability guarantees.

## 4. Historical capability and failure boundaries

| Aspect | Behavior reported for the finite experiment | Not provided / explicit rejection |
|---|---|---|
| Semantic input | Finite `VersionedRecord`, `FiniteTransition`, `TransitionOnRecord`, `AllPredicate` and generic native-callable *binding* | Arbitrary free-form product meaning, general `.gift` computation language, new arbitrary algorithms synthesized from names |
| Type domain | `Text` scalar codepoints and bounds, `Bool`, `SafeInt` with bounds, exact string `Enum` | `DecimalMoney`, arbitrary-precision Int, time, nested graphs, remote references |
| Method selection | Exact local registry/source identity and hard ESM/volatile eligibility; more callable definitions through method library without a new `METHODS` branch | General Method qualification, semantic equivalence, purity or resource/safety assurance, global optimization, durable storage |
| Revision | exact uint64, canonical JSON decimal string, preimage CAS, successful retry replay | Unbounded revisions, distributed/durable CAS, persistence across restart |
| Resource safety | Explicit capacity limits, reject unbounded op receipts silently | Concurrent multiprocess accounting, durable quotas, hostile JS Proxy sandbox |
| Target | Modular ESM TypeScript source, strict TS compiler build, type-checked wrapper imports for external methods | Rust/C++/Go backend, formal behavioral proof, whole-program optimizer, arbitrary custom algorithm synthesis |
| Revisions | Detect human edits, only replace owned bytes, journal-assisted interrupted update recovery | Atomic multi-file publication relative to concurrent external observers or true source revision CAS |
| Evidence | Deterministic compilation unit cases and real Node runtime assertions | Independent full semantics proof, production security/performance certification |

A developer request like `storage durable` or `target rust` must **fail**, not produce an apparently valid but weaker implementation. `getRepo`/write operations/deployment are not performed by this fixture. No network, account, or privileged external effect is required.

## 5. Historical data-extended method binding

`methods/library.json` binds two **previously unknown exact Definition references** (`demo.math/ClampSafeInt@1`, `demo.text/NormalizeAsciiTag@1`) to checked local source content hashes, exports and TypeScript scalar signatures. `examples/bound-methods.intent` writes only two lines (`bind Alias = package/Symbol@revision`) plus the ordinary module/target headers; `examples/bound-methods.intent.json` is its alternate input representation. Each is a separate demo input; neither should be kept as a second editable owner for an actual single-source application.

The generic `gift.core/BindCallable@1` binder resolves these entries, captures the provider source bytes, places them under `src/gift-methods/<stable-reference-hash>.ts`, emits a typed wrapper `src/<Alias>.ts`, and records library/source digests and `externalSupplies` in the Artifact manifest. Adding another entry of the same supported shape changes library data and target source, **not the Python `METHODS` dispatch table**. The target TypeScript compiler checks the export and its assignable function signature; the Node acceptance actually calls both functions. Provider source is never executed inside the Python compiler. Path traversal, symlink source, unexpected source hash, and false `effect: pure`/production qualification are rejected by this finite reference reader.

**A native function is not a meaning definition or a verified implementation of the named meaning.** The derived import remains explicitly `REFERENCE_ONLY_UNVERIFIED_MEANING`. Real qualification still requires an independently interpreted semantic Definition, body/observation/error/effect/frame correspondence, environment, resource limits, evidence and source control. TypeScript's structural type system cannot prove purity, absence of privilege, total correctness or behavioral equivalence. This fixture only opens implementation *binding* for new functions, not arbitrary semantic compilation.

Reordering JSON field keys, use declarations, state lists and transition edges that have no specified behavioral order kept generated members stable in the stated order-insensitive domain. Source bytes still have separate identities; normalize only proven order-insensitive constructs, not ordered requirements or side effects. The recovery code deliberately rejects unknown reserved directories rather than deleting them.

## 6. Where this fits within Gift

The first product-scale generalization should implement a common **Def/use semantic interpreter** separate from the text codec and from the target emitter; discover versioned third-party Definitions/Methods with accurately declared constraints; connect the full constraint/type/effect/Rule model; make the same semantics build on an actual multi-source workspace with stable source maps; then ship real Target backends and independent conformance. Ordinary novel business combinations should reuse these mechanics without modifying the compiler core. A genuinely novel computational algorithm still needs a known implementation, a derivation from other methods, or an independently verified new method: a tiny source statement cannot guarantee a new algorithm's correctness or optimality with no constraining information.

The canonical *design responsibilities* stay in `docs/10-作者与输入/作者源/结构化源码.md`, `docs/20-语义与组合/组合/模块封装-功能复用与作者责任.md`, `docs/30-实现解析/实现选择/实现解析与候选资格.md`, `docs/40-目标与制品/目标/具体降低与目标输出.md`, `docs/40-目标与制品/编译内核/运行准备与最小实现.md`, and `docs/90-治理与参考/状态/实施闭包.md`. This document preserves the historical mechanism and finite observation limits. It supplies neither the original code nor proof evidence, and it is not a competing normative owner.

<a id="universal-composition-synthesis-realized"></a>
## 原参考方案：不为新业务加编译器分支的通用计算与有限行为综合

原 Gift98 实验在同一参考工程中扩展，而不是另复制一套编译器。它增加了两种**跨领域公共语义**：

- `gift.core/DataShape@1`：定义一个闭合结构及各字段的类型/上下界；仅为数据契约，不暗示主键、持久化或进程共享。
- `gift.core/Compute@1`：一个精确的输入/返回合同 + 由类型化的参数、字面量、字段、条件、普通算术、布尔、同模块调用及受界`sum/count/all/any/map/filter`组成的计算树；同一个函数体 Lowering 适用于所有开发者定义的名字。也可以给它一张**枚举/布尔输入域的完整有限真值表**，由通用综合算法先产生决策树，再使用相同的计算器检查及发射。

本子集没有继续引入第三种必选Gift语言。`.intent`只是一个**可选试验编辑投影**，严格JSON是等价的另一种输入；两者每次编译只能选一个做该次实验AuthorSource。`.gift`仍保留给此前规定的可选中立计算语言，在这个参考解释器里直接拒绝。原表达式的Python-like写法由受限AST解码成JSON节点，**没有执行Python源码、`eval`、任何外部导入或任意方法动态调用**。

### 从简短意图到真实源码

`examples/cart.intent`的关键作者事实：

```text
shape CartLine {
  sku: Text[1..64]
  price: SafeInt[0..100000]
  quantity: SafeInt[0..100]
  active: Bool
}
derive Subtotal(lines: List[CartLine;128]) -> SafeInt = sum(lines, price * quantity)
derive EligibleCount(lines: List[CartLine;128]) -> SafeInt = count(lines, active)
derive Shippable(lines: List[CartLine;128]) -> Bool = all(lines, active)
derive ActiveSKUs(lines: List[CartLine;128]) -> List[Text;128] = map(filter(lines, active), sku)
derive FinalPrice(lines: List[CartLine;128], discount: SafeInt, express: Bool) -> SafeInt = max(0, Subtotal(lines) - discount) + (30 if express else 0)
```

除模块头四行之外，这是所有业务来源的计算定义；不需要附送Cart的TypeScript算法库。编译后的`src/CartLine.ts`定义接口，`Subtotal.ts`等包含能真实运行的TypeScript函数，`gift-runtime/compute.ts`共用输入/输出验证、精确SafeInt、集合原语。生成的代码包含普通`for`、条件及函数调用，不把JSON留到运行时再解释。`examples/sensor.intent`用**同一个不变的Core**实现传感器汇总/阈值告警，`examples/arithmetic.intent`检查数值边界，`examples/access.intent`用六个完整角色组合合成访问判断。源码输出不根据Cart/Sensor/Access等名字选择模板。

修改`FinalPrice`中的express费率后，`--update`先验证所有受管文件前像，只会更新真实变化的`src/FinalPrice.ts`和新的Manifest；在旧产物被人手修改、未知目标路径或无有效恢复凭据时拒绝覆盖。`--recover`仍只适用于已有完整事务日志的单写者本地参考协议，绝不视作生产原子写入。

### 意图信息是否足够与资格边界

| 用户事实/要求 | 有限参考实例的实际机械行为 | 不得扩大的结论 |
|---|---|---|
| 列表字段与类型化计算规则完整 | 校验输入/字段/表达式，生成函数体与类型声明 | 不说明其业务定价政策一定正确 |
| 全部Bool/Enum状态组合及唯一结果 | 完整性/重复检查，生成稳定小决策树 | 不等于从少量例子综合未知无限算法 |
| SafeInt精确整数结果 | BigInt中间计算，再拒绝溢出或零除 | 不等于定点货币/任意精度/浮点语义已覆盖 |
| 明确无外部效果 | 只允许受检Compute间调用；与未知原生模块共同导入则拒绝 | 不是不可信Proxy/宿主对象的安全沙箱 |
| 有上界有限列表及无环调用 | 估算有限最坏节点步数并对越界输入拒绝 | 不保证实际CPU时间/内存/RT并发指标 |
| 更换一个作者表达式 | 只允许受管区内源成员字节差异更新 | 不是多写者持久化事务、分布式部署或IDE集成 |

**主要生产差额**：开放语义方言与跨文件名称解析、正式SourceProfile协商、完整Effect及前后条件推导、库语义等价与多方法Pareto选择、面向非有限算法的真实实现或具资格Provider、多Target ABI/资源/并发与故障资格、受控SourceMap与多写者持久更新、独立Guarantee/Assurance。新计算目标若超出子集，返回明确Need；不能通过补空函数或让AI猜缺失业务语义获得假通过。

<a id="current-dual-compute-reference"></a>
## Gift101 原受限参考方案：通用受界 Fold 与目标方法资格选择

**作者依旧不需要编写 TypeScript 函数体。** 在现有 `.intent` 投影中可以写 `derive EndBalance(postings: List[Posting;256], opening: SafeInt) -> SafeInt = fold(postings, opening, lambda balance, posting: balance + (posting.change if posting.accepted else 0))`。不提供预制账本方法，`compiler/compute.py`的通用检查与发射处理这类有限闭合语义。`examples/ledger.intent` 是包含 map/filter 的完整样本，`ledger-scalar.intent`是用于严格比较双实现的标量聚合子集。

`compute-method callback` 选择基于现有共享 runtime 的回调版本；`compute-method inline` 严格选择仅支持标量集合迭代的直接 `for-of` 发射；缺省 `auto`按有据可查的结构规则为每个Compute选择，遇到map/filter选择callback，**不是宣称该选择性能最快**。同一作者源码在严格JSON中可用可选 `controls.computeMethod`，但不得同时把两种表示作为并行可写的项目事实。受管manifest新增 `selectedComputeMethods`与候选目录摘要，语义摘要不会仅因选择改变而改变。对显式不合格pin会报错，不降级。

每个 `computeX` 负责入口快照、边界契约与公开导出，同样经过静态检查的跨定义纯计算调用使用不重复制值的 `__giftInternalX`。仅在受检模块及可信Host接合前提下成立；完整外部攻击/效果系统尚未实现。用户名字与内部辅助符号用卫生别名隔离。原实验以方法选择、ledger、卫生别名和输入快照的独立负例核对这些区别；其测试范围不构成生产发布资格。
