import { test, expect, afterEach } from "bun:test";
import { readOptionalThinkingEnv, requireEnv } from "../../convex/lib/env";

afterEach(() => {
  delete process.env.TEST_ENV_VAR;
  delete process.env.TEST_THINKING_ENV;
});

test("requireEnv returns value when set", () => {
  process.env.TEST_ENV_VAR = "hello";
  expect(requireEnv("TEST_ENV_VAR")).toBe("hello");
});

test("requireEnv throws when variable is missing", () => {
  expect(() => requireEnv("NONEXISTENT_VAR_12345")).toThrow(
    "Missing required environment variable: NONEXISTENT_VAR_12345",
  );
});

test("requireEnv throws when variable is empty string", () => {
  process.env.TEST_ENV_VAR = "";
  expect(() => requireEnv("TEST_ENV_VAR")).toThrow(
    "Missing required environment variable: TEST_ENV_VAR",
  );
});

test("readOptionalThinkingEnv defaults to disabled when not set", () => {
  expect(readOptionalThinkingEnv("TEST_THINKING_ENV")).toBe("disabled");
});

test("readOptionalThinkingEnv accepts valid values", () => {
  process.env.TEST_THINKING_ENV = "disabled";
  expect(readOptionalThinkingEnv("TEST_THINKING_ENV")).toBe("disabled");
  process.env.TEST_THINKING_ENV = "enabled";
  expect(readOptionalThinkingEnv("TEST_THINKING_ENV")).toBe("enabled");
  process.env.TEST_THINKING_ENV = "auto";
  expect(readOptionalThinkingEnv("TEST_THINKING_ENV")).toBe("auto");
});

test("readOptionalThinkingEnv is case-insensitive and trims", () => {
  process.env.TEST_THINKING_ENV = "  DISABLED  ";
  expect(readOptionalThinkingEnv("TEST_THINKING_ENV")).toBe("disabled");
});

test("readOptionalThinkingEnv throws on invalid value", () => {
  process.env.TEST_THINKING_ENV = "maybe";
  expect(() => readOptionalThinkingEnv("TEST_THINKING_ENV")).toThrow(
    "Invalid value for environment variable: TEST_THINKING_ENV.",
  );
});
