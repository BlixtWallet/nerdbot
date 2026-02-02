import { test, expect, describe, afterEach, mock } from "bun:test";
import {
  downloadTelegramFile,
  getFile,
  sendChatAction,
  sendMessage,
  setWebhook,
} from "../../convex/lib/telegramApi";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOk(responseBody: unknown = { ok: true }) {
  const fn = mock(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseBody),
      text: () => Promise.resolve(JSON.stringify(responseBody)),
    } as Response),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchBinary(content: Uint8Array, contentType = "image/jpeg") {
  const fn = mock(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": contentType }),
      arrayBuffer: () =>
        Promise.resolve(
          content.buffer.slice(
            content.byteOffset,
            content.byteOffset + content.byteLength,
          ),
        ),
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({}),
    } as Response),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchError(status: number, errorText: string) {
  const fn = mock(() =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(errorText),
    } as Response),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function getCallArgs(fn: ReturnType<typeof mock>): [string, RequestInit] {
  const call = fn.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  return call as unknown as [string, RequestInit];
}

function getCallBody(fn: ReturnType<typeof mock>) {
  const [, options] = getCallArgs(fn);
  return JSON.parse(options.body as string);
}

describe("sendMessage", () => {
  test("calls correct Telegram API URL", async () => {
    const fetchMock = mockFetchOk();

    await sendMessage("TOKEN123", 456, "Hello");

    const [url] = getCallArgs(fetchMock);
    expect(url).toBe("https://api.telegram.org/botTOKEN123/sendMessage");
  });

  test("sends chat_id and text in body", async () => {
    const fetchMock = mockFetchOk();

    await sendMessage("token", 789, "Test message");

    const body = getCallBody(fetchMock);
    expect(body.chat_id).toBe(789);
    expect(body.text).toBe("Test message");
  });

  test("includes message_thread_id when provided", async () => {
    const fetchMock = mockFetchOk();

    await sendMessage("token", 789, "Test", { messageThreadId: 42 });

    const body = getCallBody(fetchMock);
    expect(body.message_thread_id).toBe(42);
  });

  test("omits message_thread_id when not provided", async () => {
    const fetchMock = mockFetchOk();

    await sendMessage("token", 789, "Test");

    const body = getCallBody(fetchMock);
    expect(body.message_thread_id).toBeUndefined();
  });

  test("includes reply_parameters when replyToMessageId set", async () => {
    const fetchMock = mockFetchOk();

    await sendMessage("token", 789, "Reply", { replyToMessageId: 100 });

    const body = getCallBody(fetchMock);
    expect(body.reply_parameters).toEqual({ message_id: 100 });
  });

  test("includes parse_mode when set", async () => {
    const fetchMock = mockFetchOk();

    await sendMessage("token", 789, "<b>Bold</b>", { parseMode: "HTML" });

    const body = getCallBody(fetchMock);
    expect(body.parse_mode).toBe("HTML");
  });

  test("passes all options together", async () => {
    const fetchMock = mockFetchOk();

    await sendMessage("token", 789, "Full", {
      replyToMessageId: 100,
      messageThreadId: 42,
      parseMode: "MarkdownV2",
    });

    const body = getCallBody(fetchMock);
    expect(body.message_thread_id).toBe(42);
    expect(body.reply_parameters).toEqual({ message_id: 100 });
    expect(body.parse_mode).toBe("MarkdownV2");
  });

  test("throws on API error", async () => {
    mockFetchError(403, "Forbidden: bot was blocked");

    await expect(sendMessage("token", 789, "Hi")).rejects.toThrow(
      "Telegram API error: 403 - Forbidden: bot was blocked",
    );
  });
});

describe("sendChatAction", () => {
  test("calls correct URL with typing action", async () => {
    const fetchMock = mockFetchOk();

    await sendChatAction("TOKEN", 123);

    const [url] = getCallArgs(fetchMock);
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendChatAction");
    const body = getCallBody(fetchMock);
    expect(body.chat_id).toBe(123);
    expect(body.action).toBe("typing");
  });

  test("includes message_thread_id when provided", async () => {
    const fetchMock = mockFetchOk();

    await sendChatAction("TOKEN", 123, "typing", 55);

    const body = getCallBody(fetchMock);
    expect(body.message_thread_id).toBe(55);
  });

  test("omits message_thread_id when not provided", async () => {
    const fetchMock = mockFetchOk();

    await sendChatAction("TOKEN", 123);

    const body = getCallBody(fetchMock);
    expect(body.message_thread_id).toBeUndefined();
  });
});

describe("setWebhook", () => {
  test("calls correct URL with webhook config", async () => {
    const fetchMock = mockFetchOk({ ok: true, result: true });

    const result = await setWebhook("TOKEN", "https://example.com/webhook", "secret123");

    const [url] = getCallArgs(fetchMock);
    expect(url).toBe("https://api.telegram.org/botTOKEN/setWebhook");
    const body = getCallBody(fetchMock);
    expect(body.url).toBe("https://example.com/webhook");
    expect(body.secret_token).toBe("secret123");
    expect(body.allowed_updates).toEqual(["message"]);
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("getFile", () => {
  test("calls getFile API and returns file info", async () => {
    const fetchMock = mockFetchOk({
      ok: true,
      result: { file_path: "photos/file.jpg", file_size: 1234 },
    });

    const result = await getFile("TOKEN123", "file-id");

    const [url] = getCallArgs(fetchMock);
    expect(url).toBe("https://api.telegram.org/botTOKEN123/getFile");
    const body = getCallBody(fetchMock);
    expect(body.file_id).toBe("file-id");
    expect(result).toEqual({ file_path: "photos/file.jpg", file_size: 1234 });
  });
});

describe("downloadTelegramFile", () => {
  test("downloads file bytes and content type", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchMock = mockFetchBinary(bytes, "image/png");

    const result = await downloadTelegramFile("TOKEN123", "photos/file.jpg");

    const [url] = getCallArgs(fetchMock);
    expect(url).toBe("https://api.telegram.org/file/botTOKEN123/photos/file.jpg");
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.contentType).toBe("image/png");
  });
});
