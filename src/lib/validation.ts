export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function numericParam(value: string | null, fallback = NaN): number {
  if (value === null) return fallback;
  return value.trim() === "" ? NaN : Number(value);
}
