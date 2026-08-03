import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewer } from "../viewer";
import { xmindPlugin } from "./xmind";

describe("xmindPlugin", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders modern XMind content.json workbooks as a connected mind map", async () => {
    const zip = new JSZip();
    zip.file(
      "content.json",
      JSON.stringify([
        {
          title: "产品路线图",
          rootTopic: {
            title: "Open File Viewer",
            labels: ["core"],
            notes: { plain: { content: "支持常见附件预览" } },
            children: {
              attached: [
                { title: "Office", markers: [{ markerId: "priority-1" }] },
                { title: "XMind", children: { attached: [{ title: "主题树" }] } }
              ]
            }
          }
        }
      ])
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const container = document.createElement("div");
    document.body.append(container);

    createViewer({
      container,
      file: buffer,
      fileName: "roadmap.xmind",
      plugins: [xmindPlugin()]
    });

    await waitFor(() => Boolean(container.querySelector(".ofv-xmind-workbook")));

    expect(container.textContent).toContain("产品路线图");
    expect(container.textContent).toContain("Open File Viewer");
    expect(container.textContent).toContain("Office");
    expect(container.textContent).toContain("XMind");
    expect(container.textContent).toContain("主题树");
    expect(container.textContent).toContain("支持常见附件预览");
    expect(container.textContent).toContain("#core");
    expect(container.textContent).toContain("P1");
    expect(container.querySelectorAll(".ofv-xmind-topic")).toHaveLength(4);
    expect(container.querySelectorAll(".ofv-xmind-edges path")).toHaveLength(3);
  });

  it("renders legacy XMind content.xml workbooks", async () => {
    const zip = new JSZip();
    zip.file(
      "content.xml",
      `<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">
        <sheet>
          <title>旧版工作表</title>
          <topic>
            <title>中心主题</title>
            <children>
              <topics type="attached">
                <topic>
                  <title>分支一</title>
                  <notes><plain>旧版备注</plain></notes>
                </topic>
              </topics>
            </children>
          </topic>
        </sheet>
      </xmap-content>`
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const container = document.createElement("div");
    document.body.append(container);

    createViewer({
      container,
      file: new Blob([buffer], { type: "application/vnd.xmind.workbook" }),
      plugins: [xmindPlugin()]
    });

    await waitFor(() => Boolean(container.querySelector(".ofv-xmind-workbook")));

    expect(container.textContent).toContain("旧版工作表");
    expect(container.textContent).toContain("中心主题");
    expect(container.textContent).toContain("分支一");
    expect(container.textContent).toContain("旧版备注");
  });

  it("supports shared toolbar zoom for XMind previews", async () => {
    const zip = new JSZip();
    zip.file("content.json", JSON.stringify([{ rootTopic: { title: "Zoomable" } }]));
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const container = document.createElement("div");
    document.body.append(container);

    createViewer({
      container,
      file: buffer,
      fileName: "zoom.xmind",
      plugins: [xmindPlugin()],
      toolbar: true
    });

    const surface = await waitFor(() => container.querySelector<HTMLElement>(".ofv-xmind-surface"));
    const zoomIn = await waitFor(() => {
      const button = findToolbarButton(container, "Zoom in");
      return button && !button.disabled ? button : false;
    });
    const rotate = await waitFor(() => findToolbarButton(container, "Rotate right"));

    expect(rotate.disabled).toBe(true);

    zoomIn.click();

    await waitFor(() => surface.style.transform.includes("scale(1.15)"));
  });

  it("finds nested case-insensitive content files and supports wrapped sheets", async () => {
    const zip = new JSZip();
    zip.file(
      "Workbook/CONTENT.JSON",
      JSON.stringify({
        sheets: [
          { title: "第一张", rootTopic: { id: "root-1", title: "中心一" } },
          {
            title: "第二张",
            rootTopic: {
              id: "root-2",
              title: "中心二",
              notes: { realHTML: { content: "<p>新版备注</p>" } },
              children: { detached: [{ id: "detached", title: "浮动主题" }] }
            }
          }
        ]
      })
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const container = document.createElement("div");
    document.body.append(container);

    createViewer({
      container,
      file: buffer,
      fileName: "wrapped.xmind",
      plugins: [xmindPlugin()]
    });

    const tabs = await waitFor(() => {
      const result = container.querySelectorAll<HTMLButtonElement>(".ofv-xmind-tab");
      return result.length === 2 ? result : false;
    });
    expect(container.textContent).toContain("中心一");
    expect(container.textContent).not.toContain("中心二");

    tabs[1].click();

    await waitFor(() => container.textContent?.includes("中心二"));
    expect(container.textContent).toContain("新版备注");
    expect(container.textContent).toContain("浮动主题");
    expect(container.querySelector(".ofv-xmind-topic-detached")).not.toBeNull();
  });

  it("resolves packaged topic images and revokes their object URLs", async () => {
    const createObjectURL = vi.fn(() => "blob:xmind-image");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const zip = new JSZip();
    zip.file(
      "content.json",
      JSON.stringify([
        { rootTopic: { title: "图片主题", image: { src: "xap:resources/topic.png" } } }
      ])
    );
    zip.file("resources/topic.png", new Uint8Array([137, 80, 78, 71]));
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const container = document.createElement("div");
    document.body.append(container);

    const viewer = createViewer({
      container,
      file: buffer,
      fileName: "image.xmind",
      plugins: [xmindPlugin()]
    });

    const image = await waitFor(() => container.querySelector<HTMLImageElement>(".ofv-xmind-topic-image"));
    expect(image.src).toBe("blob:xmind-image");
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    viewer.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:xmind-image");
  });

  it("shows a controlled fallback for invalid XMind packages", async () => {
    const zip = new JSZip();
    zip.file("metadata.json", "{}");
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const container = document.createElement("div");
    document.body.append(container);

    createViewer({
      container,
      file: buffer,
      fileName: "broken.xmind",
      plugins: [xmindPlugin()]
    });

    await waitFor(() => Boolean(container.querySelector(".ofv-xmind-fallback")));

    expect(container.textContent).toContain("Unable to parse XMIND workbook");
    expect(container.textContent).toContain("Missing XMind content.json/content.xml");
  });
});

async function waitFor<T>(predicate: () => T | false | null | undefined, timeout = 1000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = predicate();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function findToolbarButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.title === label);
}
