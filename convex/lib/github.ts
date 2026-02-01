export interface GitHubIssue {
  html_url: string;
  number: number;
  title: string;
}

export async function createGitHubIssue(
  token: string,
  repo: string,
  title: string,
  body: string,
): Promise<GitHubIssue> {
  const url = `https://api.github.com/repos/${repo}/issues`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nerdbot",
    },
    body: JSON.stringify({ title, body }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<GitHubIssue>;
}
