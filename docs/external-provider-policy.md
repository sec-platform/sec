---
title: 外部 Provider 政策
status: stable
domain: external-provider
last-reviewed: 2026-08-15
---

# 外部 Provider 政策

本文拥有外部工具、MCP、语言/编译器基础设施、程序分析器、类库/SDK、构建/测试/发布服务和 Agent 工具的治理政策、owner 分离、边界、评估、接入、conformance、吸收、替换与退役规则；它不拥有任何具体 Provider 值、live availability 或 effect receipt。具体候选、品牌、当前路由、A/B结果和复核状态只存在于 `docs/governance/external-capability-ledger.yaml` 及相应 Evidence；已注册 EnvironmentSpec 的静态 artifact、layout、endpoint、version 与 digest 只存在于它所引用的 JSON spec。

Provider quota、billing、credit、rate-limit 与 upsell 原文在类型化归一后可丢弃；它们最多产生 bounded reason code 与内容 digest，删除后的原文绝不能支持 positive availability、Review、Gate、merge 或 completion 声明。availability/health 是路由和同一 epoch 的 negative circuit-breaker projection，不是 effect authorization：Evidence 缺失、过期或无法复核时一律归一为 `unknown`；`unknown` 不能支持 positive availability claim，也不授予 effect，但它本身不禁止一个已由 operation-specific authority、idempotency/recovery 与 exact readback 授权的 provider operation。只有 current-epoch 的 explicit `unavailable` 禁止重复；实际 provider response/readback 才产生 availability evidence。external capability ledger 拥有 route/availability projection data，canonical provider capability contract 拥有 ledger shape、freshness、role mapping、normalization 与 retry transition validator；注册的 EnvironmentSpec 拥有其静态环境合同值，不能由 ledger 或 live evidence 反向写回。

Provider catalog、manifest和Evidence是Compiler Implementation Resolution的候选输入；本文不拥有最终`ResolutionDecision`、`ImplementationBinding`、`ImplementationBindingDelta`、Compatibility或Migration。

## External capability adoption boundary

成熟 host 工具的 provisioning 与 runtime adoption 是两个不能互换的 owner。系统、用户或显式 package
manager workflow 拥有 install、upgrade、uninstall 和 distribution cache；SEC production runtime 只允许采用
已经存在的 capability。普通 operation 不得下载 archive、执行 installer、解压或复制一套工具发行版，也不得
把这些 Effect 隐藏在 provider discovery、health check、session open、cache warmup 或 recovery 中。缺失、版本
不符、来源不可证明或当前资源预算不足时必须返回 typed `unsupported | unavailable | unknown`，由独立且显式
授权的 provisioning operation 处理；consumer 不得通过 fallback 把 runtime adoption 变成安装入口。

外部命令能力固定为单向四层 authority DAG：

1. **Provisioning owner** 只负责机器上的安装与升级，不签发 repository、credential 或 Effect authority；
2. **Physical adoption owner** 把 PATH、registry、standard location 和 caller path 都只当不可信 candidate hint，
   仅认证并 retain 本次实际执行所需的 executable、working directory 和 effective loader dependency closure；
3. **Semantic session owner** 从 opaque physical capability 签发 Git read、Git ref Effect、GitHub read 或 GitHub
   Effect 等互不冒充的 session，并固定 repository、endpoint、credential/principal、absolute deadline 与 aggregate
   resource ledger；
4. **Operation owner** 只消费对应 opaque semantic session，不能自行查找 executable、spawn 成熟工具、继承
   ambient credential，或反向触发 provisioning。

physical proof 必须等于本次 invocation 的**最小因果闭包**，不能扩大为整个安装目录或整个发行版。它可以包含
launcher、effective executable、真实 app-local loader dependencies、resolved system modules、retained cwd 与
session 前后 identity/readback；不能为了证明一个 executable 而递归扫描、复制或拥有所有 docs、locales、
templates、examples、licenses、unused helpers 和其他无关 payload。adoption 的 entry/byte/time complexity 必须由
静态 contract 限制，并与最小执行闭包成正比，不能随安装树规模增长。持久缓存最多保存可失效的 locator/evidence
projection；它不得复制 executable bytes，不得成为 authority，live session 仍必须从当前 retained physical state
重新发行。

机器约束必须阻止这条边界退化：production adoption module 不得 import download/archive extraction/installer
surface；Windows provider unavailable 的 negative test 必须证明 zero network、zero install/cache publication、
zero child spawn；candidate path、same-path ABA、executable/app-local dependency drift、cwd replacement、deadline、
close settlement 和 origin forgery 必须 typed fail closed。tracked production census 还必须保证 Git/GitHub 等成熟
工具只有一个 physical owner，raw child transport 不能成为第二 provider。

## Windows native control CLI EnvironmentSpec

`src/external-capabilities/windows-control-cli/profile/sec-windows-control-cli-v1.json` 是既有 external-provider 治理合同的
machine projection，并且是 Windows native control CLI 的唯一静态 EnvironmentSpec 内容 owner；它不是新的
semantic、credential 或 effect owner。`src/external-capabilities/windows-control-cli/contract/environment.ts` 只提供严格
closed-schema parser、关系校验、deep-freeze 与 canonical digest，不复制具体版本、可执行文件
或日期值。`docs/governance/external-capability-ledger.yaml` 是 route projection owner：只能有一个
`host-command-execution` / `sec-windows-control-cli-v1` route；它只记录active profile、surface、lifecycle与
unresolved reason，不得再复制`observedVersion`、spec path/digest/revision、artifact、executable、layout或endpoint。
docs-doctor从唯一EnvironmentSpec registry按route profile解析canonical descriptor，再对传入repository root中的
spec做bounded no-follow raw readback；ledger不能选择另一个path或自报digest。当前 route 的唯一 CLI surface 是将由运行时 owner 提供的
`windows-control-cli-session`；parser module 不是 live surface。docs-doctor 必须从传入 repository root 对该
canonical path 做 bounded no-follow raw readback，解析后比较canonical digest，拒绝额外、缺失、替换或漂移。production positive
只允许来自当前机器上已存在 capability 的 retained executable/cwd、exact bytes/version、minimal loader closure
与 session settlement readback；任何 archive、installer、下载缓存或完整安装树 census 都不能参与 runtime
admission。EnvironmentSpec不维护独立`specRevision`：schema拥有grammar identity，canonical digest拥有exact content
identity；live availability epoch、executable runtime version、credential epoch和effect grant由各自owner持有。
全局 ledger 的 `revalidation-required` 可以由任一仍在评估的 Provider stale projection 触发；
它不能把这个 exact profile 伪造为 available/unavailable，也不能替代其独立 live proof。

四层必须保持不可互换：(1) JSON EnvironmentSpec 只拥有可审计的 candidate layout、静态版本/摘要、
endpoint 和 bounded command/resource contract；(2) capability ledger 只投影 route、profile
和 live routing 状态；(3) live provider session 只由真实执行器以 retained no-follow physical evidence 产生
availability/lease/identity/readback；(4) Git/GitHub provider 各自拥有 repository semantics、credential、principal、
permission、API 与 remote effect。任一层都不能为另一层自签 authority。

PATH 只能作为不可信 locator hint；执行前后必须由 Windows no-follow retained session 重新解析并绑定真实
launcher/effective executable 的物理身份、原始 bytes digest、版本输出、父目录链和 provider epoch。单个
`executableEntries` 中的 `observedSizeBytes` / `observedSha256` 仍只是 adoption contract 的一个物理 facet；
缺少 retained candidate/root/loader/session readback 时必须保持 typed unavailable/unknown。Git for
Windows 的有限 `bin/git.exe` / `cmd/git.exe` 候选不能直接成为最终 authority，最终执行路径必须是
EnvironmentSpec 绑定的 effective layout；Git 语义与安全 read session 由各自 owner 提供。GitHub CLI 的
`github.com`、`https://api.github.com` 与 `https://api.github.com/graphql` 只定义 endpoint contract；credential、
principal、permission、REST 请求和 remote mutation 仍由 GitHub provider owner 认证、限额、effect lease 与
readback。禁止为 Git、GitHub CLI、MainHealth 或 WorkSelection 各造一层 one-to-one wrapper；它们消费同一
EnvironmentSpec 和相应的 live provider session。unsupported platform 必须返回 typed unavailable，不能静默使用
另一个平台或裸 PATH 命令。

## 目标

SEC 不应因目标宏大而重造所有轮子，也不能把外部工具的能力、宣传、类型声明或内部数据模型直接变成 Core truth。

外部能力的目标是：

> 以最小、可替换、可验证的组合补足 SEC 缺失能力；把结果纳入统一 identity、Evidence、authority、transaction、Verification 和 lifecycle 边界；成熟机制被吸收后删除重复实现。

## 本地 Linux Workflow Runner 边界

GitHub Actions 的 dispatch、App/check identity 与 GitHub-hosted compute 是三个不同能力，不能因当前
workflow 同时消费它们就合并成一个不可替换 Provider。SEC 的
`sec-linux-verification-v1` route 使用仓库范围的 self-hosted runner 作为物理计算 Adapter；GitHub 只保留
dispatch、repository identity、check 与协作投影。hosted runner quota 不再是 required Linux 计算的唯一能力。
该 route 名是位置无关的 capability identity，不是本机名称：本机隔离 container 与未来远端
self-hosted executor 必须先通过同一 conformance contract。同一 repository 在任一时刻只能有一个
atomic provider lease 持有该 profile；该 Provider 必须同时注册恰好一个`control`、一个`trusted`和一个
`sut`角色实例。任何会dispatch并等待下游producer的任务（包括Session coordinator与post-merge
MainHealth join）只在control实例；不等待同角色下游的credential/readback/assembler叶任务在trusted
实例；candidate或dependency可执行内容只在sut实例。不得让等待者占用被等待的唯一角色实例，也不得让
SUT污染trusted容器。
切换物理 Provider 只替换 lifecycle binding 与 provider/environment revision；Workflow 不改名、不改 job，
也不得让两个 Provider 同时竞争同一 profile。标准 GitHub-hosted image 不能
冒充该自定义 capability；若未来重新采用 hosted compute，必须作为新的受控 routing profile 迁移。

该 Adapter 必须同时满足：

- 镜像与OCI物化图采用Docker Buildx Bake/BuildKit；真正包含多个长期service/profile/health/dependency的本地运行拓扑以Docker Compose为唯一候选owner。当前v3 runner lifecycle仍是待迁移的raw Docker adapter，只有一次性registration token不落盘、三角色identity/lease/readback与故障恢复能被Compose投影等价证明后才能切换，不能先写Compose文档再宣称已实现。单镜像Buildx物化不为形式统一套Compose。Kubernetes不在当前本地开发和Verification capability closure内，不安装、不生成manifest、不建立第二编排owner；未来只有受治理resolution证明Compose能力不足且迁移总收益成立时才能改变该边界；

- runner release、archive digest、Node LTS官方archive digest、GitHub CLI官方archive digest、Python archive-inspection runtime、Ubuntu base image digest、最终Docker image ID、
  三角色label profile与lifecycle owner全部进入
  `docs/governance/external-capability-ledger.yaml`；
- image首次构建才下载并校验这些exact artifacts；`gh`是trusted WorkDecision/activation的必需API capability，
  必须在任何runner registration token effect之前由固定版本、archive SHA-256、镜像label和实际`gh --version`
  build readback共同证明，禁止在job内`apt install`、临时下载或因ambient host工具碰巧存在而通过。后续启动必须按final image ID复用本地content-addressed
  Docker layers。cache absent才允许重新下载，重建出的image ID不同则需要新的provider revision，禁止把
  mutable apt结果静默冒充旧revision。Action/Evidence所消费的hosted provider revision必须显式绑定同一
  GitHub CLI version、archive SHA-256与final image ID；focused CI contract直接把runner owner常量与revision projection比较，
  禁止ledger、image、revision或测试fixture只更新其中一部分；
- runner环境的稳定身份拆为OCI runtime content digest与Docker image-store projection digest；BuildKit provenance按受治理policy生成，其每次materialization artifact digest只进入动态receipt，不能充当稳定runtime identity。仓库外canonical SEC Runtime Cache保存绑定spec digest的完整OCI layout与canonical receipt；Docker tag/image缺失时先用该layout经Buildx本地投影恢复并readback，只有layout也缺失且provider plan明确为materialize时才允许remote solve。删除Docker image本身不得导致联网，OCI、Docker projection、provenance与runtime resource profile按各自依赖粒度独立失效；
- Dagger v0.21.8是已测量、未安装的`environment-materialization`候选，不因体积或依赖数量先验拒绝：Windows CLI 22,437,680 bytes，linux/amd64 Engine压缩layers 371,606,760 bytes，默认TypeScript Node runtime再增加56,181,947 bytes，冷启动已知下限约394 MB/450 MB。裁决门槛是默认privileged Engine、独立`/var/lib/dagger` cache与现有Buildx cache无自动复用合同，以及真实runner provider首次接入净源码收益仅约0–150 LOC。Phase 1 pilot只能位于SEC-owned EnvironmentSpec/materialization plan/receipt之下，必须用同一输入证明cold/warm/offline/cache-loss/digest/provenance/progress并真实退休旧glue；Dagger digest、Engine state或task success不得成为SEC identity、trust root、Verification PASS或closeout authority；
- 注册 token 只经进程 stdin 进入一次性配置，不进入argv、environment、image、日志或durable state；
- container 不挂载host path或Docker socket，不接收repository secret目录；
- 三个持久runner container均由Docker `--init`提供PID-1 child reaper；start与每次readback都必须验证
  `HostConfig.Init=true`和`docker-init-v1` container label，禁止把无reaper旧实例或同名替换实例解释为合规capacity；
- control/trusted container显式drop全部capability；只有sut container的受信构造层获得精确
  `CHOWN + SETGID + SETPCAP + SETUID + SYS_ADMIN + SYS_CHROOT`，分别只用于构造私有tmpfs/chroot、切换到
  UID/GID 65532并清空bounding set。候选进程本身必须实时证明`CapEff=0`、`NoNewPrivs=1`、私有
  mount/PID/network namespace、固定cgroup/prlimit、runner根与继承FD不可见，且只消费authenticated input archive；
- SUT直接使用`unshare --mount --pid --fork --kill-child=KILL --net`和retained private tmpfs `chroot`，
  不依赖systemd、sudo、host bind mount、Docker socket或unconfined seccomp。namespace内trap只做best-effort
  mount teardown；外层唯一teardown owner在unshare关闭后对deterministic root与sentinel做exact absence readback；
- persistent runner workflow只能从实时default branch的`repository_dispatch`加载受信workflow与仓库字节；
  `workflow_dispatch`/`workflow_call`不得把caller-selected ref带入runner root。非default release/candidate必须
  走authenticated archive到private SUT chroot或一次性runner，禁止root checkout/install/test。archive
  inventory由镜像内显式冻结并在构建时导入验证的Python 3.12.3标准库`tarfile`解析canonical tar，并在解压前拒绝
  checksum、type、path/link、mode、size或trusted digest漂移；Python版本、镜像label与最终image ID共同进入
  provider revision，缺失`hashlib/json/tarfile`时镜像构建和provider启动都fail closed；
- provider以固定remote CAS tag持有一个bounded operation的immutable generation ledger；首代先绑定
  GitHub API host/principal/repository、Docker context endpoint/daemon identity、exact image ID、三角色预期name与
  operation identity，之后每个container create、runner registration、active、teardown和terminal effect都必须在
  下一effect前用expected-old object SHA推进一代并readback。三实例共用operation identity但不共用
  filesystem/process/container；本地state只可缓存当前remote generation，self-digest、name、tag、label和当前census
  都不能签发destructive ownership。effect后、generation前的process death只能保留为typed external residue，恢复者
  不得从当前对象反推或自签exact ID；
- 每次status/stop/recover必须从remote generation重载并显式重用已绑定的GitHub API host/principal与Docker
  context/endpoint/daemon；GitHub credential在进程内解析一次、验证principal后只通过子进程environment复用，Docker
  effect直接发送到retained local `npipe://`或`unix://` endpoint host而不是mutable context name；远端provider必须在
  远端executor本机运行adapter，不能把未绑定TLS/principal的`tcp://`或`ssh://` daemon冒充同一能力。ambient `GH_HOST`、`DOCKER_HOST`、变化的keyring
  或另一个config/context不能把错误endpoint上的空集解释为absence。container必须以frozen image ID启动，registration token和全部`exec`只发送给刚按exact ID重验的container；
  结束时只以remote-retained runner ID和container ID执行effect，并分别证明ID与retained name都absent。缺失、额外、
  duplicate、cross-role、case-varied或同名替换对象全部fail closed；standing offline runner、prefix cleanup和foreign
  object adoption都禁止；
- provider stop默认只删除remote ledger精确绑定的runner、container、local projection和remote ledger，保留已验证的
  active final image及content-addressed dependency cache供后续exact revision复用。active image retirement不属于
  ordinary stop；只可由独立authority-bound retirement operation消费canonical superseded decision，在exact daemon上
  证明零引用后按immutable image ID删除并readback。禁止caller布尔开关、mutable tag、`docker system/image/container
  prune`、prefix/glob清理或触及其他工程的container、image、volume与cache；
- provider ledger是固定tag上的非源码control ref；它只允许exact absent-create、object-SHA
  `force-with-lease` generation advance和terminal generation后的CAS删除。每代是一个Git commit，parent是上一代，
  tree中只有canonical `provider-ledger.json`，因此ref的reachability保留完整历史而不依赖unreachable-object宽限期。
  恢复必须从generation 0逐代验证commit parent、tree、payload与exact单effect transition；本地object存在时zero-network
  读取，缺失时只fetch一次exact ledger ref，不为每一代重复调用API。该窄通道不执行用于源码/index sealing的pre-push hook，普通branch/tag push仍必须经过原Gate；脚本与
  contract必须拒绝任意ref、任意remote、非CAS advance/delete或用local projection替代remote readback；
- provider name在lease发布前为最长role suffix预留8字符；GitHub labels以case-insensitive集合比较，fetch URL和
  全部effective push URL必须同仓。即使local state丢失，status/recovery也必须查询remote lease、全部profile/role
  eligible runner与repository-labeled container，禁止把未知第四实例或大小写变体误报为absent；
- runner readiness必须读回每个retained ID/name、exact labels和`online` eligibility。`busy=true`是注册成功后可能立即
  被dispatcher认领的瞬时调度状态，不能把正确capacity误报为未就绪；destructive stop/cleanup则必须重新census并在
  任一exact runner仍busy时拒绝effect。ready与cleanup因此消费同一identity，但拥有不同的状态谓词；
- MainHealth不由`main` push直接占用尚未active的本地runner。control plane先对exact live main建立remote ledger、
  三角色container/runner完整census和active projection，再发布唯一`sec-produce-main-health-v1` repository dispatch；
  本地、远端或未来其他平台provider只改变受治理execution binding，不要求修改workflow/job/check合同。hosted
  MainHealth provider的enrollment、exact check selection与source digest必须消费同一个闭合predicate，完整绑定App、
  workflow、event、exact main、check name和event-specific display title；近似同名、其他event或错误provenance只能是
  nonmatching noise，不能在不同阶段被先接纳后排除或先排除后接纳；
- MainHealth production credential owner只从固定`github.com`登录读取bearer token，再经同一GitHub REST transport的
  `/user`与repository permission endpoint绑定login/node和`maintain | admin`。它只向当前进程签发opaque、repository-
  bound capability；token、fetch、caller JSON、测试issuer或公开constructor都不能签发production authority。每次provider
  observation与reconciliation分别创建一个total-deadline、request-count、response-byte和matching-workflow-count受限的
  session；total-deadline从credential acquisition开始并覆盖token subprocess、principal/permission enrollment与全部后续
  request，任何阶段只能消费剩余预算。底层request helper缺少active exact session时必须拒绝，不能自动为单个request重建
  session从而重置总预算。check pagination必须对完整页集和所消费workflow provenance做stable reread，不能只用page 1
  或`total_count`证明完整快照；
- local/hosted MainHealth conflict的reconciliation是独立operation-specific Effect，不由availability ledger或本地
  self-digest授权。adapter只调用GitHub稳定REST commit-status machine interface：在exact receipt subject的唯一mutation
  lease内先CAS maximal predecessor并发布immutable prepared intent，prepared中的一次性write permit必须在任何POST前
  durable readback。owner先查询完整bounded status history；只有零个matching status且permit尚未消费时才允许发起至多
  一次POST，随后无论成功、错误或响应丢失都只靠同一完整history收敛，绝不重发。只有唯一case-insensitive context、exact
  request、status ID/node、creator login/node、append-only timestamp与target URL全部读回才产生external authorization
  receipt；零个保持unknown，多个或任何字段漂移为conflict。若prepared status已存在但hosted authority漂移，旧intent/status
  必须成为authenticated inactive terminal并作为下一operation predecessor，不能删除、重写或永久占住namespace。该status
  只授权同一local supersession publication，不签发MainHealth provider、Verification、merge或完成authority；每次消费仍
  独立重验hosted check provenance、本地physical preimage、live issuer permission与subject chain；
- SUT cgroup固定2 CPU并由3600秒wall kill界定整棵descendant tree，真实aggregate上限为7200 CPU秒；同值
  per-process `prlimit`只作冗余。candidate依赖由exact trusted-base lock/package以`--ignore-scripts`物化，下载cache
  保留在runner私有路径且不进入chroot，命中cache不得重复下载。runner image还必须冻结workflow setup所需的
  archive tools：Node `.tar.xz`由`xz`处理，`setup-bun`的`.zip`由Info-ZIP `unzip 6.00`处理；两者都在
  Docker build内做可执行readback并由build revision与最终image ID绑定，缺少能力不得延迟到job内重复安装；
- image rebuild只由其canonical capability tuple变化触发：base digest、runner/Node/GitHub CLI/Python或系统库、
  sandbox substrate、entrypoint/label recipe。仓库业务源码、`package.json`/`bun.lock`、TypeScript、Prettier、
  测试或Workflow内容变化只失效各自dependency/Evidence节点，不重建runner
  image；新增能力层追加在稳定base/Node/runner层之后，使单一工具升级只失效自身及后续label层。版本检查只
  产生候选decision，不自动升级；只有consumer需要、security/support触发或量化收益成立才一次性更新tuple、
  重建、冻结新image ID并将旧ID登记为superseded；
- workflow route、runner version或sandbox substrate变化会改变provider/environment revision并使对应
  Evidence失效，但branch、PR、amend和无因果文档变化不会单独要求重跑Linux SUT；
- GitHub不可用时本地runner输出只保留为诊断或产品Evidence；在独立local issuer上线前，不能伪造
  GitHub check、MainHealth或merge authority。

退出条件：机器拥有的local Evidence issuer与provider-independent MainHealth projection进入main并完成
parity后，删除GitHub Actions runner Adapter和workflow route，不保留双执行writer。

引入一个工具不是成果。只有它解决了明确问题、现实提升经过同条件验证、failure/security/upgrade成本可接受、consumer已迁移且没有第二 authority，才形成工程结果。

## 能力角色

外部能力只能处于以下一种主要角色：

- **Core substrate**：成熟基础库或编译器API，被 SEC 自己的 contract/validator 包裹；不能拥有 SEC semantic authority。
- **Replaceable Provider**：提供 syntax、symbol、graph、runtime、browser、build、security、业务能力实现或其他 Evidence/Capability。
- **Adapter**：把 SEC canonical contract转换为外部系统调用，或把结果归一为 SEC DTO/Evidence；不能拥有业务Responsibility或最终选择。
- **Reference Provider**：SEC维护的最小、可解释、可conformance基准实现；不是默认宇宙最优。
- **Custom Provider / Governed Extension**：用户或组织提供的实现，平台治理接口、Effect、Permission、owner、Verification和Migration。
- **Agent/CLI projection**：只读machine projection或导航。
- **Verification / conformance tool**：执行一个明确 Gate 或交叉验证。
- **Development utility**：仅用于仓库开发，不进入产品运行面。
- **Project-specific utility**：只服务某个 corpus/policy/fixture。
- **Rejected / superseded / watch**：有明确理由、触发条件和复核时间。

外部工具不能拥有 Engineering IR、Entity/Fact identity、source owner、authorization、actual Delta、Impact truth、Implementation Resolution decision、Compatibility、Verification decision、publish/merge decision、rollback terminal state 或 release authority。

## 能力类别

评估时按最小能力拆分，不按品牌整体判断：

- Language Frontend：parse、type、symbol、definition/reference、module resolution；
- Code Index / Graph：context retrieval、caller/callee、dependency、path trace、reverse/diff impact；
- Deep Program Analysis：CFG/PDG、taint、data flow、security path；
- Source Transformation：AST/LST/codemod、格式和comment preservation；
- Runtime Observation：trace、coverage、profile、network/process/browser observation；
- Build / Package / Test：install、bundle、cache、sandbox、container、browser；
- Policy / Schema / Solver：validation、compatibility、constraint solving；
- Provenance / Supply Chain：SBOM、signature、attestation、vulnerability；
- Workflow Runtime：retry、durability、compensation、scheduling；
- IDE / Visualization / MDE：navigation、projection、structured editing；
- Application Capability：HTTP、validation、storage、queue、telemetry、cloud SDK、ORM 等具体实现；
- Agent / MCP：向模型暴露query或operation。

一个项目可能同时提供多类能力；每类独立决策、授权和退役。不能因为使用其 parser 就同时接受其graph、cloud、MCP和mutation权限，也不能因为一个包同时提供多种API就把整个品牌视为不可拆分的Implementation Candidate。

## 渐进接入等级

平台不得把“官方支持/不能使用”做成二分。任意外部类库或服务至少按以下成熟度处理：

### L0 — Physical dependency

平台知道package/source identity、exact version、integrity、license、dependency/peer/native/install/build closure。允许安装、构建和显式代码使用，但不声称理解业务行为。

### L1 — Typed external invocation

Language Frontend从`.d.ts`、exports、source和module resolution产生`ExportedSymbol`、signature、generic、overload、参数/返回类型与source identity。用户可以结构化选择函数、构造器或方法并连接输入输出。

L1只承诺调用shape、module resolution和适用typecheck，不承诺：

- Effect、Permission或资源；
- 幂等性、retry、timeout、cancellation；
- error classification和serialization；
- security、privacy、telemetry；
- runtime/Target行为；
- semantic contract satisfaction或Support Claim。

未知项必须显示`unknown/opaque`，不能因类型正确或示例可运行自动升格。

### L2 — Declared governed invocation

用户、组织或已授权Policy为TypedInvocation声明Contract、Effect、Permission、errors、resources、Target和Verification requirement。它可以作为Governed Extension/Custom Provider使用，但声明仍需验证，不能因用户填写字段而成为官方事实。

### L3 — Observed / inferred candidate

平台分析源码、`.d.ts`、文档、测试、示例、CFG/data-flow、依赖闭包和隔离runtime trace，产生ProviderManifest、Adapter、Effect或Contract-matching candidate。输出必须保留coverage、conflict、unknown、unsupported、source/provider revision与Evidence，不自动Adopt。

### L4 — Verified Provider / Adapter

只有完成security/license/data review、Target physical conformance、version binding、behavior/error/effect mapping、negative/failure tests、freshness和retirement后，Provider/Adapter才可进入正式候选catalog，供Implementation Resolution自动选择和迁移。

`verified`不自动等于`selected`或`product-supported`；最终选择仍由Compiler Resolution Policy决定，Support Claim仍需独立package/deployment/usage maturity。

### L5 — Normalized SEC-owned projection

只有能够被完整表示、round-trip、验证、迁移、重新生成并删除旧writer/依赖的局部能力才可以Normalize为SEC-owned projection。复杂ORM、native runtime、远程服务、动态反射和大型框架通常长期保持Provider或Governed Extension，而不是强制“反编译成SEC”。

## 黑盒、灰盒与白盒

- **Black box**：只有公开接口和运行结果，如闭源SDK、native addon、WASM或远程API。平台治理接口、Effect、Permission、Target、资源和Verification，不猜内部实现。
- **Gray box**：有类型、源码、文档、测试和trace，但无法证明全部路径或业务含义。大多数开源库默认属于此层。
- **White / normalized**：只有经Reconcile/Adopt/Normalize后，SEC能够完整重建并拥有的范围。

“源码公开”不等于white box；“没有发现Effect”只有在inventory、static/runtime coverage按设计应发现该Effect时才构成反证。一般程序行为、终止和完全等价不能由一个通用静态算法自动保证。

## 强制评估流程

```text
Discovery
→ Problem Definition
→ Primary-source Research
→ Capability Decomposition
→ SEC Ownership Mapping
→ Security / License / Data Review
→ Integration Cost and Failure Model
→ SEC + Conformance Corpus A/B
→ Decision
→ Bounded Integration or Design Absorption
→ Consumer Migration
→ Duplicate Removal
→ Version Pinning and Evidence Freeze
→ Revalidation / Replacement / Retirement
```

### Discovery

来源可以来自编译器、语言、IDE/MDE、程序分析、安全、CI/构建/发布、工业系统工程、Agent工具、论文和大型项目基础设施。不能只搜索名称包含 AI、Graph、Compiler 或当前流行品牌的项目。

### Problem Definition

在研究工具前必须写清：

- SEC 当前缺失的具体 capability 和 consumer；
- 当前自研/人工流程的错误率、延迟、token、维护或安全成本；
- 需要的是 authority、Evidence、候选、变换、验证、执行还是可视化；
- 输入、输出、coverage、freshness、failure和完成判据；
- 明确不需要的能力与禁止权限。

禁止先安装工具再寻找用途，也禁止把“可能以后有用”当作长期 standing dependency。

### Primary-source Research

至少核对官方文档、源码/公共API、release notes、license、security policy、issue/limitations、benchmark方法、install/build脚本、网络/telemetry/data boundary、增量/stale/failure behavior和维护状态。

营销页面、搜索摘要、社区转述和作者benchmark只能提供候选线索。多个页面引用同一原始材料只算一个证据来源。

### Capability Decomposition 与 Ownership Mapping

把项目拆到可单独替换和验证的能力，并为每项选择唯一 SEC owner：Core substrate、domain Provider、Adapter、Projection、test/fixture、project utility或reject。

若同一能力已经由 SEC code contract拥有，外部工具只能作为交叉 Evidence、实现 substrate或替代候选，不能建立第二结果源。若决定吸收其设计，必须明确哪些算法/contract进入SEC、哪些品牌/格式不进入、何时删除外部依赖或自研重复。

对于产品实现类Provider，还必须区分：

```text
Provider catalog eligibility
≠ Implementation Resolution selection
≠ ImplementationBindingDelta
≠ Compatibility / Migration
≠ dependency materialization
≠ physical Verification result
≠ product Support Claim
```

### Security、License 与 Data Review

必须审查：

- license、专利、copyleft、商用/再分发和生成物权利；
- package provenance、maintainer、release/signature、dependency和install script；
- native/FFI、MCP server、browser、container、credential、filesystem、process和network权限；
- source/code/context是否上传，数据保留、训练、telemetry和区域；
- secret/environment读取、日志/trace泄漏和输出注入；
- untrusted project/tool output对Agent或parser的prompt/code injection；
- update/revocation/incident response和offline/fail-closed行为。

MCP server、native dependency、language server和云服务都视为高权限Provider。版本固定和本地运行不自动消除风险；需要执行不受信代码时必须有独立 sandbox authority。

### A/B 与 Conformance

至少在两类差异显著的 corpus 上进行同条件验证：

- SEC 自身：canonical contracts、IR、transaction、CI和工具链密集；
- 一个复杂conformance/brownfield corpus：多package、runtime、browser、release、治理和历史负担密集。

按能力记录：

- task success、precision/recall和漏掉关键consumer的次数；
- false relation、false confidence、unknown/unsupported和stale行为；
- source excerpt/reference可回看性；
- index/build时间、wall-clock、CPU、memory、disk、network；
- Agent工具调用数、输入/输出token和选择干扰；
- incremental update、revision binding和失败恢复；
- language/framework/platform coverage；
- install、upgrade、license、安全和运维成本；
- 与SEC现有实现的重复、迁移和删除成本；
- 对Semantic Contract、Effect、error、resource和Target的conformance。

性能宣称必须同机器、版本、输入、warm/cold模式和采样协议比较；不能比较两次孤立运行。作者提供的benchmark不能替代SEC自己的A/B。Conformance通过只证明被测试合同和环境，不证明所有业务用途。

## Decision Taxonomy

每个候选只能进入明确状态：

```text
absorb-design
integrate-provider
integrate-adapter
register-verified-candidate
use-as-development-tool
use-as-conformance-tool
retain-project-specific
watch-with-trigger
superseded
reject-with-rationale
retired
```

禁止用 `maybe`、`later`、`looks useful`、`temporarily keep everything` 作为长期状态。

每个 decision 至少绑定：problem/capability、owner、version/license、scope、security/data边界、A/B Evidence、consumer、duplicate to remove、upgrade/revalidation trigger和exit/retirement。

`register-verified-candidate`只授权进入Implementation Resolver的候选catalog，不授权最终选择、安装、发布或Support。

## Provider Contract

所有产品 Provider 输出至少绑定：

```text
providerId / providerRevision
capabilityId / contractRevision
sourceRevision / targetRevision / scope
package/version/integrity/adapter references where applicable
coverage and unsupported regions
freshness and invalidation rule
authority class / confidence where applicable
diagnostics and failure classification
unresolved / ambiguous / conflicting regions
evidence references and raw artifact digest
resource / effect / permission / network / execution boundary
conformance and support maturity references
```

Provider输出首先是不受信输入。SEC adapter必须canonicalize、validate、bound output、strip secrets/absolute host details并保留raw artifact引用；不能因parse成功、manifest声明、类型检查通过或AI生成测试就把它写入IR或标为eligible。

源码bytes只证明物理内容；AST/symbol/graph通常是derived或inferred；runtime trace只对应具体环境和路径；LLM摘要永不直接升格。Predicted impact、Provider candidate impact、canonical Impact、actual Delta、Implementation Eligibility和Verification safety是不同对象。

Provider unavailable、partial或stale时，默认产生明确unsupported/not-run/unknown，而不是返回空结果或旧结果。只有明确Gate/contract要求该Provider时才阻断整体操作；Implementation Resolver需要其完整证明时，候选应保持unknown/ineligible而不是静默fallback。

## Adapter Contract

Adapter只拥有稳定Contract与Provider API之间的协议转换：

- input/output/type和serialization mapping；
- error、cancellation、timeout、retry和resource mapping；
- Effect/Permission声明与observability；
- Target-specific lowering；
- conformance suite与known limitations。

Adapter不能：

- 拥有付款、注册、工单等业务Responsibility；
- 修改或降低Semantic Contract以适配库默认值；
- 自行选择package/version或绕过Implementation Resolution；
- 自行比较old/new Binding或签发Compatibility；
- 把Provider success解释为产品Acceptance；
- 在Backend或UI中隐藏额外Effect、telemetry或依赖。

一个Provider可以有多个Adapter revision；同一Adapter也只能覆盖声明的contract subset。无法保持旧合同的版本升级必须先产生new Binding，由Delta/Impact owner生成`ImplementationBindingDelta`，再由Change Management裁决Compatibility/Migration；Adapter不能静默调整mapping。

## Agent 与 MCP 工具面

日常工具面遵循最小充分原则：

- 精确文件/符号/错误已知时使用native file/search/Git/compiler工具；
- 入口未知或跨文件context任务，最多启用一个daily context Provider；
- canonical architecture、IR、transaction、cross-repo和大型diff任务，按需启用一个architecture Provider；
- taint/data-flow/security使用专门security Provider，普通调用图不能替代；
- Brownfield census可由orchestrator运行多个Provider，但不把全部工具常驻暴露给Agent。

功能重叠的standing MCP不得同时开启。原因包括选择成本、token/延迟、stale状态、冲突答案和把工具共识误当事实。

MCP只暴露最小read/query或显式bounded operation。默认禁止任意shell、rename、write、setup、credential和unbounded query；需要写入时仍经SEC Mutation/transaction或仓库正式开发流程。

具体工具路由、版本和当前启用状态属于external capability ledger和`sec-external-capability-governance` Skill，不复制到本文。

## 集成与吸收

### integrate-provider

通过版本化adapter隔离品牌/格式；保持可替换；保存coverage/freshness/failure；consumer只依赖SEC contract。产品实现Provider进入正式catalog后仍由Implementation Resolution决定是否使用。

### integrate-adapter

Adapter只拥有协议转换、认证、调用和结果归一；不拥有上游canonical语义、最终Implementation Decision、Binding Delta、Compatibility或下游publish decision。

### absorb-design

把经验证的通用算法、状态机或边界提炼到SEC唯一owner；建立自己的types、validator、tests、migration和Evidence；完成consumer迁移后删除重复实现。不得复制许可证不允许的源码，也不得保留品牌数据模型作为隐形Core。

### development / conformance tool

明确不进入产品package、runtime、public API、support claim和用户数据面；锁定依赖与CI/本地入口；退出时删除配置、cache、generated files和Skill路由。

## 版本、升级与 Freshness

Provider版本、Adapter revision、contract revision、source revision、catalog revision和index revision必须分离。工具升级不能沿用旧A/B、安全和兼容结论；至少在重大版本、API/schema/default behavior变化、license/security事件、dependency/runtime变化、stale incident或consumer扩展时重新验证。

Index或缓存必须能证明对应的source revision、coverage和failed regions。无法证明freshness时结果invalidated；不得因查询仍返回内容就视为当前。

自动更新默认禁止用于高权限Provider和merge/release authority。升级先在隔离candidate验证并产生new candidate/Binding；Delta/Impact authority比较old/new Binding，Change Management再裁决Compatibility与Migration。任何一步失败都保留旧validated Binding或明确unsupported，不能由Provider policy静默换版本。

## Failure 与降级

Provider failure不能改变canonical semantics或扩大权限。降级策略必须逐能力定义：

- fallback到更窄可信native能力，但必须作为新的Implementation candidate重新走eligibility；
- 保留unknown并阻止需要完整coverage的操作；
- 使用旧结果但明确invalidated/stale，仅供历史导航；
- Gate要求该Provider时返回unsupported/failed而不是假PASS。

不得用另一个功能相近Provider的成功静默覆盖第一个Provider失败；若组合Evidence，必须保留独立来源和竞争解释。不存在“因为唯一剩余候选所以自动授权”的降级。

## Duplicate Removal

引入外部能力时必须列出：现有重复代码/Skill/MCP/脚本/文档、迁移consumer、parity方法和删除条件。Provider被吸收或替换后，旧entry、config、dependency、generated state、cache、workflow、Skill路由和文档必须退役。

“保留备用”只有在有真实failover contract、独立health/freshness、重新Resolution和定期physical proof时成立；否则是长期双authority和维护负担。

## 退役与替换

触发条件包括重大版本或license变化、安全事件、维护停止、重复stale/错误、原生能力达到parity、无真实consumer、成本超过收益、Provider协议被更好实现替代或数据边界不再可接受。

退役流程：

```text
freeze new use
→ identify consumers, bindings and evidence
→ obtain replacement / unsupported ResolutionDecision
→ generate old/new ImplementationBindingDelta and Impact
→ obtain Compatibility Decision and Migration plan
→ migrate and verify parity
→ remove entry/config/dependency/cache/permissions
→ invalidate old evidence, catalog eligibility and support claims
→ preserve historical decision and incident record
```

退役不要求删除历史Evidence，但历史结果必须明确source revision和invalidated状态。旧Provider被撤销时，现有Binding不得自动改绑；必须由Implementation Resolver产生新的Decision，由Delta/Impact比较，再经过Change Management和Verification。

## 完成判据

一个Provider接入只有在：能力和owner明确、security/license/data review完成、A/B与conformance达到预设判据、adapter fail closed、coverage/freshness可见、consumer迁移、duplicate移除、upgrade/revalidation/retirement闭环并进入clean package/support matrix后，才能被称为正式候选或产品能力。

“可安装”“可类型调用”“用户声明了Effect”“平台推断到候选”“通过conformance”“被Resolver选中”“已发布”“product-supported”必须分别显示，任何一层都不能冒充后一层。
