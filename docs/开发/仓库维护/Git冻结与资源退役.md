# Gift仓库Git冻结与资源退役

本章拥有Gift自身仓库的原生Git候选冻结、准确ref退役、评论运输卫生和分支/工作树/依赖恢复的实现接合。通用VCS开发流程由[版本控制与集成](../版本控制与集成.md)拥有，工作身份和继续条件由[工作身份与续接](工作身份与续接.md)拥有。退役不扩大删除授权；原operation、保留载体和未知作用仍由对应owner结算。


<a id="repository-freeze-native-index-decision"></a>
`post-checkout` 只恢复路径，或在同一 commit 上切换 symbolic/detached HEAD 时，不发生本 owner 管理的源码修订转移。原 Git session 仍须验证当前 HEAD、tree、仓库与工作树身份，并在返回前回读；该无作用结果不要求依赖 generation，不触发依赖或 hook 物化，也不把缺失依赖标成 ready。真正的修订转移分别从目标工作区根观察依赖和 hook；缺少兼容 retained generation 时保持明确的物化能力阻塞，不能误报已经发生父进程会话接合失败，也不能为退役工作树先安装依赖。

**文档冻结的原生 Git 方案。** 采用既有 Git scratch owner 持有的可写私有 index，通过原生 `update-index`／`write-tree` 形成候选树，真实 repository PRE 仍为受保留只读输入，最终发布仍由原文档控制 owner 的 journal、CAS 与读回承担。私有 index 的锁与替换归受保留父目录；不能把受限只读文件句柄直接当可替换输出，也不能让原生工具改变真实 PRE。严格输入／NEXT 编解码、对象类型与存在性、准确路径、环境隔离及原预算继续保留。

不采用被其替代的手工逐目录树重建、子树结果缓存、符号 delta 续接与专门扩额冻结框架作为并行生产路线：原生 Git 已承担树构造，额外模型会重复承担树语义、观测和恢复成本。这个理由支持删除重复机制，不证明所有平台已通过，也不从进程数减少推出完整提交或发布更快。现有平台、非合作外部 writer／ABA、资源及终态未知边界仍适用。只有真实原生接口缺口、不能保持的观察合同或同等保证下的完整成本证据推翻当前选择时才重开；须由同一 owner 给出最小差额与退出，不因历史候选已写成而重新启用。

文档控制的独立生产冻结入口只在持久 `terminal` journal 已回读后结束其有界 Git 读取会话；终端验证与 index／恢复残留退役是同一 operation 的独立有界续接。续接重新取得工作区租约与 Git 读取能力，核对原 journal、manifest、候选树和物理路径后才退役，且仅在两段均结算后报告冻结成功。journal 发布前失败不虚构恢复对象；发布后到最后删除 journal 之前的失败保留已存在的 journal 与未退役残留供同一 operation 恢复。最后删除 journal 后的屏障或空目录退役失败属于终态未知：后续入口仅能按无跟随物理目录核查退役空根，旧 operation 的完成须另由准确投影与作用回读证明，不能凭 journal 缺席补签。新会话不能刷新写入阶段的预算、跳过终端回读或重复发布作用。

```mermaid
stateDiagram-v2
  [*] --> Writing: 文档控制准入同一operation
  Writing --> NoEffect: journal发布前失败／不虚构恢复对象
  NoEffect --> [*]: 原owner核无作用
  Writing --> WriteRecovery: 已发布journal且终态前失败／保留现有对象
  WriteRecovery --> Writing: 同一operation由原owner重验写入阶段
  Writing --> Terminal: 持久terminal journal与原作用回读
  Terminal --> SessionClosed: 原Git读取会话结算
  SessionClosed --> RetirementAdmission: 同一operation重新取得租约与有界Git读取能力
  RetirementAdmission --> JournalRetained: 最后删除journal前校验或退役失败
  JournalRetained --> RetirementAdmission: 同一operation凭准确terminal journal重验
  RetirementAdmission --> JournalLast: 原身份验真且index／恢复残留先退役，journal最后删除
  JournalLast --> Complete: journal缺席、屏障与空根退役均回读
  JournalLast --> PostDeleteUnknown: 最后删除后屏障或空根退役不确定
  PostDeleteUnknown --> EmptyRootCensus: 后续入口无跟随核查无journal目录
  EmptyRootCensus --> PostDeleteUnknown: 非空或身份不符／保留未知
  EmptyRootCensus --> [*]: 空根退役；旧operation另验准确终态
  Complete --> [*]: 冻结成功
```

文档冻结的 Git index 在发布前按准确 PRE/NEXT 字节与恢复制品判定作用切点；日志已到 `index-published` 或更后阶段时，原生 Git 可能只刷新 index 的 stat/cache 字节，恢复改以无 `index.lock` 且外部 scratch `write-tree` 等于日志绑定的候选树证明已发布状态，不重放 index CAS。日志、指针、滚动计划和恢复制品仍各按原始字节及身份验真；树漂移、锁或异物保留为未结算，不能凭相同文件名继续作用。

并发工作使 main 前进时，已提交且来源可核验的候选只有在旧 base 位于新 main 的第一父系链上，且该链每一代的 current-state、活动指针、滚动计划、指针所指清单与工作选择源相对旧 base 均保持相同 Git 字节，才能沿原文档控制 owner 重绑同一 Work Package。新候选必须是新 main 的直接单父提交；旧滚动投影须绑定旧 base 与可核验的候选源提交、树、清单和控制字节，目标 package、tracking 与清单路径保持同一身份。任一代控制字节变化（包括后来回退）仍须取得新 WorkDecision 或已发布投影的原有权威，不能把旧候选投影冒充 main 发布事实。重绑只重新签发准确 main 与候选的控制投影，不延用旧 head 的审查或 Gate 结果。

```mermaid
flowchart LR
  Candidate["旧 base 的已提交候选投影"] --> FirstParent{"旧 base 在新 main 第一父系链上？"}
  FirstParent -->|否| Decision["新 WorkDecision／原有发布权威"]
  FirstParent -->|是| Control{"逐代控制字节均未变？"}
  Control -->|否，含变更后回退| Decision
  Control -->|是| Rebind["文档控制 owner 重绑同一 Work Package"]
  Rebind --> Fresh["新 main 的直接单父候选；重新审查与 Gate"]
```

提案不接收或产生 WorkDecision、MainHealth repair、激活回执或集成授权；普通激活仍消费真实工作选择，选择失败不能隐式降级为提案。重试与恢复拒绝跨提案／激活路径消费日志，已有激活日志继续按原合同恢复。提案合入默认分支后，指针清单与默认分支内容相同仍只表示没有活动任务，不会因文件已经发布而自动获得执行权限。


### 原生远端 ref 退役

日常已合并 PR 分支沿用 GitHub 原生 `delete_branch_on_merge`；它只处理 Provider 实际允许自动删除的分支，不证明积压分支、未合入成果或本地工作树已清理。旧分支积压按明确审核集合一次使用原生 Git 删除并独立回读，不再要求专用 maintenance workflow、Actions 执行身份、MainHealth、托管依赖安装或逐项自写执行平台。

删除前固定真实 repository/default branch 与本批 exact ref→old OID 前像，核对完整 open-PR head/base 消费者、活动工作及工作树归属。默认分支、受保护分支、活动分支、有未整合独有成果或任何未知项保留；分支名字、年龄、closed PR、旧测试绿色和 caller 自述都不构成可删除证明。普通合并用 Git 祖先关系；压缩合并、重基或替代成果须审查准确源码差异及其当前承接，不能把 tree 不同直接视作无价值，也不能把“已关闭”当作“已合入”。

恢复证据在作用前可重新取得并经过验证：保存批准集合、准确 tips/trees、成果承接和 native bundle 的校验/完整历史证明，以及执行者、目的和保留责任。已有合格证据直接复用，不为每条 ref 重打包；本地临时路径或上传成功本身不证明持久可恢复。原生 Git 的准确旧 OID 条件用于拒绝前像漂移，不允许 force、改保护或扩大删除集合；作用前刷新相交消费者。远端不提供所需条件或拒绝操作时保留 blocker，不能换身份或退回无条件删除。审核与 Git 事务不是跨 GitHub 状态的原子快照，无法排除的外部竞态保留未知。

保存原生命令的逐 ref 响应，再独立读取远端目标。报告分别列出已观察缺席、仍存在、读回未知以及本次作用已确认/未知/未尝试；缺席不能反推由本次删除，进程退出不能替代目标回读。响应丢失先重读，不自动重放删除；漂移、重建或新消费者只阻断相交项。只有确需重复且不能直接由原生命令可靠完成的检查才增加薄层脚本，不建立第二套身份、健康或持久编排。

```text
准确审核集合 + 可恢复证据
→ 刷新前像与活动消费者
→ 原生 Git 有条件删除
→ 保存响应 + 独立远端回读
→ 已确认 / 保留 / 未知及其恢复责任
```

旧 v1/v2 请求、preparation、结果 receipt、run/attempt 与 artifact ID/digest 继续按原格式只读解释。历史 receipt 读取复用已有 GitHub artifact 读取能力，验证原 workflow/run、repository、main、request digest 和 archive bytes；它不取得新的 dispatch、CAS、comment 或重放权限，也不把历史终态声称为当前 ref 状态。恢复前仍须按原 carrier 身份与实际期限取得准确 bundle，校验摘要、`git bundle verify` 与 expected heads。原 artifact 的保留义务、失败归因和未结责任不因取消新执行入口消失；过期、来源失配或恢复字节不可验证时明确阻断依赖该证据的作用。成功不自动删除唯一恢复载体，只有合格替代或原保留责任实际结算后才可退役。CodeQL 继续消费 GitHub Code Scanning 原生 check/alert，不新增 projection workflow。

### 评论运输垃圾退役

评论卫生分成两个不同 authority lane，禁止再把 GitHub Actions installation token 当成通用 Conversation 管理员。

**历史 comment 请求只读兼容。** v1 的 exact-comment-retirement 仍可解析 1..64 条互不重复的 #313 exact comment 身份，用于解释原请求与历史证据；解析不签发新的 comment 删除权限。旧自动 trigger 清理入口及其无消费者实现已退役，不再承诺当前 hosted CLI 提供该 DELETE lane。旧 SHA 的运行仍保留其原有作用、失败与回读解释，未结责任不会因为新源码删去 helper 而被视为已完成。其他独立 comment owner 和通用 GitHub API 保持自己的准入与作用边界；不为保存历史 parser 重新增加 comment job、公开评论或自动删除。

**PR Conversation hygiene lane** 不走 repository-maintenance DELETE。真实运行已经证明：`github-actions[bot]` 对普通 PR Conversation 评论（包括维护者自己的 `@codex review` 以及其他 GitHub App 的 Codex summary/setup/quota 消息）会收到 GitHub `403 Resource not accessible by integration`。因此当前 adopted 动作是：由已连接的 maintainer identity 对明确的运输噪声执行正文退役，将其替换成不可见 HTML tombstone；评论对象本身仍存在，不能报告为物理删除。已观测的 disposable prose 仅包括精确 review-trigger 命令、Codex review summary、environment setup hint 与 quota/upsell transport；扩展该集合必须重新核作者、用途和 consumer，不能按年龄或 bot 身份泛删。

CodeQL projection、真实 review submission、inline finding/thread、人工裁决、事故/失败复盘以及仍被 current owner 引用的 evidence 不属于运输噪声，不做 tombstone。对被平台权限阻塞的物理删除，保留最短 blocker receipt（HTTP status、owner、run/artifact）即可；不得留下整批原始 JSON 继续污染 #313，也不得把 tombstone 表述成 delete。

辅助工作树退役先由 generated-state 与 compiler-dependency owner 结算受管 `node_modules` locator，再由 `worktree-physical-closeout` 删除 Git 登记和物理目录；不得直接以 `git worktree remove` 作为完整清理。普通分支与 detached 工作树消费同一 generated-state 退役链；detached 必须由真实 Git 登记、空 branch、准确 head/tree 与既有 `detached-scratch-<head>` 身份共同绑定，不能因此取得 branch token，也不能跳过 locator 或普通状态的保全。Windows 上受管 locator 是 Junction，原生 Git 可能先注销 worktree 再因该 reparse point 返回 `Invalid argument`，形成未登记的物理残留；这种残留不能被第二次 Git 命令证明已清理，也不能未经目标与 link target 回读就递归删除。

编译依赖的可复用物化身份消费有效的安装配置，不因 `bunfig.toml` 只含非安装配置或文件缺席而拆成两代；同一运行中的输入栅栏仍检查该文件存在性与准确内容，防止观察后替换。linked worktree 的 locator 与物理 generation 分属 consumer 和 source owner：恢复只以记录的 owner root、当前 canonical generation、准确绑定和物理身份重建源资格。故障若发生在新 locator 已发布、生命周期登记尚未完成，原 transition owner 在这些条件复核后补完登记，不把“缺少登记”解释成外来对象并永久阻断清理。源 owner 换代后旧 generation 缺席而 consumer locator 悬空时，locator 生命周期 owner 仍以未跟随的准确链接身份、目标路径和缺席事实签发退役，再从当前源 owner 取得新代；共享 consumer census 只允许各 root 回收自己的 canonical generation，其他 root 的记录只参与对应 owner 的使用人数判断。

工程依赖的项目链接和隔离副本直接消费编译器已认证的 runtime materialization，不再生产 `.shared-deps` 投影。Bun 安装缓存位于 Runtime Cache 的 `bun-install`，可由多个工作树同时使用；清理它须由同一 owner 协调安装与清理，并在物理回读后报告完成。在该共同准入和结算能力建立前，`deps clean --bun-cache` 与 `deps clean --all` 于任何删除前返回 `IMPORT-AUTHORITY-004`，不能把旧 `.shared-deps/.bun-cache` 当成当前缓存或报告空操作成功。`deps clean --shared` 只退役已登记的旧共享目录；未知或未登记目录保持保护。

本地分支/工作树 closeout 的 recovery 只保护尚未结算的破坏性作用，不是默认永久归档；历史 hosted exact-ref carrier 仍按其原明确保留期限与可验真替代条件处理。bundle、checksum、authorization、receipt、worktree operation generation 与 retained proof 由 branch-lifecycle owner 按同一终态释放：本地分支删除已有 durable receipt、该 receipt 绑定的成果承接关系仍由当前目标满足且当前 ref 仍缺席后，释放该 operation 的 bundle family，并按 branch 与内容摘要回收没有 pending preparation、journal、receipt 或其他 lifecycle evidence 的裸重复 bundle；一旦存在 lifecycle evidence，必须由对应 branch receipt 或全部 operation journal 各自绑定的 `completed` receipt 证明整个 family 终态，缺少 preparation 不能降级成可回收；默认 recovery 根为空时一并退役。worktree evidence 只有在 receipt chain 为 `completed`、目标目录和 Git admin 都物理缺席、且本地分支 authority 已消失时才回收；同一 authorization 绑定的 generated-state retention root 也在验证原 receipt 与物理身份后同期退役，空的 worktree evidence owner 不继续残留。编译依赖的 stage intent 由 dependency owner 在工作树物理退役准入前核实终态、stage 与注册关系、准确字节和物理身份后退役；active、partial、异物或漂移保持原位。generated-state 在搬迁 `.tmp` 前完成依赖域退役，避免失去已绑定 generation 的原始路径。`residue`、`prepared`、活分支、仍有 active recovery proof 的不兼容旧代际和未知内容保持。当前 field-bearing／fieldless 恢复使用已采用的 authorization schema，不为这次历史终态兼容另造竞争 writer、宽松 parser 或新的授权入口。这是当前恢复路径的具体选择，不是永久禁止格式演进。新增必填含义是否进入原载体的新版本，或由独立 owner artifact/receipt 承担，按[授权与证据载体的版本解释](../../演进/兼容迁移与退役.md#authority-bearing-format-migration)核其签发责任、生命周期、原子关系及真实消费者；未完成该迁移前，现行字节格式、验真算法和下述历史恢复边界不变。当前 field-bearing writer 与历史 fieldless bytes 均由同一 canonical parser按各自原始字节和 operation 算法验真，但只有原始记录确实缺少 generated-state 字段的历史对象，才可在已有同 authorization 的 unregister 成功与 durable retirement phase 后，于同一 workspace write lease 内经过初始与 effect-boundary 两次回读，确认 target、Git admin、tombstone、retained proof 和 retirement fence 全部缺席，无删除作用地补签 `completed`；显式 `null` 不能冒充 fieldless 历史事实，任一对象重现即 typed blocker。历史 authorization 除该终态收敛与退役自身 evidence 外，不取得删除其他对象的 authority。不得把未知 `.tmp`、依赖状态或普通目录手工搬入 recovery 根来绕过 closeout；它们必须先由原 generated-state/dependency owner 分类并结算，不能结算时返回 typed blocker。

编译依赖阶段意图的退休在首个文件删除前持久发布绑定三阶段原字节与物理身份的标记；任一删除切点中断后，原 dependency owner 在相同协调租约内认证标记并续退。普通读取遇到该标记必须返回明确恢复入口，不把缺少阶段文件误判为外来残片。

编译依赖锁保护的安装进程树尚未证明终结时，父 PID 缺席、锁龄或 reclaim 标记 TTL 都不能授权删除原锁、退休 stage 或启动竞争安装。当前及已认证旧协调位置的 compiler lock 保留原字节与物理对象，并返回绑定原 root、lock 和 `migrateDependencyTransitionJournal` 入口的 `recovery-required`；该提示不声称入口已经取得效果静止依据。原持有者在进程树真实结算后按准确 token／物理身份释放，以及已认证的协调 cutover、原租约内阶段和 journal 恢复仍可完成。崩溃锁通过同一入口的显式宿主维护参数在取得旧锁之前恢复，不能用下面仅针对旧 consumer 记录的恢复机制代签。

此维护能力接纳同一 Windows x64 宿主的完整启动边界，或 Linux x64/arm64 上原生 procfs 可观察且 PID1 为 systemd 的同一 PID namespace 内核启动边界。Windows 卷仍限现有原生 local-volume guard 实际接受的本地 NTFS/ReFS；Linux 也必须通过原有 local-filesystem guard，拒绝共享/远端卷。UNC、共享卷、非原生 procfs、不同 PID namespace 或原生证明不可用时保留原状。当前 compiler installer 的固定参数包含 `--ignore-scripts`；维护前提是原作用属于本宿主的这些安装进程，而非另一宿主、外部服务或可跨启动自行续写的委派。操作者须有该宿主维护与完整重启授权，保持维护窗口，并从首次直接返回值经可信外部通道保管**原 checkpoint 字符串**，不得从待恢复工作区中的自述文件、备份或第三方输入恢复授权。不能克隆、回滚、更换宿主启动域/存储、迁移 VM/PID namespace 或恢复旧进程快照后沿用 checkpoint。Linux boot UUID 与 PID namespace 编号本身都不是宿主认证；同一宿主且无上述迁移/回滚属于可信操作者必须维持的前提，不能由两个 UUID 不等推导。该外部输入是显式维护信任前提，不是密码学签名、自动陈旧检测或 PID/TTL 证明；完整重启本身仍须另有授权，入口不会替操作者执行重启。

实际 API 是既有 `createDependencyOperation({ workspaceRoot }).migrateDependencyTransitionJournal(root, request, maintenance)`，原两参调用语义不变。先调用第三参 `{ action: 'prepare' }`，取得 `{ state: 'requires-host-restart', checkpoint }`；此步绑定准确 owner/协调目录物理身份、旧 lock/reclaim 字节与身份、既有 cutover/locator 以及原生 boot，不删除锁、stage 或 journal，也不在工作区写一个可自证的恢复文件。操作者完整重启同一宿主后，用原外部字符串调用第三参 `{ action: 'complete', checkpoint }`。Windows 入口仍只在原生启动序列和最新完整启动事件记录号都严格前进时继续，休眠、快速启动、相同/回退/缺失/未知启动证据均不代签。Linux 通过 retained no-follow procfs 读取并双重核对 boot_id、PID1 start time 和调用者/PID1 的 namespace 链接；只在原 checkpoint 的 namespace 仍相同而真实 kernel boot UUID 已改变时继续。PID1 重启、systemd manager 重新执行和同一内核休眠恢复不会改变 boot_id，不能代签；不沿用原 systemd unit 的“同 manager 恢复”规则，不以 start time 增大冒充内核重启。

恢复先核整个选定集合，再以现有 retained byte-CAS 先退役准确 reclaim、后退役准确 lock；Linux 同时消费绑定实际 target 的 retained resourceGuard，仅覆盖维护窗口内的合作式 namespace 操作，不宣称可防有权限的敌对写者；未知格式、不同字节、替换对象或 owner/协调绑定漂移保留对象并报错。中断重入只容许原选定项已缺席，不把新锁算作旧锁。旧协调的永久 cutover lock/marker 与 locator 只是绑定依据，不能被本恢复删除。若正常迁移已产生永久 cutover 后中断，回到原两参入口完成 locator/日记续接，不将旧 legacy checkpoint 套到新的协调锁；新位置仍有未闭合锁时须另取该位置的原 checkpoint。锁退役后，入口重新取得原正常租约，复用原 stage/journal owner 恢复；只有这条恢复也完成才返回 `{ state: 'completed' }`，不在 pre-lease 阶段退休 stage。源码接合与同 boot 拒绝测试不证明任一平台的一次真实跨重启成功，实际宿主维护资格与执行证据须分别说明；不具上述 Linux 宿主/文件系统资格的场景仍保留并返回不可用，不声称全部 Linux 环境可恢复。

旧依赖占用记录丢失原持有者身份时，普通进程清单、目录可改名或重开一个新 capability 都不能证明原借用结束。Windows 恢复由原 dependency owner 的 `recoverObsoleteCompilerDependencyConsumers(root, generationPaths)` 承担：首次调用只将明确选择的非活动 canonical generation、原 acquired 字节及物理身份绑定到原生启动序列和最新完整启动事件，持久保存一个恢复意图，不撤销借用。再次调用复用该意图；只有原生启动序列与完整启动事件记录号都严格前进，且最新启动确认为完整启动时，才能退役这批旧代次记录。休眠、快速启动、未知事件版本、日志缺失或回退均不能满足条件。完整重启影响整个宿主，必须另有相应授权。

恢复在原协调租约下先核全量新借用、活动 locator、owner 和物理身份；新增借用或漂移保留对象并阻断。合格的旧代次恢复直接退役原记录，不伪造正常 released 或旧 capability 的退休回执；之后复用原 consumer-zero、publisher proof 和物理 GC。恢复意图覆盖部分记录删除与物理清理中断，只有三个责任——记录退役、目录缺席回读及恢复意图自身删除——全部成立才完成；它不扩展为进程台账、常驻清理器或永久备份。无新借用且其余准入成立时，重启后调用同一函数即可续接，无须再指定目录。

依赖缓存的丢弃与可执行内容认证分开：清理在同一协调租约内，每个尚未写入的判定阶段只读取一次严格 consumer census，覆盖同一物理目录的全部 epoch；旧记录退役后，GC 重新读取新状态，不跨写入复用旧 census。原恢复意图只补已经终结的历史 generation 身份，不计入当前借用。以原记录或原 consumer-zero 绑定 generation，以原 publisher proof 恢复权限，再按元数据清单逐对象原生删除并回读。删除不重算包内容哈希、不重新签发 source generation，也不要求目标程序或业务代码参与。缺少原身份、未知借用、目标漂移及链接越界仍阻断；缓存损坏本身不应迫使删除操作先重新证明缓存内容正确。

**职责与存放。** 仓库开发工具位于 `src/adapters/self-hosting/development/`，开发入口位于 `src/bootstrap/development/`；工程归属选择、准备与迁移决策、旧借用管理恢复及工作树入口退役由该开发侧承担。产品路径只观察准备好的依赖、取得真实使用借用、发布自己的目标工程依赖投影和释放本次借用；缺准备返回明确错误，不隐式安装编译器依赖、不接管仓库历史恢复或顺带清理全库。跨产品和开发共用的内容绑定、物理代际、借用记录与投影事务仍由 toolchain 和原生运行能力承担，不复制签发者或经产品 facade 回调开发管理器。

普通安装使用包管理器原生用户缓存。必须隔离、只读执行和保留借用的副本，存于既有 Runtime Cache 的物理工作区分区 `workspaces/v1/<workspaceLocatorKey>/compiler-dependencies/`：`generations/` 保存正式代际，`stages/` 保存未发布物化。该键由真实工程物理身份派生，不按路径名称猜同一工程。转换日志、publisher proof、消费者与零消费者凭据、stage/恢复意图放既有 Runtime State 分区；它们承担在途恢复及作用前像，不能随内容缓存任意丢弃。工作区只保留标准 `node_modules` 使用入口；普通目录前像因同卷原对象重命名而暂存在原工程的回滚根，完成后准确退役。回滚根为空时只表示没有回滚材料，不要求为表示空状态重新制造目录内容。

工程资格 owner 与内容的物理父目录分别处理。`ownerRoot`、`ownerRootPhysical` 绑定真实工程输入责任；`sourcePath`、`physical`、`bindingDigest`、`treeDigest`、`treeEntryCount` 与 `epoch` 绑定实际代际。源可以位于工程内，或位于该真实工程派生的准确用户缓存分区；外部源必须经原生不跟随目录链、缓存/工程物理分离及当前对象身份检查，字符串前缀不是准入。跨工作树消费由原记录中的工程 owner 与真实物理身份定位，不能从缓存 hash 目录倒推工程，也不能把缓存目录复制一套 manifest 冒充工程真源。有效持久 locator 固定原 State，当前显式 cache 选择只决定新 generation/stage 的位置；环境改变不重选旧日志、证明或意图，也不重写旧路径与物理身份。已经发布的旧源可由原准确记录、入口与 owner/source 物理身份、完整 binding 和 retained native proof 继续限定读取；这不授予旧 cache 父目录的新写权。未知 owner、损坏 locator、原证明缺失或漂移拒绝相交读取并保留原材料，不退回读取缓存容器中的假工程 manifest。公共读要求原转换终态，原写者的发布读回与恢复只能消费其真正持有的同一协调 session。

目标工程读取复用这一已准备源。runtime source 只从唯一签发的 compiler source 及其摘要准确绑定的完整 compiler binding 中派生 `runtimeMaterialization`；保留 owner/source 物理身份及 tree 事实，按 runtime binding 重算 bindingDigest 与 epoch，不声称原 native proof 已经绑定新 epoch。目标作用前仍由同一读取 owner 重验原来源与 binding，不能用结构 clone、自填 runtime binding 或第二次普通目录扫描绕过资格。共享 State 物理能力固定稳定父目录；可正常退役的临时意图子目录由原 intent owner 管理出生、作用、恢复与精确退出，不能因长期固定其旧目录身份而阻断下次合法操作。

<!-- mermaid:id=cache_boundary -->
```mermaid
flowchart LR
  inputs["真实工程：manifest、lock、运行工具身份"]
  dev["仓库开发：归属选择、准备、迁移及清理决策"]
  shared["共同依赖能力：内容绑定、物理代际、借用与投影事务"]
  pkg["包管理器原生用户缓存"]
  stage["当前显式用户缓存：未发布 stages"]
  cache["原记录与 native proof 限定的已发布只读 generations"]
  locator["仓库 node_modules：使用入口"]
  compiler["产品：只观察已准备源、借用和发布本目标投影"]
  runtime["project读取owner：由唯一issued源与完整binding派生runtime事实<br/>原physical/tree保持；重算runtime bindingDigest/epoch"]
  reject["owner/proof不明、身份漂移或公共读遇未结转换：拒绝相交动作<br/>保留原State与源，不安装、不补假manifest"]
  release["本次借用真实释放：不顺带全库 GC"]
  gc["开发维护：自己的旧代际及历史记录"]
  native["OS 文件身份、权限与删除"]
  state["持久locator绑定的原State：journal、proof、consumers、zero 与未完意图"]
  rollback["工程同卷：普通目录原像，仅转换期间保留"]
  inputs -->|固定资格与输入前像| dev
  dev -->|显式准备，许可不安装时只复制| shared
  pkg -->|允许安装时供给| stage
  cache -->|不安装的准确副本源| stage
  shared -->|预算、取消与原生能力| stage
  stage -->|完整验证、新物理身份及证明| cache
  cache -->|准确入口发布| locator
  locator -->|只读观察及真实借用| compiler
  cache -->|原准确物理身份与native proof；不扩大旧cache写域| compiler
  compiler -->|完整binding摘要及其runtimeMaterialization关系| runtime
  runtime -->|目标作用前重验原proof与binding；不重复普通扫描| shared
  compiler -->|资格缺失或漂移| reject
  state -->|locator损坏或原转换未结；原held写者读回另核| reject
  compiler -->|finally| release
  shared -->|稳定父目录；原intent owner管理子目录出生/恢复/退出| state
  shared -->|普通目录切换前同卷保全| rollback
  dev -->|选择自己的过期副本| gc
  gc -->|核所有 epoch 借用及活动入口| state
  gc -->|准确目标与删除| native
  rollback -->|转换终态及无借用后| native
  release -->|原生释放凭据及 durable release| state
  native -->|真实缺席回读后退出原责任| state
```

**迁移与失败。** 控制目录迁移保持原 record、proof、consumer 字节及它们指向的原物理对象；先由原 rollover owner 在旧物理 namespace 恢复并核实轮换终态，再在用户状态分区内复制到未发布 sibling，完整核原结构与字节后同卷发布。旧轮换回执按原字节承接到 `legacy-rollovers`，保留原路径与物理绑定供追溯；新 namespace 的活动 `rollovers` 独立起链，不能把旧回执当作新物理目录的作用权限。stage 仍由其原 owner 先结算；未知对象、漂移或未完成恢复阻断相交迁移。正式缓存迁移产生新的物理对象、epoch 和 publisher proof：保留旧入口可用，借用准确旧源，复制到用户缓存 stage，验证输入/包/运行闭包和真实对象，发布新 generation，再沿原 locator transition 切换入口。跨工作树先保留真实 Git membership 并准备 owner 新代，再固定 consumer 的准确旧入口与新源借用执行替换；旧源仍被其他调用借用时也能切换，不能靠递归重观察或先删除旧源触发替换。最终释放原借用，GC 重新观察全部 epoch 的活借用及活动入口，再退役旧内容和原 namespace。原源码与其他工程的包管理器缓存不参与清理。

缓存内每代采用 `generations/generation-<epoch 前 24 位>/node_modules`；入口指向实际 `node_modules` 子目录。Node/Bun 的包依赖查找依赖这一原生层次，不能把包直接平铺在 `generation-*` 后依赖仓库祖先偶然提供解析路径。原 journal 先固定准确新源与目标，再分配空 generation 容器；中断由原意图恢复，未完成意图不能因目录为空而删除。GC 仅在原 consumer-zero 与源真实缺席成立后，按准确派生位置及当前原生对象身份删除空容器；存在未知内容时保留并报告。原历史平铺代继续按原记录恢复和退役，不改写身份。

<!-- mermaid:id=dependency_cache_migration -->
```mermaid
flowchart TB
  request["开发入口：固定工程、输入、许可、总预算及取消"]
  admit["取得原协调租约；核入口、原状态和物理前像"]
  control["原 owner 恢复并核实 rollover 终态；原字节承接 state，旧回执归档、新活动链独立"]
  hold["取得准确旧源的真实只读借用；入口继续可用"]
  copy["用户 cache stage：原生有界复制；每阶段输入与 Effect fence"]
  qualify["核内容绑定、包及运行闭包；读取新 physical，签发新 epoch"]
  journal["原 locator journal 固定新代、stage 与旧入口前像"]
  generation["原意图后分配 generation 容器；同卷发布 node_modules；新对象只读证明"]
  kind{"旧入口类型"}
  directory["普通目录：同卷 rollback；原 physical 与原 zero，保留原恢复依据"]
  link["链接：准确前像及生命周期退役，不删除其目标"]
  publish["发布新 node_modules 入口；实际 target、binding 及生命周期回读"]
  terminal["原 transition 完成，stage 意图按真实缺席退出"]
  release["finally 释放源借用、目录能力与租约；主错误和释放错误都保留"]
  pending["原 journal/stage 意图保留；真实报告已发生作用及未完成项"]
  collect["原总预算内取得维护租约：全部 epoch 无活借用、排除活动对象"]
  failed["返回真实失败及资源未释放责任，保留原未完意图"]
  old["原 proof 恢复权限；删除旧对象；原 zero + 源缺席后删除空容器及已承接控制副本"]
  done["新入口有效、旧对象及未完迁移材料真实缺席"]
  owner{"旧源属于当前工程？"}
  primary["保留真实 Git membership；准备其 owner 新缓存代"]
  replace["固定 consumer 旧入口能力与 owner 新源借用；原 locator journal 准确替换"]
  request --> admit --> owner
  owner -->|是| control --> hold --> copy --> qualify --> journal --> generation --> kind
  owner -->|否| primary --> replace --> terminal
  primary -->|owner 准备失败或 membership 变化| pending
  replace -->|前像漂移或发布中断| pending
  kind -->|directory| directory --> publish
  kind -->|link| link --> publish
  kind -->|absent| publish
  publish --> terminal --> release
  control -->|复制中断：正式 reader 不读 sibling| pending
  hold -->|缺证明或身份变化| pending
  copy -->|错误、容量、预算或取消| pending
  qualify -->|内容或资格不符| pending
  journal -->|发布或耐久性未知| pending
  generation -->|部分作用| pending
  directory -->|移动或原权限恢复失败| pending
  link -->|前像或生命周期变化| pending
  publish -->|入口作用未知或回读失败| pending
  terminal -->|stage 退出失败| pending
  pending --> release
  release -->|主作用与释放均成功| collect --> old --> done
  release -->|任一失败| failed
  collect -->|有借用、活动目标或前像漂移| pending
  old -->|部分删除或缺席未成立| pending
  failed -.->|条件修复后，同原意图、新租约及预算| admit
```

stage 由其原持久意图及原生对象身份管理。用户缓存 stage 不登记成工作区内的相对 generated-state 路径；历史工作区 stage 的原登记及退役责任仍按原合同处理。Linux 普通目录回滚消费原 transition、确定的同卷 rollback 路径、原 consumer-zero 与真实 rename 后身份；Windows 已存在的 sealed relocation 仍由原生 ACL 前像与原证明续接。两者都不能用新代 epoch 冒充旧代，也不能事后重算旧内容来填补丢失的原身份。

**原控制副本的严格删除。** 原协调 owner 先停止新的相交写者，并证明原控制字节已由用户 State 承接；原 inventory、目录物理身份和每个普通文件的原字节继续作为删除前像。Linux 在待退役目录本身保留真实 fd 和原生 `flock`，由私有签发者绑定 tree guard；每个原 leaf 删除消费该 guard，不能伪造或借用另一个 anchor-file guard。此排他覆盖同一内核内遵守原协调协议的写者，不声称能拦截任意原生外部程序的写入。Windows 继续使用原生 retained handle 与字节前像路径。

删除前完整核对当前剩余树：只能是原 inventory 中身份相同的子集，所有仍存文件保持原字节，未知项、同字节替换对象、链接目标漂移或根身份漂移均拒绝。原清单内身份及目标均一致的链接只删除其目录项，不跟随目标。需要恢复目录权限时，原观察必须显式取得 mode、UID、GID（`includePermissionMode:true`）；普通内容清单不能代替原权限前像。权限恢复只处理仍存且身份相同的原目录；确已缺席的原项可跳过。随后沿原 retained ancestor 链逐项比较、删除、刷新父目录并回读缺席；部分删除后用原前像和新恢复预算续接，不重算原身份、不扩大原 timeout。根已缺席时取得真实缺席观察。无论成功、失败或中断都释放原锁和 fd，主错误、权限恢复及释放错误均保留；最终缺席成立之前不删除仍有消费者的恢复依据。

<!-- mermaid:id=strict_control_retirement -->
```mermaid
flowchart TD
  owner["原协调 owner：停止新写者，核 State 已承接原字节与删除资格"] --> original["固定原 root/parent physical、inventory、普通文件原 bytes、恢复预算；权限恢复须原 mode/UID/GID 观察"]
  original --> named{"原 parent 下的 root 状态"}
  named -->|真实缺席| absent["回读原 selector 缺席；不伪造借用释放"]
  named -->|原身份仍存| retain["Linux 保留原目录 fd + native flock；私有 tree guard，核 parent/root 前后身份"]
  named -->|替换或未知| refuse["拒绝相交作用，保留对象与原恢复责任"]
  retain -->|争用或身份漂移| admission_cleanup["签发者关闭本次已取得 fd/锁；准入错误与释放错误合并"]
  admission_cleanup --> refuse
  retain --> modes["必要时恢复仍存原目录权限；原 missing 项跳过"]
  modes -->|权限准备或恢复失败| failed
  modes --> preflight["完整剩余树须原 identity 子集；所有剩余文件原 bytes 一致"]
  preflight -->|extra、替换、byte 漂移| failed["保留主错误与原前像；不开始删除"]
  preflight --> leaves["原 leaf 消费真实 tree guard；核 retained fd/named identity/bytes，unlinkat + fsync + absence"]
  leaves -->|预算、中断、作用失败| partial["记录真实部分作用；原 inventory/bytes 供后续恢复"]
  leaves --> root["删除原空 root，并回读实际缺席"]
  root -->|删除或回读失败| partial
  root --> release["finally native unlock + 关闭全部原 fd；权限恢复/释放错误与主错误合并"]
  failed --> release
  partial --> release
  release -->|全部成立| absent
  release -->|任一未完成| pending["返回准确失败及残留；保留恢复依据"]
  pending -.->|原 owner 重新准入，新预算，原前像| original
  absent --> retire["原消费者已退出后退役恢复材料；真实缺席回读"]
```

**历史记录恢复与删除路径。** 下图展开前述恢复合同；分支表示实际判定和残留，未决对象不能因图中存在后续箭头而取得删除资格。普通已结算缓存直接从协调租约与 census 进入，不强制经历历史未知记录的宿主重启。

<!-- mermaid:id=legacy_retirement -->
```mermaid
flowchart TB
  subgraph attempt["一次有界尝试：任何步骤失败、超时或取消都走统一失败出口"]
  scope["取得原协调租约与准确目录能力；deadline、取消及 Effect fence 约束作用"]
  prior["入租约先续接原 zero 已证明的历史终态压缩"]
  saved["严格解析原意图：记录摘要、owner 与目录身份"]
  boot["BootId 与最新 Kernel-Boot 27 v1 完整启动记录双严格前进"]
  census["原协调租约内：恢复前一次全 epoch 严格 census"]
  identity["按路径及 physical 分组：排除活动入口、核全部前像"]
  records["逐条即时核原 digest、epoch、physical，再退役旧记录"]
  fresh["记录已变：GC 重新 census，仍保护同物理目录的全部 epoch"]
  ready{"原 consumer-zero 已存在且 publisher proof 已退役？"}
  zero["用原记录或原意图绑定历史身份，持久化 consumer-zero"]
  compact["终态记录复用已持有父目录：字节及身份 CAS；released 先于 acquired"]
  proof["严格原 proof：generation 摘要、原生对象身份及 ACL 前像恢复"]
  metadata["元数据清单：路径、类型、对象与链接，不读包内容"]
  remove["原生逐对象删除：核父子身份，不跟随 reparse"]
  absent["回读全部目标目录缺席"]
  done["全部目录缺席后删除原恢复意图"]
  keep["发现新借用或活动目标：保留"]
  end
  pending["保留未完作用的原意图及剩余对象"]
  release["finally：真实释放已取得的租约与目录能力，保留主错误及释放错误"]
  outcome["主作用与资源释放都成功才返回 completed；否则报告真实错误与已发生终态"]
  scope --> prior
  prior --> saved
  saved -->|续接| boot
  boot -->|真实边界成立| census
  census -->|无新借用| identity
  census -->|存在新借用或活动入口| keep
  identity -->|全部前像正确| records
  records -->|不伪造 released| fresh
  fresh -->|没有任何 epoch 的活借用| ready
  fresh -->|发现活借用| keep
  ready -->|是：续接剩余删除| metadata
  ready -->|否| zero
  zero --> compact
  compact --> proof
  proof -->|权限已恢复| metadata
  metadata -->|不认证包内容| remove
  remove -->|删除返回| absent
  absent -->|全部物理缺席| done
  done --> release
  release --> outcome
  attempt -->|任一步骤错误、缺证、漂移、超时或取消| pending
  keep --> pending
  pending --> release
  outcome -.->|未完作用条件已修复：同意图、新租约及预算续接| scope
```

图中的实际控制分别由 `recoverObsoleteCompilerDependencyConsumers`（意图、启动边界、写前前像及最终退役）、`readCompilerDependencyConsumerCensus`（严格链校验与阶段内复用）、`collectReleasedCompilerDependencyGenerations`（全 epoch 活借用、历史身份、zero 与物理 GC）、`settleCompilerDependencyConsumerCompactionIntents`（持有父目录的字节 CAS）、`retireNoFollowProvenDirectoryGeneration`（原证明和 ACL 前像）及 `retireNoFollowDirectoryTree`（原生逐对象删除）承担。图不签发删除权限，也不把已有 zero 当作无条件删除许可；续接仍重新核当前借用、活动目标和物理前像。

本地 `refs/heads/*` 删除由唯一 Git 物理 owner 执行：branch-lifecycle 与托管验证的消费者先取得准确内容与恢复准入，并在作用前持久化 bundle、authorization 或对应 journal；作用时持有共享 Git common-dir 的协调租约，复查工作树绑定与准确旧 OID，再用原生 `update-ref` 旧 OID 比对事务删除，独立回读 ref 与工作树后签发结果。消费者的进程、输入和输出预算必须由该物理 owner 的实际事务上限与准确输入测量签发；同时需要 repository-root 租约时，先取得 common-dir，再取得 repository-root，并把同一个 common-dir token 传给物理删除，避免相反锁顺序。已被工作树绑定、前像漂移、租约失效或回读不确定时保留 ref 与恢复责任，不能把远端删除或进程退出解释为本地结算。协调租约排除参加该协议的 Gift writer；Git 的 ref 事务不能把任意外部原生 Git 的 worktree 绑定纳入同一原子操作，外部竞态若使终态不明则保留证据并报告 outcome unknown，不签发完成。

已合并分支的 closeout inventory 另绑定本次 operation 的准确 PR 编号、head branch、head SHA 与 base branch。普通发现仍按物理分支及 open PR 选择相关对象；作用前、作用后及恢复回读由原 inventory owner 按编号重新向 Provider 读取这个目标，即使本地与远端 ref 都已缺席，也保留终态所需的准确 merged 见证。列表与准确回读重复或矛盾、仓库／head／状态漂移、观察不可用或原有列表额度耗尽均阻断完成；选择器仅限定观察对象，不签发删除或完成权限，也不允许复用旧 PR JSON 代替新回读。

merged/retained residue closeout 在同一 common-dir 与 repository-root 租约内、ref CAS 前，由 `development.commit` owner 分类并退役目标 ref 的全部提交 journal；ref 已缺席的续跑也执行同一前置检查。任一 journal 的 applied 回读、准确字节/物理身份退休或能力不可证实时，保留 ref 与 recovery 并返回 typed blocker，不能先删 ref 再借已消失的 reflog 补判提交结果。

历史 applied journal 的当前保留义务与旧本地 ref CAS 证明分别判断。准确 merged PR 绑定不变时，target 已是 live main 的原生祖先，或 target 是与唯一 parent 同树且 parent 已被 main 吸收的空提交，均可由原 owner 解除保留；作用前重新认证 main 及吸收锚点。若当前 main 历史已重组，旧 merge 不再可达，原 owner 只能在准确 merged PR、原 topic 消费者缺席和原生远端 `refs/pull/<编号>/head` 仍唯一保全准确 head 的条件下解除历史传输日志保留；作用前再次核同一 carrier，每份 target 仍须被该 head 或当前 main 吸收。该结果不签发当前 main 的语义采纳，也不恢复旧 CAS；载体缺失、漂移或原生观察失败保持原位。历史默认分支 journal 无法恢复旧 CAS 时，只有当前已授权维护的可信组合层审查完整行为差额并明确判为已替代，才可对准确 journal、旧 target 和 reviewed main 解除当前保留；该审查不由 CLI 开关、路径或 caller JSON 代签。审查前后必须重验同一仓库、默认分支及 live／local main，pending、当前 attempt 或漂移保持原位，结果明确保留旧 CAS 为 unverified。原字节确实没有 guarded admission 的历史文件不补造 guard；原 owner 在同一写租约内验证 guard 资源缺席、准确原字节及设备／文件身份后，用原生 no-follow 字节 CAS 删除并回读缺席。部分 guard 或未知内容继续拒绝。

关闭但未合并的准确 PR head，只有在 head 是当前 main 的原生祖先或其树与可达 main 的准确锚点相同时，才可用 main-absorption proof 结算；证明绑定 commit/tree 和持久摘要，作用前重验 live Git 关系。不能由这些原生关系证明的差异仍需覆盖完整路径集的维护者采纳审查，不能把 PR 关闭或旧分支名当作内容吸收。proof 已按终态退役后，重启从已认证终端 receipt 与当前 Git 关系回读，不能凭文件缺席自行重签完成。没有准确 PR head 的本地 ref 只在调用者明确选定分支及旧 OID 后进入 retained closeout；内容等价是删除资格而不是选择授权，未选 ref 保持，已落盘授权按原目标集合续跑。

retained closeout 还可消费用户明确选定的远端后继保全位置。原 owner 从真实 Provider 读取 repository、remote URL、完整 `refs/heads/*`、准确 OID 与 tree，以原生 Git 祖先关系证明该后继保存目标 head；授权及 ref CAS 前均要求准确 OID，不能由本地 tracking ref 或分支名补签。新 retained authorization 按新版本绑定此位置，旧 v2 继续按原 main-only 字节和摘要解释；维护者采纳审查仍消费其原 main 绑定，不能自动扩张到任意后继。原 owner 在作用后重新核本地 ref/worktree 缺席与保全关系，才签发 terminal receipt。退役恢复材料时允许同一远端 ref 前进，但原保全 OID 必须仍是当前 tip 的原生祖先；ref 消失、改写丢失祖先、URL 换向、对象或观察不可用均保留恢复责任。跨 GitHub 与本地 Git 的外部竞态继续保持原 unknown 边界。

重复 bundle family 的退役也必须能在每个删除切点续接：发现同时覆盖 bundle 与其剩余 sidecar，名称只定位，不签发资格；先验证所有现存 journal 各自匹配完整的 completed receipt，再退役 preparation/journal、bundle/checksum，最后删除自包含终态 receipt。bundle 已缺席时仍须由这些原 receipt 绑定原恢复摘要与终态；未完成 operation、未知 sidecar 或前像漂移保持原位。没有 lifecycle evidence 的裸重复包则保留 bundle 到最后，避免失去发现入口。

terminal receipt 是部分退役的恢复依据。新 retained receipt 自包含原 canonical authorization、物理根与保全绑定，重启不要求调用者再次选择目标。原 owner 在 terminal 验真及当前缺席/保全回读后，按原 family 顺序退役 bundle、checksum 与已验证 sidecar，随后退役 authorization，最后删除 receipt；各切点中断均按该 receipt 与剩余准确字节、身份续接。pending operation 必须保有完整恢复材料，未知 sidecar、物理漂移或 ref 重现阻断续接。已退役的 v2 terminal receipt 一律返回明确的 authority unknown 并保全原 ref 与恢复材料；authorization 同在也不触发隐式升级，不能由当前环境重建或重签历史 receipt authority。仍由当前 producer 产生的旧版本 authorization 继续按各自原合同解释，不受 receipt 退役影响。

```mermaid
stateDiagram-v2
  [*] --> NoArtifact: 无真实恢复消费者
  [*] --> Prepared: branch-lifecycle准入破坏性作用；绑定exact subject与恢复入口
  Prepared --> Prepared: live operation或consumer仍存在
  Prepared --> Completed: effect terminal receipt
  Prepared --> Residue: partial effect或typed unknown
  Residue --> Completed: fieldless historical observation-only convergence；双回读全部物理对象与fence缺席
  Completed --> EvidenceRetiring: receipt绑定的保全位置与ref/target/admin缺席均回读
  EvidenceRetiring --> EvidenceRetiring: 部分退役中断；原receipt验证剩余字节与身份后续接
  EvidenceRetiring --> RetainedUnknown: 保全丢失、未知sidecar、身份漂移或ref重现
  EvidenceRetiring --> Retired: bundle先退役；receipt最后删除并回读
  Completed --> RetainedUnknown: incompatible active proof或身份未知
  Residue --> Residue: 原owner恢复、对象重现或人工裁决前保留
  RetainedUnknown --> Retired: 原owner验证身份与终态
  Retired --> [*]: evidence、retention root与空owner目录同期退役
  [*] --> StageTerminal: dependency三阶段意图已结算；stage与注册均终态
  StageTerminal --> StageMarked: 原owner持久发布绑定原字节与物理身份的retirement marker
  StageMarked --> StagePartial: 任一阶段文件删除中断
  StagePartial --> StageRetired: 同一协调租约内认证marker与剩余文件后续退
  StageMarked --> StageRetired: 三阶段文件与marker删除回读
  StageMarked --> StageMarked: 普通读取返回恢复入口
  StagePartial --> StagePartial: 身份漂移或非终态保留
  StageRetired --> [*]: 空intent namespace退役并签发receipt
```
