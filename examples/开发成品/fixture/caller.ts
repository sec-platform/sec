import { normalize } from "./normalize.js";
export const check = () => normalize(1n) === 1n;
