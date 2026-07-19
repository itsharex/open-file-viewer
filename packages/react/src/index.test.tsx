import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewPlugin } from "@open-file-viewer/core";
import { FileViewer } from "./index";

describe("FileViewer React adapter", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("recreates the core viewer when plugins change", async () => {
    const firstDestroy = vi.fn();
    const secondDestroy = vi.fn();
    const firstPlugin = createPlugin("first", firstDestroy);
    const secondPlugin = createPlugin("second", secondDestroy);

    const { rerender, unmount } = render(
      <FileViewer file={new Blob(["demo"], { type: "text/plain" })} fileName="demo.txt" plugins={[firstPlugin]} />
    );

    expect(await screen.findByText("first:demo.txt")).toBeTruthy();

    rerender(
      <FileViewer file={new Blob(["demo"], { type: "text/plain" })} fileName="demo.txt" plugins={[secondPlugin]} />
    );

    await waitFor(() => expect(firstDestroy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("second:demo.txt")).toBeTruthy();

    unmount();
    expect(secondDestroy).toHaveBeenCalledTimes(1);
  });

  it("passes fallback callbacks through to the core viewer", async () => {
    const unsupported = vi.fn();

    render(
      <FileViewer
        file={new Blob(["unknown"], { type: "application/octet-stream" })}
        fileName="unknown.bin"
        fallback="inline"
        onUnsupported={unsupported}
      />
    );

    await waitFor(() => expect(unsupported).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Preview is not available for this file")).toBeTruthy();
  });

  it("passes initialIndex through and reacts to initialIndex changes", async () => {
    const files = [
      { file: new Blob(["one"], { type: "text/plain" }), fileName: "one.txt" },
      { file: new Blob(["two"], { type: "text/plain" }), fileName: "two.txt" },
      { file: new Blob(["three"], { type: "text/plain" }), fileName: "three.txt" }
    ];
    const plugins = [createPlugin("indexed", vi.fn())];

    const { rerender, unmount } = render(<FileViewer files={files} initialIndex={1} plugins={plugins} />);

    expect(await screen.findByText("indexed:two.txt")).toBeTruthy();

    rerender(<FileViewer files={files} initialIndex={2} plugins={plugins} />);

    expect(await screen.findByText("indexed:three.txt")).toBeTruthy();

    unmount();
  });

  it("passes zoom through and recreates the viewer when only zoom changes", async () => {
    const file = new Blob(["demo"], { type: "text/plain" });
    const firstDestroy = vi.fn();
    const plugins = [createZoomPlugin(firstDestroy)];
    const { rerender, unmount } = render(
      <FileViewer file={file} fileName="zoom.txt" zoom={1.5} plugins={plugins} />
    );

    expect(await screen.findByText("zoom:1.5")).toBeTruthy();

    rerender(<FileViewer file={file} fileName="zoom.txt" zoom={2} plugins={plugins} />);

    await waitFor(() => expect(firstDestroy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("zoom:2")).toBeTruthy();

    unmount();
  });

  it("passes locale and messages through to the core viewer", async () => {
    render(
      <FileViewer
        file={new Blob(["unknown"], { type: "application/octet-stream" })}
        fileName="unknown.bin"
        fallback="inline"
        locale="en-US"
        messages={{ unsupportedTitle: "No preview available" }}
      />
    );

    expect(await screen.findByText("No preview available")).toBeTruthy();
    expect(await screen.findByText("Download file")).toBeTruthy();
  });

  it("passes className through as the core viewer style hook", async () => {
    const destroy = vi.fn();
    const { container, unmount } = render(
      <FileViewer
        file={new Blob(["demo"], { type: "text/plain" })}
        fileName="demo.txt"
        plugins={[createPlugin("styled", destroy)]}
        className="viewer-shell"
      />
    );

    expect(await screen.findByText("styled:demo.txt")).toBeTruthy();

    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains("viewer-shell")).toBe(true);
    expect(root.classList.contains("ofv-root")).toBe(true);

    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(root.classList.contains("viewer-shell")).toBe(false);
  });

  it("renders a custom toolbar with the render prop", async () => {
    const { unmount } = render(
      <FileViewer
        files={[
          { file: new Blob(["one"], { type: "text/plain" }), fileName: "one.txt" },
          { file: new Blob(["two"], { type: "text/plain" }), fileName: "two.txt" }
        ]}
        plugins={[createPlugin("custom", vi.fn())]}
        renderToolbar={(ctx) => (
          <button type="button" onClick={() => void ctx.next()} disabled={!ctx.canNext}>
            {ctx.index + 1}/{ctx.length} {ctx.file?.name}
          </button>
        )}
      />
    );

    const button = await screen.findByRole("button", { name: "1/2 one.txt" });
    button.click();
    expect((await screen.findByRole("button", { name: "2/2 two.txt" }) as HTMLButtonElement).disabled).toBe(true);

    unmount();
  });
});

function createPlugin(name: string, destroy: () => void): PreviewPlugin {
  return {
    name,
    match: () => true,
    render(ctx) {
      const element = document.createElement("div");
      element.textContent = `${name}:${ctx.file.name}`;
      ctx.viewport.append(element);
      return { destroy };
    }
  };
}

function createZoomPlugin(destroy: () => void): PreviewPlugin {
  return {
    name: "zoom",
    match: () => true,
    render(ctx) {
      const element = document.createElement("div");
      element.textContent = `zoom:${ctx.options.zoom}`;
      ctx.viewport.append(element);
      return { destroy };
    }
  };
}
