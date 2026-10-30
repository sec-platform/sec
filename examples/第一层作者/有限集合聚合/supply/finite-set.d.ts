export { };
declare const finiteSetView: unique symbol;
interface FiniteSet<T> { readonly [finiteSetView]: T }
export declare function FoldMap<T, M>(
  items: FiniteSet<T>, empty: M,
  combine: (left: M, right: M) => M,
  project: (item: T) => M
): M;
