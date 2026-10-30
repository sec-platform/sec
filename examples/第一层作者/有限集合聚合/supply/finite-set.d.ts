export { };
declare const finiteSetView: unique symbol;
interface FiniteSet<T> { readonly [finiteSetView]: T }
export declare function FromSequenceWith<T>(
  items: ReadonlyArray<T>, equal: (left: T, right: T) => boolean
): FiniteSet<T>;
export declare function UnionWith<T>(
  left: FiniteSet<T>, right: FiniteSet<T>,
  equal: (left: T, right: T) => boolean
): FiniteSet<T>;
export declare function FoldMap<T, M>(
  items: FiniteSet<T>, empty: M,
  combine: (left: M, right: M) => M,
  project: (item: T) => M
): M;
