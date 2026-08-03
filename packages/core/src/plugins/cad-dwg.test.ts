import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewContext } from "../types";
import type { CadBinaryPreviewContext } from "./cad";
import { renderLibreDwgPreview } from "./cad-dwg";

type WorkerMessageHandler = ((event: MessageEvent) => void) | null;

class FakeDwgWorker {
  onmessage: WorkerMessageHandler = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postedMessage: unknown;
  transfer: Transferable[] = [];

  constructor(
    private readonly respond = true,
    private readonly result?: Record<string, unknown>
  ) {}

  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.postedMessage = message;
    this.transfer = transfer;
    if (!this.respond) {
      return;
    }
    queueMicrotask(() => {
      this.onmessage?.(
        new MessageEvent("message", {
          data: { type: "progress", message: "Parsing DWG geometry in worker..." }
        })
      );
      this.onmessage?.(
        new MessageEvent("message", {
          data: {
            type: "success",
            result: this.result ?? {
              svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><script>globalThis.compromised = true</script><line x1="0" y1="0" x2="100" y2="50" onload="globalThis.compromised = true"/><text x="2" y="4">A & B</text></svg>',
              stats: {
                entityCount: 1,
                layerCount: 1,
                layoutCount: 1,
                unknownEntityCount: 0,
                visibleLayerCount: 1,
                paperSpaceEntityCount: 0,
                hasThumbnail: false
              }
            }
          }
        })
      );
    });
  }

  terminate() {
    this.terminated = true;
  }
}

describe("LibreDWG worker preview", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("parses DWG in a configured worker and keeps SVG zoom commands", async () => {
    const worker = new FakeDwgWorker();
    const context = createContext();

    const instance = await renderLibreDwgPreview(context, {
      workerFactory: () => worker as unknown as Worker
    });

    expect(instance).toBeDefined();
    expect(worker.terminated).toBe(true);
    expect(worker.transfer).toHaveLength(1);
    expect(worker.postedMessage).toMatchObject({
      type: "parse",
      wasmBaseUrl: expect.stringContaining("/vendor/libredwg-web")
    });
    expect(context.panel.querySelector(".ofv-dwg-preview-svg line")).not.toBeNull();
    expect(context.panel.querySelector(".ofv-dwg-preview-svg text")?.textContent).toBe("A & B");
    expect(context.panel.querySelector(".ofv-dwg-preview-svg script")).toBeNull();
    expect(context.panel.querySelector(".ofv-dwg-preview-svg line")?.hasAttribute("onload")).toBe(false);
    expect(context.panel.textContent).toContain("1 个实体");
    expect(instance?.canCommand?.("zoom-in")).toBe(true);
    expect(instance?.command?.("zoom-in")).toBe(true);

    instance?.destroy();
    expect(context.panel.querySelector(".ofv-dwg-preview")).toBeNull();
  });

  it("renders SVG directly even when the drawing contains many large paths", async () => {
    const paths = Array.from({ length: 30 }, (_, index) => `<path d="M 0 ${index} L 100 ${100 - index}"/>`).join("");
    const worker = new FakeDwgWorker(true, {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${paths}</svg>`,
      stats: {
        entityCount: 30,
        layerCount: 2,
        layoutCount: 1,
        unknownEntityCount: 0,
        visibleLayerCount: 2,
        paperSpaceEntityCount: 0,
        hasThumbnail: true
      },
      thumbnail: {
        type: 6,
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      }
    });
    const context = createContext();

    const instance = await renderLibreDwgPreview(context, {
      workerFactory: () => worker as unknown as Worker
    });

    expect(instance).toBeDefined();
    expect(context.panel.querySelectorAll(".ofv-dwg-preview-svg path")).toHaveLength(30);
    expect(context.panel.querySelector(".ofv-dwg-thumbnail")).not.toBeNull();
    expect(context.panel.querySelector(".ofv-dwg-thumbnail-preview")).toBeNull();
    expect(context.panel.textContent).toContain("实验性 DWG 模型空间预览");
    expect(context.panel.textContent).not.toContain("异常图元");

    instance?.destroy();
  });

  it("terminates a worker that exceeds the configured timeout", async () => {
    const worker = new FakeDwgWorker(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const context = createContext();

    const instance = await renderLibreDwgPreview(context, {
      workerFactory: () => worker as unknown as Worker,
      workerTimeoutMs: 5
    });

    expect(instance).toBeUndefined();
    expect(worker.terminated).toBe(true);
    expect(context.panel.querySelector(".ofv-dwg-preview")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "DWG LibreDWG preview failed, falling back to metadata preview:",
      expect.objectContaining({ message: "DWG worker timed out after 5ms." })
    );
  });

  it("terminates worker parsing when the render signal is aborted", async () => {
    const worker = new FakeDwgWorker(false);
    const controller = new AbortController();
    const context = createContext(controller.signal);

    const rendering = renderLibreDwgPreview(context, {
      workerFactory: () => worker as unknown as Worker
    });
    controller.abort();

    await expect(rendering).resolves.toBeUndefined();
    expect(worker.terminated).toBe(true);
    expect(context.panel.querySelector(".ofv-dwg-preview")).toBeNull();
  });
});

function createContext(signal?: AbortSignal): CadBinaryPreviewContext {
  const panel = document.createElement("div");
  document.body.append(panel);
  return {
    panel,
    fileName: "worker.dwg",
    extension: "dwg",
    arrayBuffer: new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x32, 0x37]).buffer,
    bytes: new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x32, 0x37]),
    preview: { signal } as PreviewContext
  };
}
