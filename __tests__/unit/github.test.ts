import { test, expect, describe, afterEach, mock } from "bun:test";
import { createGitHubIssue } from "../../convex/lib/github";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOk(responseBody: unknown) {
  const fn = mock(() =>
    Promise.resolve({
      ok: true,
      status: 201,
      json: () => Promise.resolve(responseBody),
      text: () => Promise.resolve(JSON.stringify(responseBody)),
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

function getCallHeaders(fn: ReturnType<typeof mock>) {
  const [, options] = getCallArgs(fn);
  return options.headers as Record<string, string>;
}

const issueResponse = {
  html_url: "https://github.com/owner/repo/issues/42",
  number: 42,
  title: "Bug: login fails",
};

describe("createGitHubIssue", () => {
  test("calls correct GitHub API URL", async () => {
    const fetchMock = mockFetchOk(issueResponse);

    await createGitHubIssue("ghp_token", "owner/repo", "Bug", "Description");

    const [url] = getCallArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/owner/repo/issues");
  });

  test("sends Authorization Bearer header", async () => {
    const fetchMock = mockFetchOk(issueResponse);

    await createGitHubIssue("ghp_mytoken123", "owner/repo", "Bug", "Desc");

    const headers = getCallHeaders(fetchMock);
    expect(headers.Authorization).toBe("Bearer ghp_mytoken123");
  });

  test("includes required GitHub headers", async () => {
    const fetchMock = mockFetchOk(issueResponse);

    await createGitHubIssue("token", "owner/repo", "Bug", "Desc");

    const headers = getCallHeaders(fetchMock);
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(headers["User-Agent"]).toBe("nerdbot");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("sends title and body in request body", async () => {
    const fetchMock = mockFetchOk(issueResponse);

    await createGitHubIssue("token", "owner/repo", "My Title", "My Body");

    const body = getCallBody(fetchMock);
    expect(body.title).toBe("My Title");
    expect(body.body).toBe("My Body");
  });

  test("returns parsed issue response", async () => {
    mockFetchOk(issueResponse);

    const result = await createGitHubIssue("token", "owner/repo", "Bug", "Desc");

    expect(result.html_url).toBe("https://github.com/owner/repo/issues/42");
    expect(result.number).toBe(42);
    expect(result.title).toBe("Bug: login fails");
  });

  test("throws on 401 unauthorized", async () => {
    mockFetchError(401, "Bad credentials");

    await expect(
      createGitHubIssue("bad_token", "owner/repo", "Bug", "Desc"),
    ).rejects.toThrow("GitHub API error: 401 - Bad credentials");
  });

  test("throws on 404 repo not found", async () => {
    mockFetchError(404, "Not Found");

    await expect(
      createGitHubIssue("token", "owner/nonexistent", "Bug", "Desc"),
    ).rejects.toThrow("GitHub API error: 404 - Not Found");
  });

  test("throws on 422 validation failed", async () => {
    mockFetchError(422, "Validation Failed");

    await expect(createGitHubIssue("token", "owner/repo", "", "Desc")).rejects.toThrow(
      "GitHub API error: 422 - Validation Failed",
    );
  });

  test("uses POST method", async () => {
    const fetchMock = mockFetchOk(issueResponse);

    await createGitHubIssue("token", "owner/repo", "Bug", "Desc");

    const [, options] = getCallArgs(fetchMock);
    expect(options.method).toBe("POST");
  });
});
