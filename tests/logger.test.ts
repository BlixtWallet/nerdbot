import { test, expect, describe, afterEach } from "bun:test";
import { Logger, createLogger } from "../convex/lib/logger";

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

function captureOutput(method: "log" | "warn" | "error"): {
  getOutput: () => Record<string, unknown>;
} {
  let captured = "";
  const fn = (msg: string) => {
    captured = msg;
  };
  if (method === "log") console.log = fn;
  else if (method === "warn") console.warn = fn;
  else console.error = fn;
  return {
    getOutput: () => JSON.parse(captured) as Record<string, unknown>,
  };
}

describe("Logger", () => {
  test("info() emits JSON to console.log", () => {
    const { getOutput } = captureOutput("log");

    new Logger().set("event", "test").set("key", "value").info();

    const output = getOutput();
    expect(output.event).toBe("test");
    expect(output.key).toBe("value");
  });

  test("warn() emits JSON to console.warn", () => {
    const { getOutput } = captureOutput("warn");

    new Logger().set("event", "test").warn();

    expect(getOutput().event).toBe("test");
  });

  test("error() emits JSON to console.error", () => {
    const { getOutput } = captureOutput("error");

    new Logger().set("event", "test").error();

    expect(getOutput().event).toBe("test");
  });

  test("set() is chainable and supports all value types", () => {
    const { getOutput } = captureOutput("log");

    new Logger().set("a", 1).set("b", "two").set("c", true).set("d", null).info();

    const output = getOutput();
    expect(output.a).toBe(1);
    expect(output.b).toBe("two");
    expect(output.c).toBe(true);
    expect(output.d).toBeNull();
  });

  test("later set() overwrites earlier values", () => {
    const { getOutput } = captureOutput("log");

    new Logger().set("key", "first").set("key", "second").info();

    expect(getOutput().key).toBe("second");
  });

  test("undefined values are excluded from JSON", () => {
    const { getOutput } = captureOutput("log");

    new Logger().set("present", "yes").set("missing", undefined).info();

    const output = getOutput();
    expect(output.present).toBe("yes");
    expect("missing" in output).toBe(false);
  });
});

describe("createLogger", () => {
  test("creates logger with event field pre-set", () => {
    const { getOutput } = captureOutput("log");

    createLogger("webhook").set("userId", 123).info();

    const output = getOutput();
    expect(output.event).toBe("webhook");
    expect(output.userId).toBe(123);
  });
});
