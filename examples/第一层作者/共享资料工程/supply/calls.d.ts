// retained-call.d.ts -- declaration-only; requires the accompanying qualified profile
declare const retained: unique symbol;
export interface RetainedCall { readonly [retained]: never }

// These native header aliases are mapped to the exact Gift declarations below.
type Rows = ReadonlyArray<{ readonly score: bigint; readonly text: string }>;
type OperationSelector = {
  readonly componentPath: ReadonlyArray<string>;
  readonly port: string;
  readonly operation: string;
};
type ConstructorSelector = { readonly moduleId: string; readonly definition: string; readonly constructor: string };
type ErrorConstructorMap = ReadonlyArray<{
  readonly from: ConstructorSelector;
  readonly to: ConstructorSelector;
}>;

export declare function SourceRows(c: RetainedCall, endpoint: OperationSelector): ReadonlyArray<Rows>;
export declare function Forwarded(c: RetainedCall, endpoint: OperationSelector, errors: ErrorConstructorMap): boolean;
export declare function NoMemberInteraction(c: RetainedCall): boolean;
export declare function SourceBorrowSettled(c: RetainedCall, endpoint: OperationSelector): boolean;
export declare function EntryCustodySettled(c: RetainedCall): boolean;
export { };
