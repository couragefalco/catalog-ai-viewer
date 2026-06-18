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
});
