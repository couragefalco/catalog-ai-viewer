import { describe, it, expect, beforeAll } from "vitest";
import { signSession, isValidSession, checkPassword } from "../lib/admin-auth";

beforeAll(() => {
  process.env.ADMIN_SECRET = "test-secret";
  process.env.ADMIN_PASSWORD = "hunter2";
});

describe("admin-auth", () => {
  it("accepts a self-signed session", () => {
    expect(isValidSession(signSession())).toBe(true);
  });
  it("rejects a tampered token", () => {
    expect(isValidSession(signSession() + "x")).toBe(false);
  });
  it("rejects undefined", () => {
    expect(isValidSession(undefined)).toBe(false);
  });
  it("checks the password", () => {
    expect(checkPassword("hunter2")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
  });
  it("rejects a token with extra segments", () => {
    expect(isValidSession(signSession() + ".extra")).toBe(false);
  });
  it("rejects an empty password", () => {
    expect(checkPassword("")).toBe(false);
  });
  it("throws when ADMIN_SECRET is missing", () => {
    const saved = process.env.ADMIN_SECRET;
    delete process.env.ADMIN_SECRET;
    expect(() => signSession()).toThrow();
    process.env.ADMIN_SECRET = saved;
  });
});
