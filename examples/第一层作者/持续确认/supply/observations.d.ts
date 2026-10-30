declare const retainedCut: unique symbol;
export interface SessionCut { readonly [retainedCut]: never }
type Reading = { readonly clock: string; readonly nanoseconds: bigint };
type Pair = { readonly person: bigint; readonly shift: bigint };
type Content = ReadonlyArray<Pair>;
type Edit = { readonly id: bigint; readonly ordinal: bigint; readonly at: Reading;
  readonly revision: bigint; readonly content: Content };
type Preview = { readonly id: bigint; readonly ordinal: bigint; readonly at: Reading;
  readonly editId: bigint; readonly revision: bigint; readonly content: Content };
type Confirmation = { readonly id: bigint; readonly ordinal: bigint; readonly at: Reading;
  readonly previewId: bigint };
type Application = { readonly id: bigint; readonly ordinal: bigint; readonly at: Reading;
  readonly confirmationId: bigint; readonly revision: bigint;
  readonly documentRevisionAfter: bigint };
export declare function EditsAt(cut: SessionCut): ReadonlyArray<Edit>;
export declare function PreviewsAt(cut: SessionCut): ReadonlyArray<Preview>;
export declare function ConfirmationsAt(cut: SessionCut): ReadonlyArray<Confirmation>;
export declare function ApplicationsAt(cut: SessionCut): ReadonlyArray<Application>;
export { };
