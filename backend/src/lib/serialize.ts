import { Prisma } from "@prisma/client";

export const wrap = (value: unknown): unknown => {
  if (value instanceof Prisma.Decimal) return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Number) return Number(value);
  if (value instanceof String) return String(value);
  if (Array.isArray(value)) return value.map(wrap);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, wrap(nested)]));
  }
  return value;
};
