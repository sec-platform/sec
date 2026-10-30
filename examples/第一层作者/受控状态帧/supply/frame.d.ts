export { };
declare const frameCut: unique symbol;
declare const position: unique symbol;
declare const positionSet: unique symbol;
export interface FrameCut { readonly [frameCut]: never }
export interface Position { readonly [position]: never }
interface PositionSet { readonly [positionSet]: never }
export declare function OwnCells(cut: FrameCut, names: ReadonlyArray<string>): PositionSet;
export declare function ProtectedPositions(cut: FrameCut, allowed: PositionSet): PositionSet;
export declare function UnchangedAt(cut: FrameCut, where: Position): boolean;
