export { };
declare const historicalPoint: unique symbol;
declare const boundaryCut: unique symbol;
declare const stateCut: unique symbol;
export interface HistoricalPoint { readonly [historicalPoint]: never }
export interface BoundaryCut { readonly [boundaryCut]: never }
export interface StateCut { readonly [stateCut]: never }
interface State { readonly closed: boolean }
export declare function BeforePoints(cut: BoundaryCut): ReadonlyArray<HistoricalPoint>;
export declare function AfterPoints(cut: BoundaryCut): ReadonlyArray<HistoricalPoint>;
export declare function OneState(cut: StateCut): ReadonlyArray<State>;
