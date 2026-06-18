import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE_NAME = "cat_admin";
const PAYLOAD = "admin";

function hmac(value: string): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET must be set");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  return safeEqual(input, expected);
}

export function signSession(): string {
  return `${PAYLOAD}.${hmac(PAYLOAD)}`;
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (payload !== PAYLOAD || !sig) return false;
  return safeEqual(sig, hmac(PAYLOAD));
}

export async function requireAdmin(): Promise<boolean> {
  const store = await cookies();
  return isValidSession(store.get(COOKIE_NAME)?.value);
}
