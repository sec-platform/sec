/** Design declarations only. Exact interpretation: declaration-profile.md. */
export { };
declare const passive: unique symbol;

/** Retained view of a passive host value; the brand is not a host property. */
export interface TargetPassiveValue { readonly [passive]: never; }

/** Zero or one admitted dense array; an admitted empty array is [[]]. */
export declare function DenseArrays(value: TargetPassiveValue): readonly (readonly TargetPassiveValue[])[];
/** Zero or one own data-field value, without prototype lookup or coercion. */
export declare function FieldValues(value: TargetPassiveValue, key: string): readonly TargetPassiveValue[];
/** Exact own data-key set; symbol and non-enumerable extra keys count. */
export declare function HasExactlyKeys(value: TargetPassiveValue, keys: readonly string[]): boolean;
/** Zero or one mathematical integer, from primitive finite integral Number only. */
export declare function NumberIntegers(value: TargetPassiveValue): readonly bigint[];
/** Zero or one Text, rejecting unpaired UTF-16 surrogates without replacement. */
export declare function ScalarTexts(value: TargetPassiveValue): readonly string[];
/** Exact scalar count on already admitted Text, not code-unit or grapheme count. */
export declare function ScalarLength(value: string): bigint;
