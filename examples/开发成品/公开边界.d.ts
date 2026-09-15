/** Design-only public boundaries for separate products; not executable implementations.
 * Namespaces separate contracts in this document. They are not a shared product runtime.
 * Bigint is exact. Branded identifiers provide typing, never authority or isolation.
 */
export type Int = bigint;
export type Text = string;
export type Bytes = Uint8Array;
export type Ref = string & { readonly __reference: unique symbol };
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
export type FaultCode = 'Cancelled' | 'BudgetExceeded' | 'Closed' | 'Busy' | 'Unauthorized' | 'Conflict' | 'Unavailable' | 'ProtocolFailure' | 'IOFailure' | 'CursorExpired' | 'DeviceLost' | 'Timeout' | 'RemoteFailure' | 'MissingCapability' | 'PluginClosed' | 'InvalidInput' | 'InternalFailure';
export interface Fault { readonly code: FaultCode; readonly message: string; readonly operation?: Ref; }
export interface Interval { readonly lo: Int; readonly hi: Int; }
export interface Reversed { readonly code: 'Reversed'; readonly index: Int; }
export type NormalizeResult = Result<readonly Interval[], Reversed>;
export interface Sample { readonly id: Text; readonly at: Int; readonly v: Int; }
export interface Location { readonly source: Ref; readonly byteStart: Int; readonly byteEnd: Int; }
export interface Diagnostic { readonly code: string; readonly message: string; readonly at: Location; readonly related: readonly Location[]; readonly severity: 'error' | 'warning'; }
export interface OwnedBytes { readonly bytes: Bytes; release(): void; }
export interface Cancellation { readonly requested: boolean; onRequest(listener: () => void): () => void; }
export interface ArtifactMember { readonly path: Text; readonly digest: Text; readonly byteLength: Int; readonly content: Ref; }
export interface Artifact { readonly ref: Ref; readonly members: readonly ArtifactMember[]; readonly imports: readonly Text[]; }
export interface OperationEffect { readonly subject: Ref; readonly state: 'pending' | 'applied' | 'verified' | 'rolled-back' | 'unknown'; readonly receipt?: Ref; }
export interface OperationState { readonly operation: Ref; readonly phase: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'; readonly result?: Ref; readonly effects?: readonly OperationEffect[]; readonly fault?: Fault; }
export interface Closeable { close(): Promise<Result<void, Fault>>; }
export interface ValueLimits { readonly maxInputBytes: Int; readonly maxItems: Int; readonly maxOutputBytes: Int; }

export namespace Definitions {
  interface Package { readonly publicDefinitions: Readonly<Record<Text, Ref>>; readonly authorModules: readonly ArtifactMember[]; readonly interpretation: Ref; }
  function readPackage(bytes: Bytes): Result<Package, { readonly code: 'InvalidPackage' | 'MissingDependency' | 'AmbiguousIdentity'; readonly path: Text }>;
}
export namespace StaticValue {
  interface Config { readonly version: 1; readonly title: Text; readonly historyLimit: Int; }
  function value(): Config;
  function bytes(): Bytes;
}
export namespace Resources {
  interface Resource { readonly path: 'messages.json' | 'theme.css'; readonly bytes: Bytes; readonly digest: Text; }
  function resources(): readonly Resource[];
}
export namespace Expression {
  function scale(x: Int): Int;
}
export namespace ContextPatch {
  interface CapturedFile { readonly path: Text; readonly source: Ref; readonly bytes: Bytes; readonly mode: 'typescript-module'; }
  interface Input { readonly files: readonly CapturedFile[]; readonly declaration: Location; }
  interface Edit { readonly path: Text; readonly before: Ref; readonly after: Bytes; }
  interface Patch { readonly edits: readonly Edit[]; readonly unresolvedConsumers: readonly Text[]; readonly diagnostics: readonly Diagnostic[]; }
  function plan(input: Input): Result<Patch, { readonly code: 'SymbolMissing' | 'NameConflict' | 'InvalidSource' | 'InsufficientContext'; readonly at?: Location }>;
}
export namespace Library { function normalize(items: readonly Interval[]): NormalizeResult; }
export namespace SDK {
  interface Handle extends Closeable { normalize(items: readonly Interval[], options?: { readonly cancel?: Cancellation }): Promise<Result<NormalizeResult, Fault>>; }
  function createNormalizer(): Handle;
}
export namespace ProtocolClient {
  interface Credentials { headers(origin: Text): Promise<Readonly<Record<Text, Text>>>; }
  interface Client extends Closeable { normalize(items: readonly Interval[], options?: { readonly cancel?: Cancellation }): Promise<Result<NormalizeResult, Fault>>; }
  function createClient(options: { readonly baseURL: Text; readonly credentials?: Credentials; readonly limits: ValueLimits }): Result<Client, Fault>;
}
export namespace Command {
  interface StdIO { read(): Promise<Bytes | null>; writeStdout(data: Bytes): Promise<number>; writeStderr(data: Bytes): Promise<number>; }
  function main(argv: readonly Text[], io: StdIO, limits: ValueLimits, cancel: Cancellation): Promise<number>;
}
export namespace BatchCommand {
  function main(argv: readonly Text[], io: Command.StdIO, limits: ValueLimits, cancel: Cancellation): Promise<number>;
}
export namespace HttpHandler {
  interface Request { readonly id: Ref; readonly method: Text; readonly path: Text; readonly query: Text; readonly headers: Readonly<Record<Text, Text>>; readonly body: AsyncIterable<Bytes>; readonly cancel: Cancellation; }
  interface Response { readonly status: number; readonly headers: Readonly<Record<Text, Text>>; readonly body: Bytes; }
  function handle(request: Request, limits: ValueLimits): Promise<Result<Response, Fault>>;
}
export namespace Service {
  interface Listener extends Closeable { readonly origin: Text; }
  interface ListenPort { listen(options: { readonly loopback: true; readonly port: number }, handler: (request: HttpHandler.Request) => Promise<HttpHandler.Response>): Promise<Result<Listener, Fault>>; }
  interface Handle extends Closeable { readonly origin: Text; readonly state: 'listening' | 'draining' | 'closed'; }
  function start(port: ListenPort, runtime: { readonly limits: ValueLimits; readonly drainTimeoutMs: Int }): Promise<Result<Handle, Fault>>;
}
export namespace Worker {
  type WireIntervals = readonly { readonly lo: Text; readonly hi: Text }[];
  type Input = { readonly id: Text; readonly items: WireIntervals } | { readonly control: 'close'; readonly id: Text };
  type Output = { readonly id: Text; readonly ok: true; readonly value: WireIntervals } | { readonly id: Text; readonly ok: false; readonly error: { readonly code: "Reversed"; readonly index: Text } } | { readonly id: Text; readonly fault: Fault } | { readonly protocolError: { readonly code: 'Busy' | 'DuplicateActive' | 'InvalidRequest' | 'Closing'; readonly id?: Text } } | { readonly controlResult: 'closed'; readonly id: Text };
  interface Handle extends Closeable { readonly state: 'open' | 'closing' | 'closed'; receive(message: Input): void; }
  function start(emit: (output: Output) => void, limits: ValueLimits): Handle;
}
export namespace Component {
  interface Handle { normalize(items: readonly Interval[]): NormalizeResult; release(): void; }
  function instantiate(): Result<Handle, Fault>;
}
export namespace Plugin {
  interface Handle extends Closeable { readonly interfaceVersion: 'normalization.plugin/1'; normalize(items: readonly Interval[]): Promise<Result<NormalizeResult, Fault>>; }
  function createPlugin(): Result<Handle, Fault>;
}
export namespace Interaction {
  type Phase = 'editing' | 'running' | 'succeeded' | 'rejected' | 'cancelled';
  interface Model { readonly input: Text; readonly inputRevision: Int; readonly phase: Phase; readonly request?: Ref; readonly result?: { readonly inputRevision: Int; readonly text: Text }; readonly fault?: Fault; readonly validationError?: { readonly code: 'InvalidInput' | 'Reversed'; readonly index?: Int; readonly message: Text }; }
  type Action = { readonly type: 'input'; readonly text: Text; readonly composing: boolean } | { readonly type: 'run' | 'cancel' | 'reset' };
  interface Presenter extends Closeable { dispatch(action: Action): void; snapshot(): Model; }
}
export namespace WebPanel { function mount(element: HTMLElement): Result<Interaction.Presenter, Fault>; }
export namespace Desktop {
  interface DocumentFile { readonly identity: Ref; readonly stamp: Ref; readonly bytes: Bytes; }
  interface Files { open(): Promise<DocumentFile | null>; save(expected: { readonly identity: Ref; readonly stamp: Ref } | null, bytes: Bytes): Promise<Result<DocumentFile, Fault>>; }
  type FileOutcome = { readonly kind: 'no-change' | 'opened' | 'saved' } | { readonly kind: 'failed'; readonly fault: Fault };
  type CloseOutcome = { readonly kind: 'closed' } | { readonly kind: 'cancelled' } | { readonly kind: 'blocked'; readonly fault: Fault };
  interface Handle extends Interaction.Presenter {
    open(): Promise<FileOutcome>;
    saveInput(options?: { readonly saveAs?: boolean }): Promise<FileOutcome>;
    saveResult(options?: { readonly saveAs?: boolean }): Promise<FileOutcome>;
    requestClose(): Promise<CloseOutcome>;
  }
  function start(files: Files): Result<Handle, Fault>;
}
export namespace Mobile {
  interface DraftStore { load(): Promise<Result<{ readonly generation: Ref; readonly text: Text } | null, Fault>>; save(expected: Ref | null, text: Text): Promise<Result<Ref, Fault>>; }
  interface Handle extends Desktop.Handle { suspend(): Promise<Result<void, Fault>>; resume(): Promise<Result<void, Fault>>; }
  function start(drafts: DraftStore, files: Desktop.Files): Promise<Result<Handle, Fault>>;
}
export namespace Family {
  interface Release { readonly library: Artifact; readonly command: Artifact; readonly web: Artifact; readonly sharedBehavior: Ref; }
  function compose(parts: Release): Result<Artifact, { readonly code: 'MissingMember' | 'IncompatibleSharedBehavior' | 'PathConflict' }>;
}
export namespace Query {
  interface Page { readonly items: readonly Sample[]; readonly next?: Ref; readonly complete: boolean; }
  interface Handle extends Closeable { next(cursor?: Ref): Promise<Result<Page, Fault>>; }
  function open(samples: readonly Sample[], range?: { readonly from: Int; readonly to: Int }): Result<Handle, Fault>;
}
export namespace BatchData {
  interface InputShard { readonly content: Ref; readonly firstPosition: Int; readonly count: Int; readonly positionStep: Int; }
  interface DataSet { readonly manifest: Ref; readonly shards: readonly InputShard[]; }
  function run(input: DataSet, cancel: Cancellation): Promise<Result<DataSet, Fault>>;
}
export namespace WindowStream {
  type Message = { readonly kind: 'data'; readonly partition: Ref; readonly epoch: Int; readonly seq: Int; readonly sample: Sample } | { readonly kind: 'frontier'; readonly partition: Ref; readonly epoch: Int; readonly throughSeq: Int; readonly lowerBound: Int } | { readonly kind: 'end'; readonly partition: Ref; readonly epoch: Int; readonly throughSeq: Int } | { readonly kind: 'members'; readonly previousEpoch: Int; readonly epoch: Int; readonly members: readonly { readonly partition: Ref; readonly nextSeq: Int; readonly lowerBound: Int }[]; readonly barrier: Ref };
  type Output = { readonly kind: 'final'; readonly start: Int; readonly end: Int; readonly count: Int; readonly sumMilliVolt: Int; readonly outputId: Ref } | { readonly kind: 'rejected'; readonly code: 'LateRejected' | 'ProtocolConflict'; readonly partition: Ref; readonly seq: Int };
  interface Checkpoint { readonly ref: Ref; readonly source: Ref; readonly memberEpoch: Int; readonly windowMs: Int; readonly acknowledgedThrough: Ref | null; }
  interface Checkpoints { write(bytes: Bytes): Promise<Ref>; read(ref: Ref): Promise<Bytes>; }
  interface Subscription extends Closeable {
    request(count: Int): void;
    acknowledge(outputId: Ref, receipt: Ref): Promise<Result<void, Fault>>;
    checkpoint(store: Checkpoints): Promise<Checkpoint>;
    cancel(): void;
  }
  interface Observer { next(output: Output): void; error(fault: Fault): void; complete(): void; }
  function connect(input: AsyncIterable<Message>, observer: Observer, restore?: { readonly checkpoint: Checkpoint; readonly store: Checkpoints }): Promise<Result<Subscription, Fault>>;
}
export namespace Migration {
  interface V1 { readonly id: Text; readonly tSec: Text; readonly valueMilliVolt: Text; }
  interface V2 { readonly id: Text; readonly at: Text; readonly v: Text; }
  interface Plan { readonly ref: Ref; readonly before: Ref; readonly after: Ref; readonly items: Int; readonly needsWriteBarrier: true; }
  function transform(items: readonly V1[]): Result<readonly V2[], { readonly code: 'InvalidInput' | 'DuplicateId'; readonly index: Int }>;
  function planMigration(source: Ref, targetSchema: Ref): Promise<Result<Plan, Fault>>;
  function applyMigration(plan: Plan, targetStore: Ref, authorization: Ref): Promise<OperationState>;
  function inspect(operation: Ref): Promise<OperationState>;
  function reverse(items: readonly V2[]): Result<readonly V1[], { readonly code: 'NonIntegralSeconds' | 'InvalidInput' | 'DuplicateId'; readonly index: Int }>;
}
export namespace ThresholdRules {
  interface Rule { readonly name: Text; readonly limit: Int; }
  interface Model { readonly version: 1; readonly rules: readonly Rule[]; }
}
export namespace Compiler {
  interface Input { readonly identity: Ref; readonly bytes: Bytes; }
  type Rejection = { readonly diagnostics: readonly Diagnostic[] };
  type Output = Result<Artifact, Rejection | Fault>;
  function compile(input: Input): Output;
}
export namespace Analyzer {
  interface Report { readonly source: Ref; readonly complete: boolean; readonly diagnostics: readonly Diagnostic[]; }
  function analyze(input: Compiler.Input): Result<Report, Fault>;
}
export namespace Generator { function generate(input: Compiler.Input): Compiler.Output; }
export namespace Inference {
  function score(x: readonly Int[]): Result<Int, { readonly code: 'ShapeMismatch'; readonly expected: Int; readonly actual: Int } | Fault>;
}
export namespace Trainer {
  interface Rational { readonly num: Text; readonly den: Text; }
  interface TrainingData { readonly X: readonly (readonly Rational[])[]; readonly y: readonly Rational[]; readonly identity: Ref; }
  interface Model { readonly theta: readonly Rational[]; readonly objective: Rational; readonly input: Ref; readonly regularization: Int; }
  function train(data: TrainingData, cancel: Cancellation): Promise<Result<Model, Fault>>;
}
export namespace Sampler {
  interface FairBits { next(): Promise<Result<0 | 1, Fault>>; }
  function sample(count: Int, source: FairBits, cancel: Cancellation): Promise<Result<readonly boolean[], Fault>>;
}
export namespace Optimizer {
  interface Candidate { readonly id: Text; readonly feasible: boolean; readonly cost: Int; }
  type Answer = { readonly kind: 'optimal'; readonly id: Text; readonly position: Int; readonly cost: Int; readonly domain: Ref } | { readonly kind: 'none'; readonly domain: Ref };
  function choose(candidates: readonly Candidate[], cancel?: Cancellation): Result<Answer, Fault>;
}
export namespace GpuKernel {
  interface InputView { readonly allocation: Ref; readonly offsetBytes: Int; readonly count: Int; readonly strideBytes: Int; }
  type KernelError = { readonly code: 'OutOfRange'; readonly index: Int } | Fault;
  interface Job { readonly result: Promise<Result<OwnedBytes, KernelError>>; cancel(): void; }
  function submit(input: InputView, device: Ref): Result<Job, Fault>;
}
export namespace Firmware {
  type State = 'off' | 'on' | 'fault-off';
  type Input = { readonly kind: 'sample'; readonly milliVolt: Int; readonly fresh: boolean } | { readonly kind: 'sensor-fault' | 'watchdog' } | { readonly kind: 'reset-fault'; readonly milliVolt: Int; readonly fresh: boolean };
  interface Machine { readonly state: State; }
  interface Observation { readonly state: State; readonly driveOn: boolean; readonly diagnostic?: 'StaleSample' | 'SensorFault' | 'Watchdog' | 'ResetRejected'; }
  interface Step { readonly machine: Machine; readonly observation: Observation; }
  function initial(): Machine;
  function step(machine: Machine, input: Input): Step;
}
export namespace RealTime {
  interface Timing { readonly periodUs: Int; readonly deadlineUs: Int; }
  interface EnvironmentBounds { readonly executionBoundUs: Int; readonly blockingBoundUs: Int; readonly higherPriority: readonly { readonly periodUs: Int; readonly executionBoundUs: Int }[]; }
  type Admission = { readonly accepted: true; readonly responseBoundUs: Int } | { readonly accepted: false; readonly reason: 'MissingBound' | 'DeadlineExceeded' | 'IncompatibleModel' };
  interface Driver { sample(): Promise<Result<{ readonly milliVolt: Int; readonly fresh: boolean }, Fault>>; drive(on: boolean): Promise<Result<void, Fault>>; faultOff(fault: Fault): Promise<void>; }
  interface Scheduler { start(timing: Timing, bounds: EnvironmentBounds, release: (releaseUs: Int) => Promise<void>): Promise<Result<Closeable, Fault>>; nowUs(): Int; }
  interface Environment { readonly scheduler: Scheduler; readonly bounds: EnvironmentBounds; }
  interface Handle extends Closeable { readonly timing: Timing; readonly admission: Admission; readonly state: Firmware.State; }
  function admit(bounds: EnvironmentBounds): Admission; // period/deadline are compiled product intent and are not caller overrides.
  function start(environment: Environment, driver: Driver): Promise<Result<Handle, Fault>>;
}
export namespace Installer {
  interface Intent { readonly artifact: Ref; readonly installation: Ref; readonly expectedActive: Ref | null; readonly authorization: Ref; }
  function install(intent: Intent): Promise<OperationState>;
  function uninstall(installation: Ref, expectedActive: Ref, authorization: Ref): Promise<OperationState>;
  function rollback(installation: Ref, expectedActive: Ref, retainedArtifact: Ref, authorization: Ref): Promise<OperationState>;
  function inspect(operation: Ref): Promise<OperationState>;
}
export namespace Deployment {
  interface Intent { readonly artifact: Ref; readonly nodes: readonly Ref[]; readonly expectedConfiguration: Ref; readonly runtimeConfiguration: Ref; readonly authorization: Ref; }
  function deploy(intent: Intent): Promise<OperationState>;
  function drain(instance: Ref, authorization: Ref): Promise<OperationState>;
  function remove(instance: Ref, expectedArtifact: Ref, authorization: Ref): Promise<OperationState>;
  function inspect(operation: Ref): Promise<OperationState>;
}
export namespace NativeChange {
  interface ResultSet { readonly source: ContextPatch.Patch; readonly checks: readonly Ref[]; readonly unverified: readonly Text[]; }
  function propose(input: ContextPatch.Input): Promise<Result<ResultSet, Fault>>;
}
