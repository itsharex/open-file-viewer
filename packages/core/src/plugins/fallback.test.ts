import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewer } from "../viewer";
import { fallbackPlugin } from "./fallback";

describe("fallbackPlugin", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders unsupported files and cleans viewport classes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const unsupported = vi.fn();
    const objectUrl = "blob:ofv-fallback";
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => objectUrl),
      revokeObjectURL: vi.fn()
    });

    const viewer = createViewer({
      container,
      file: new Blob(["data"]),
      fileName: "unknown.bin",
      plugins: [fallbackPlugin()],
      onUnsupported: unsupported
    });

    await waitFor(() => Boolean(container.querySelector(".ofv-fallback")));

    expect(container.querySelector(".ofv-viewport")?.classList.contains("ofv-center")).toBe(true);
    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("Fileunknown.bin");
    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("Format.bin");
    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("MIMENot declared");
    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("Size4 B");
    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("SourceLocal or in-memory file");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(objectUrl);
    expect(unsupported).toHaveBeenCalledTimes(1);

    viewer.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(objectUrl);
    expect(container.childElementCount).toBe(0);
  });

  it("shows remote source details in fallback metadata", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    createViewer({
      container,
      file: "https://example.com/downloads/archive.weird",
      plugins: [fallbackPlugin()]
    });

    await waitFor(() => Boolean(container.querySelector(".ofv-fallback-meta")));

    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("archive.weird");
    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("Format.weird");
    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("SizeUnknown");
    expect(container.querySelector(".ofv-fallback-meta")?.textContent).toContain("SourceRemote URL");
  });
});

async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
