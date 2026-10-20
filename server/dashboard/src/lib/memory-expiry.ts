import { Memory } from "@/types/api";

/** Today as YYYY-MM-DD in UTC, the day the server compares expiration dates against. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The memory's expiration date (YYYY-MM-DD), wherever the listing put it. */
export function expiryOf(memory: Memory): string | null {
  const value = memory.expiration_date ?? memory.metadata?.expiration_date;
  return typeof value === "string" && value ? value.slice(0, 10) : null;
}

/** Expired once its date is before today; it stays visible through the whole day itself. */
export function isExpired(memory: Memory): boolean {
  const expiry = expiryOf(memory);
  return expiry !== null && expiry < todayUtc();
}
