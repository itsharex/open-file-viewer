/**
 * Live GitHub star count for every `[data-gh-stars]` badge on the page.
 * Results are cached in localStorage for an hour so casual navigation
 * doesn't burn through the unauthenticated GitHub API rate limit.
 * On any failure the badges simply stay hidden.
 */

const REPO = "xushanpei/open-file-viewer";
const CACHE_KEY = "ofv-gh-stars";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface StarCache {
  count: number;
  time: number;
}

function formatStars(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(count);
}

function readCache(): StarCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StarCache;
    if (typeof parsed.count !== "number" || typeof parsed.time !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(count: number): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ count, time: Date.now() } satisfies StarCache));
  } catch {
    // Cache is a best-effort optimization.
  }
}

function applyCount(count: number): void {
  for (const badge of document.querySelectorAll<HTMLElement>("[data-gh-stars]")) {
    badge.textContent = formatStars(count);
    badge.hidden = false;
    badge.classList.add("is-loaded");
  }
}

export async function initGithubStars(): Promise<void> {
  if (!document.querySelector("[data-gh-stars]")) {
    return;
  }

  const cached = readCache();
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    applyCount(cached.count);
    return;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }
    const data = (await response.json()) as { stargazers_count?: number };
    if (typeof data.stargazers_count === "number") {
      applyCount(data.stargazers_count);
      writeCache(data.stargazers_count);
    }
  } catch {
    // Stale cache beats nothing when the API is rate-limited or offline.
    if (cached) {
      applyCount(cached.count);
    }
  }
}
