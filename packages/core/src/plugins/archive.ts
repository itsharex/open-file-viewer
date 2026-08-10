/// <reference path="../shims-archive.d.ts" />
import JSZip from "jszip";
import pako from "pako";
import type { PreviewPlugin, PreviewFile } from "../types";
import { normalizeFile } from "../detect";
import { fallbackPlugin } from "./fallback";
import { createObjectUrl, revokeObjectUrl } from "../dom";
import { appendMeta, createPanel, createSection, readArrayBuffer, resolveFormat } from "./utils";
import { createEncryptedFallback, isEncryptedError } from "./encrypted";

const archiveExtensions = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]);
const archiveMimeTypes = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-bzip2",
  "application/x-xz"
]);
const archiveMimeFormatMap: Record<string, string> = {
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/vnd.rar": "rar",
  "application/x-rar-compressed": "rar",
  "application/x-7z-compressed": "7z",
  "application/x-tar": "tar",
  "application/gzip": "gz",
  "application/x-gzip": "gz",
  "application/x-bzip2": "bz2",
  "application/x-xz": "xz"
};

interface ArchiveEntry {
  name: string;
  unsafeName?: string;
  size: number;
  dir: boolean;
  read: () => Promise<ArrayBuffer>;
}

interface ArchiveProbe {
  format: string;
  valid: boolean;
  error?: string;
  meta: Array<{ label: string; value: string }>;
  entries: Array<{ name: string; size?: number; packedSize?: number }>;
  note: string;
}

export function archivePlugin(): PreviewPlugin {
  return {
    name: "archive",
    match(file) {
      return archiveExtensions.has(file.extension) || archiveMimeTypes.has(file.mimeType);
    },
    async render(ctx) {
      const url = createObjectUrl(ctx.file);
      const isExternal = Boolean(ctx.file.url);
      const panel = createPanel("ofv-archive");
      ctx.viewport.append(panel);

      const ext = resolveFormat(ctx.file, archiveMimeFormatMap).toLowerCase();
      let archiveEntries: ArchiveEntry[] = [];
      let isEncrypted = false;
      let parseError: string | null = null;
      let archiveProbe: ArchiveProbe | null = null;

      // 1. Parse different archive formats
      try {
        if (ext === "zip") {
          try {
            const zip = await JSZip.loadAsync(await readArrayBuffer(ctx.file), {
              decodeFileName: decodeZipFileName
            });
            archiveEntries = Object.values(zip.files).map((entry) => ({
              name: entry.name,
              unsafeName: (entry as any).unsafeOriginalName,
              size: (entry as any)._data?.uncompressedSize || 0,
              dir: entry.dir,
              read: () => entry.async("arraybuffer")
            }));
          } catch (zipErr: any) {
            // Check for encryption errors
            if (isEncryptedError(zipErr)) {
              isEncrypted = true;
            } else {
              throw zipErr;
            }
          }
        } else if (ext === "tar") {
          archiveEntries = untar(await readArrayBuffer(ctx.file));
        } else if (ext === "gz" || ext === "tgz" || ext === "tar.gz") {
          const u8 = new Uint8Array(await readArrayBuffer(ctx.file));
          const decompressed = pako.ungzip(u8);
          const originalName = ctx.file.name.endsWith(".gz")
            ? ctx.file.name.slice(0, -3)
            : ctx.file.name.endsWith(".tgz")
            ? ctx.file.name.slice(0, -4) + ".tar"
            : ctx.file.name;

          if (ext === "tgz" || ext === "tar.gz" || originalName.endsWith(".tar")) {
            archiveEntries = untar(toArrayBuffer(decompressed));
          } else {
            // Single decompressed file
            archiveEntries = [
              {
                name: originalName,
                size: decompressed.byteLength,
                dir: false,
                read: async () => toArrayBuffer(decompressed)
              }
            ];
          }
        } else if (ext === "bz2") {
          const compressed = new Uint8Array(await readArrayBuffer(ctx.file));
          const decompressed = await bunzip2(compressed);
          const originalName = ctx.file.name.toLowerCase().endsWith(".bz2") ? ctx.file.name.slice(0, -4) : ctx.file.name;
          archiveEntries = [
            {
              name: originalName || "decompressed",
              size: decompressed.byteLength,
              dir: false,
              read: async () => toArrayBuffer(decompressed)
            }
          ];
        } else if (ext === "xz") {
          const compressed = new Uint8Array(await readArrayBuffer(ctx.file));
          const decompressed = await unxz(compressed);
          const originalName = deriveSingleFileArchiveName(ctx.file.name, ".xz", "decompressed");

          if (originalName.toLowerCase().endsWith(".tar") || ctx.file.name.toLowerCase().endsWith(".txz")) {
            archiveEntries = untar(toArrayBuffer(decompressed));
          } else {
            archiveEntries = [
              {
                name: originalName,
                size: decompressed.byteLength,
                dir: false,
                read: async () => toArrayBuffer(decompressed)
              }
            ];
          }
        } else if (["rar", "7z"].includes(ext)) {
          archiveProbe = probeArchiveHeader(await readArrayBuffer(ctx.file), ext);
        } else {
          parseError = `该格式 (.${ext.toUpperCase()}) 目前暂不支持直接在浏览器端在线解压和目录预览。`;
        }
      } catch (err: any) {
        parseError = `压缩包解析失败：${err.message || err}`;
      }

      // 2. Encrypted Archive Prompt UI
      if (isEncrypted) {
        const fallback = createEncryptedFallback(ctx.file, url, {
          title: "压缩包已加密，无法在线预览",
          message: "请下载后在本地输入密码解压，或上传解密后的压缩包。",
          action: "下载压缩包"
        });
        panel.append(fallback);
        ctx.viewport.classList.add("ofv-center");
        
        return {
          destroy() {
            ctx.viewport.classList.remove("ofv-center");
            revokeObjectUrl(url, isExternal);
            panel.remove();
          }
        };
      }

      if (archiveProbe) {
        renderArchiveProbe(panel, archiveProbe, ctx.file.name, url);
        return {
          destroy() {
            revokeObjectUrl(url, isExternal);
            panel.remove();
          }
        };
      }

      // 3. Fallback Unsupported message (RAR, 7z, etc.)
      if (parseError) {
        const fallback = document.createElement("div");
        fallback.className = "ofv-fallback";
        
        const title = document.createElement("strong");
        title.textContent = parseError;
        
        const meta = document.createElement("span");
        meta.textContent = "建议下载视频/文档等文件至本地查看，或使用原生解压工具提取内容。";
        
        const download = document.createElement("a");
        download.href = url;
        download.download = ctx.file.name;
        download.textContent = "下载压缩包";
        
        fallback.append(title, meta, download);
        panel.append(fallback);
        ctx.viewport.classList.add("ofv-center");

        return {
          destroy() {
            ctx.viewport.classList.remove("ofv-center");
            revokeObjectUrl(url, isExternal);
            panel.remove();
          }
        };
      }

      // 4. Split Layout UI for interactive preview
      const layout = document.createElement("div");
      layout.className = "ofv-archive-layout";

      const sidebar = document.createElement("div");
      sidebar.className = "ofv-archive-sidebar";
      const sidebarPanel = document.createElement("div");
      sidebarPanel.className = "ofv-archive-sidebar-panel";

      const header = document.createElement("div");
      header.className = "ofv-archive-header";
      const sidebarTitle = document.createElement("span");
      sidebarTitle.className = "ofv-archive-header-title";
      sidebarTitle.textContent = `文件列表 (${archiveEntries.filter(e => !e.dir).length})`;
      const sidebarToggle = document.createElement("button");
      sidebarToggle.className = "ofv-archive-sidebar-toggle";
      sidebarToggle.type = "button";
      sidebarToggle.setAttribute("aria-label", "展开文件列表");
      sidebarToggle.setAttribute("aria-expanded", "false");
      sidebarToggle.title = "展开文件列表";
      sidebarToggle.textContent = "‹";
      header.append(sidebarToggle, sidebarTitle);
      sidebarPanel.append(header);

      const tree = document.createElement("div");
      tree.className = "ofv-archive-tree";
      sidebarPanel.append(tree);
      sidebar.append(sidebarPanel);

      const mainPanel = document.createElement("div");
      mainPanel.className = "ofv-archive-main";

      layout.append(sidebar, mainPanel);
      panel.append(layout);

      let currentSubInstance: any = null;
      const getSidebarViewportWidth = () => ctx.viewport.clientWidth || ctx.size.width;
      const shouldAutoCollapseSidebar = () => getSidebarViewportWidth() <= 520;
      const setSidebarCollapsed = (collapsed: boolean) => {
        layout.classList.toggle("is-sidebar-collapsed", collapsed);
        sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
        const label = collapsed ? "展开文件列表" : "收起文件列表";
        sidebarToggle.setAttribute("aria-label", label);
        sidebarToggle.title = label;
        sidebarToggle.textContent = collapsed ? "›" : "‹";
      };
      setSidebarCollapsed(false);
      sidebarToggle.addEventListener("click", () => {
        setSidebarCollapsed(!layout.classList.contains("is-sidebar-collapsed"));
      });

      // Render default metadata summary
      const showDefaultSummary = (isSupplemental = true) => {
        mainPanel.replaceChildren();
        const summary = document.createElement("div");
        summary.className = "ofv-archive-info";
        if (isSupplemental) {
          hideSupplementalInfo(summary);
        }
        
        const heading = document.createElement("h3");
        heading.textContent = ctx.file.name;

        const info = document.createElement("div");
        info.className = "ofv-archive-info-meta";
        
        const fileCount = archiveEntries.filter(e => !e.dir).length;
        const dirCount = archiveEntries.filter(e => e.dir).length;
        
        appendArchiveInfo(info, "格式类型", `.${ext.toUpperCase()} 压缩文件`);
        appendArchiveInfo(info, "包含文件数", `${fileCount} 个`);
        appendArchiveInfo(info, "包含目录数", `${dirCount} 个`);
        appendArchiveInfo(
          info,
          "操作提示",
          fileCount === 0 ? "压缩包内没有可预览的文件。" : "请点击左侧栏中的文件进行联动预览。"
        );
        
        summary.append(heading, info, createArchiveSummary(archiveEntries));
        mainPanel.append(summary);
      };

      // Filter and render items (max 500 to keep DOM lightweight)
      const visibleEntries = archiveEntries.filter(e => !e.dir).slice(0, 500);
      showDefaultSummary(visibleEntries.length > 0);
      let destroyed = false;
      let renderToken = 0;

      const openArchiveEntry = async (entry: ArchiveEntry, item: HTMLButtonElement) => {
        if (destroyed) {
          return;
        }
        if (shouldAutoCollapseSidebar()) {
          setSidebarCollapsed(true);
        }
        const token = ++renderToken;
        sidebar.querySelectorAll(".ofv-archive-item").forEach((el) => {
          el.classList.remove("is-active");
          el.removeAttribute("aria-current");
        });
        item.classList.add("is-active");
        item.setAttribute("aria-current", "true");

        if (currentSubInstance) {
          currentSubInstance.destroy();
          currentSubInstance = null;
          ctx.toolbar?.refreshCommandSupport();
        }

        mainPanel.replaceChildren(createArchiveLoading(entry.name.split("/").pop() || entry.name));

        try {
          let buffer = await entry.read();
          if (destroyed || token !== renderToken) {
            return;
          }
          const subName = entry.name.split("/").pop() || entry.name;
          const subExt = subName.split(".").pop()?.toLowerCase() || "";

          if (subExt === "shp") {
            const basePath = entry.name.slice(0, -4);
            const dbfEntry = archiveEntries.find((e) => e.name.toLowerCase() === basePath.toLowerCase() + ".dbf");
            const shxEntry = archiveEntries.find((e) => e.name.toLowerCase() === basePath.toLowerCase() + ".shx");
            if (dbfEntry && shxEntry) {
              const prjEntry = archiveEntries.find((e) => e.name.toLowerCase() === basePath.toLowerCase() + ".prj");
              const newZip = new JSZip();
              newZip.file(subName, buffer);
              newZip.file(dbfEntry.name.split("/").pop()!, await dbfEntry.read());
              newZip.file(shxEntry.name.split("/").pop()!, await shxEntry.read());
              if (prjEntry) {
                newZip.file(prjEntry.name.split("/").pop()!, await prjEntry.read());
              }
              buffer = await newZip.generateAsync({ type: "arraybuffer" });
              if (destroyed || token !== renderToken) {
                return;
              }
            }
          }

          const subContainer = document.createElement("div");
          subContainer.style.cssText = "width: 100%; height: 100%; position: relative; display: flex; flex-direction: column;";
          mainPanel.replaceChildren(subContainer);

          const subViewport = document.createElement("div");
          subViewport.className = "ofv-viewport";
          subViewport.style.cssText = "flex: 1; width: 100%; height: 100%; position: relative; overflow: auto;";
          subContainer.append(subViewport);

          const subFile: PreviewFile = await normalizeFile(buffer, subName);

          const plugins = [...(ctx.options.plugins || []), fallbackPlugin()];
          let matchedPlugin = await findSubPreviewPlugin(plugins, subFile);
          if (destroyed || token !== renderToken) {
            return;
          }
          if (matchedPlugin.name === "archive") {
            matchedPlugin = fallbackPlugin();
          }

          let previewError: Error | undefined;
          const nextSubInstance = await Promise.resolve()
            .then(() =>
              matchedPlugin.render({
                host: ctx.host,
                viewport: subViewport,
                file: subFile,
                size: { width: subViewport.clientWidth || 600, height: subViewport.clientHeight || 400 },
                options: ctx.options,
                toolbar: ctx.toolbar,
                setLoading: () => {},
                setError: (err) => {
                  previewError = err instanceof Error ? err : new Error(String(err));
                  subViewport.replaceChildren(createInlineError("文件预览失败", previewError.message));
                }
              })
            )
            .catch((error: unknown) => {
              previewError = error instanceof Error ? error : new Error(String(error));
              subViewport.replaceChildren(createInlineError("文件预览失败", previewError.message));
              return undefined;
            });
          if (destroyed || token !== renderToken) {
            nextSubInstance?.destroy();
            return;
          }
          if (nextSubInstance && !previewError) {
            currentSubInstance = nextSubInstance;
            ctx.toolbar?.refreshCommandSupport();
          } else if (nextSubInstance) {
            nextSubInstance.destroy();
            ctx.toolbar?.refreshCommandSupport();
          }
        } catch (err: any) {
          if (destroyed || token !== renderToken) {
            return;
          }
          currentSubInstance = null;
          ctx.toolbar?.refreshCommandSupport();
          mainPanel.replaceChildren(createInlineError("解压加载失败", String(err.message || err)));
        }
      };

      visibleEntries.forEach((entry, index) => {
        const item = document.createElement("button");
        item.className = "ofv-archive-item";
        item.type = "button";
        item.title = entry.name;

        const icon = document.createElement("span");
        icon.className = "ofv-archive-item-icon";
        icon.textContent = getIcon(entry.name, entry.dir);

        const name = document.createElement("span");
        name.className = "ofv-archive-item-name";
        name.textContent = entry.name;
        name.title = entry.name;

        item.append(icon, name);
        tree.append(item);

        item.addEventListener("click", async () => {
          await openArchiveEntry(entry, item);
        });
        if (index === 0) {
          void openArchiveEntry(entry, item);
        }
      });

      return {
        canCommand(command) {
          return currentSubInstance?.canCommand?.(command) ?? false;
        },
        command(command) {
          return currentSubInstance?.command?.(command) ?? false;
        },
        preparePrint() {
          return currentSubInstance?.preparePrint?.();
        },
        resize(size) {
          currentSubInstance?.resize?.(size);
        },
        destroy() {
          destroyed = true;
          renderToken += 1;
          if (currentSubInstance) {
            currentSubInstance.destroy();
          }
          revokeObjectUrl(url, isExternal);
          panel.remove();
        }
      };
    }
  };
}

async function findSubPreviewPlugin(plugins: PreviewPlugin[], file: PreviewFile): Promise<PreviewPlugin> {
  for (const plugin of plugins) {
    if (await plugin.match(file)) {
      return plugin;
    }
  }
  return fallbackPlugin();
}

async function bunzip2(bytes: Uint8Array): Promise<Uint8Array> {
  const restoreBuffer = installSeekBzipBufferCompat();
  try {
    const module = await import("seek-bzip");
    const decoder = (module.default || module) as { decode: (input: Uint8Array) => Uint8Array | ArrayBuffer | ArrayLike<number> };
    const decoded = decoder.decode(bytes);
    return decoded instanceof Uint8Array
      ? decoded
      : decoded instanceof ArrayBuffer
        ? new Uint8Array(decoded)
        : Uint8Array.from(decoded);
  } finally {
    restoreBuffer();
  }
}

function installSeekBzipBufferCompat(): () => void {
  const globalObject = globalThis as unknown as Record<string, unknown>;
  if (typeof globalObject.Buffer === "function") {
    return () => undefined;
  }
  class SeekBzipBuffer extends Uint8Array {
    copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
      const slice = this.subarray(sourceStart, sourceEnd);
      target.set(slice, targetStart);
      return slice.length;
    }

    toString(encoding?: string): string {
      if (encoding === "hex") {
        return Array.from(this)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      }
      return new TextDecoder().decode(this);
    }
  }
  globalObject.Buffer = SeekBzipBuffer;
  return () => {
    if (globalObject.Buffer === SeekBzipBuffer) {
      Reflect.deleteProperty(globalObject, "Buffer");
    }
  };
}

async function unxz(bytes: Uint8Array): Promise<Uint8Array> {
  const module = await import("xz-decompress");
  const XzReadableStream = (module as any).XzReadableStream || (module as any).default?.XzReadableStream;
  if (typeof XzReadableStream !== "function") {
    throw new Error("XZ 解码器不可用。");
  }
  const response = new Response(new XzReadableStream(createByteReadableStream(bytes)));
  return new Uint8Array(await response.arrayBuffer());
}

function createByteReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const blob = new Blob([bytes as BlobPart]);
  if (typeof blob.stream === "function") {
    return blob.stream() as ReadableStream<Uint8Array>;
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

function deriveSingleFileArchiveName(fileName: string, suffix: string, fallback: string): string {
  return fileName.toLowerCase().endsWith(suffix) ? fileName.slice(0, -suffix.length) || fallback : fileName || fallback;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeZipFileName(bytes: string[] | Uint8Array | ArrayLike<number>): string {
  const data = Array.isArray(bytes)
    ? Uint8Array.from(bytes.map((value) => value.charCodeAt(0) & 0xff))
    : bytes instanceof Uint8Array
      ? bytes
      : Uint8Array.from(bytes);
  const utf8 = decodeZipNameWith(data, "utf-8", true);
  if (utf8 && !looksMojibake(utf8)) {
    return utf8;
  }
  const gb18030 = decodeZipNameWith(data, "gb18030", false) || decodeZipNameWith(data, "gbk", false);
  if (gb18030 && !looksMojibake(gb18030)) {
    return gb18030;
  }
  return utf8 || new TextDecoder("latin1").decode(data);
}

function decodeZipNameWith(bytes: Uint8Array, encoding: string, fatal: boolean): string | undefined {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes);
  } catch {
    return undefined;
  }
}

function looksMojibake(value: string): boolean {
  return /[\uFFFDÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß]/.test(value);
}

function createInlineError(titleText: string, detailText: string): HTMLElement {
  const fallback = document.createElement("div");
  fallback.className = "ofv-fallback";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const detail = document.createElement("span");
  detail.textContent = detailText;
  fallback.append(title, detail);
  return fallback;
}

function appendArchiveInfo(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement("div");
  const key = document.createElement("strong");
  key.textContent = `${label}：`;
  row.append(key, document.createTextNode(value));
  parent.append(row);
}

function hideSupplementalInfo(element: HTMLElement): void {
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  element.style.display = "none";
}

function createArchiveSummary(entries: ArchiveEntry[]): HTMLElement {
  const files = entries.filter((entry) => !entry.dir);
  const summary = document.createElement("dl");
  summary.className = "ofv-archive-summary";
  const totalSize = files.reduce((sum, entry) => sum + entry.size, 0);
  const largest = files.reduce<ArchiveEntry | undefined>((current, entry) => (!current || entry.size > current.size ? entry : current), undefined);
  appendArchiveSummary(summary, "总解压大小", formatBytes(totalSize));
  appendArchiveSummary(summary, "最大文件", largest ? `${largest.name} · ${formatBytes(largest.size)}` : "无");
  appendArchiveSummary(summary, "类型分布", formatArchiveExtensions(files));
  appendArchiveSummary(summary, "可预览条目", String(files.slice(0, 500).length));
  appendArchiveSummary(summary, "风险路径", String(files.filter((entry) => isRiskyArchivePath(entry.unsafeName || entry.name)).length));
  return summary;
}

function appendArchiveSummary(parent: HTMLElement, label: string, value: string): void {
  const key = document.createElement("dt");
  key.textContent = label;
  const content = document.createElement("dd");
  content.textContent = value;
  parent.append(key, content);
}

function formatArchiveExtensions(entries: ArchiveEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const name = entry.name.split("/").pop() || entry.name;
    const index = name.lastIndexOf(".");
    const extension = index > 0 ? name.slice(index + 1).toLowerCase() : "(无扩展名)";
    counts.set(extension, (counts.get(extension) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([extension, count]) => `${extension} ${count}`)
    .join(", ") || "无";
}

function isRiskyArchivePath(name: string): boolean {
  return name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name) || name.split(/[\\/]+/).includes("..");
}

function createArchiveLoading(fileName: string): HTMLElement {
  const loading = document.createElement("div");
  loading.className = "ofv-archive-loading";
  const spinner = document.createElement("div");
  spinner.className = "ofv-archive-loading-spinner";
  const text = document.createElement("span");
  text.textContent = `正在解压并加载 [${fileName}]...`;
  loading.append(spinner, text);
  return loading;
}

function renderArchiveProbe(panel: HTMLElement, probe: ArchiveProbe, fileName: string, url: string): void {
  const section = createSection(`${probe.format} 结构预览`);
  const note = document.createElement("p");
  note.textContent = probe.note;

  const meta = document.createElement("div");
  meta.className = "ofv-archive-probe-meta";
  appendArchiveInfo(meta, "文件", fileName);
  appendArchiveInfo(meta, "格式", probe.format);
  for (const item of probe.meta) {
    appendArchiveInfo(meta, item.label, item.value);
  }

  const download = document.createElement("a");
  download.className = "ofv-asset-download";
  download.href = url;
  download.download = fileName;
  download.textContent = "下载压缩包";

  section.append(note, meta, download);

  if (!probe.valid) {
    const error = document.createElement("p");
    error.className = "ofv-data-error";
    error.textContent = probe.error || "压缩包头信息无法识别。";
    section.append(error);
  }

  if (probe.entries.length > 0) {
    const wrapper = document.createElement("div");
    wrapper.className = "ofv-table-scroll ofv-archive-probe-table";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    for (const label of ["文件", "原始大小", "压缩大小"]) {
      const th = document.createElement("th");
      th.textContent = label;
      header.append(th);
    }
    thead.append(header);
    const tbody = document.createElement("tbody");
    for (const entry of probe.entries.slice(0, 200)) {
      const tr = document.createElement("tr");
      for (const value of [
        entry.name,
        entry.size === undefined ? "未知" : formatBytes(entry.size),
        entry.packedSize === undefined ? "未知" : formatBytes(entry.packedSize)
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrapper.append(table);
    section.append(wrapper);
  }

  panel.append(section);
}

function probeArchiveHeader(arrayBuffer: ArrayBuffer, extension: string): ArchiveProbe {
  const bytes = new Uint8Array(arrayBuffer);
  if (extension === "rar") {
    return probeRar(bytes);
  }
  if (extension === "7z") {
    return probe7z(bytes);
  }
  if (extension === "bz2") {
    return probeBzip2(bytes);
  }
  if (extension === "xz") {
    return probeXz(bytes);
  }
  return {
    format: extension.toUpperCase(),
    valid: false,
    error: "暂不支持该压缩格式的头信息解析。",
    meta: [],
    entries: [],
    note: "当前仅提供压缩包识别和下载入口。"
  };
}

function probeRar(bytes: Uint8Array): ArchiveProbe {
  const rar4 = bytes.length >= 7 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21 && bytes[4] === 0x1a && bytes[5] === 0x07 && bytes[6] === 0x00;
  const rar5 = bytes.length >= 8 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21 && bytes[4] === 0x1a && bytes[5] === 0x07 && bytes[6] === 0x01 && bytes[7] === 0x00;
  const entries = rar4 ? parseRar4Entries(bytes) : [];
  return {
    format: "RAR",
    valid: rar4 || rar5,
    error: rar4 || rar5 ? undefined : "缺少 RAR signature。",
    meta: [
      { label: "版本", value: rar5 ? "RAR5" : rar4 ? "RAR4" : "未知" },
      { label: "签名", value: byteSignature(bytes) },
      { label: "可见条目", value: String(entries.length) }
    ],
    entries,
    note: rar4
      ? "当前轻量读取 RAR4 未加密文件头，用于目录确认；实际解压仍建议接入 unrar WASM 或本地工具。"
      : "当前识别 RAR 容器和版本；RAR5 目录解析需要专用解码器。"
  };
}

function parseRar4Entries(bytes: Uint8Array): ArchiveProbe["entries"] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ArchiveProbe["entries"] = [];
  let offset = 7;
  while (offset + 7 <= bytes.length && entries.length < 200) {
    const type = bytes[offset + 2];
    const flags = view.getUint16(offset + 3, true);
    let headerSize = view.getUint16(offset + 5, true);
    if (headerSize < 7 || offset + headerSize > bytes.length) {
      break;
    }
    if ((flags & 0x8000) !== 0) {
      if (offset + 11 > bytes.length) {
        break;
      }
      headerSize += view.getUint32(offset + 7, true);
    }
    if (type === 0x74 && offset + 32 <= bytes.length) {
      const packedSize = view.getUint32(offset + 7, true);
      const unpackedSize = view.getUint32(offset + 11, true);
      const nameSize = view.getUint16(offset + 26, true);
      const nameOffset = offset + 32;
      const nameEnd = Math.min(nameOffset + nameSize, offset + headerSize, bytes.length);
      const nameBytes = bytes.slice(nameOffset, nameEnd);
      const name = new TextDecoder("latin1").decode(nameBytes).replace(/\0.*$/, "");
      if (name) {
        entries.push({ name, size: unpackedSize, packedSize });
      }
    }
    offset += headerSize;
  }
  return entries;
}

function probe7z(bytes: Uint8Array): ArchiveProbe {
  const valid = bytes.length >= 32 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf && bytes[4] === 0x27 && bytes[5] === 0x1c;
  const meta: ArchiveProbe["meta"] = [{ label: "签名", value: byteSignature(bytes) }];
  if (valid) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    meta.push({ label: "版本", value: `${bytes[6]}.${bytes[7]}` });
    meta.push({ label: "Next header offset", value: String(readUint64Le(view, 12)) });
    meta.push({ label: "Next header size", value: String(readUint64Le(view, 20)) });
    meta.push({ label: "Next header CRC", value: `0x${view.getUint32(28, true).toString(16).toUpperCase()}` });
  }
  return {
    format: "7Z",
    valid,
    error: valid ? undefined : "缺少 7z signature。",
    meta,
    entries: [],
    note: "当前识别 7z 容器和 next header 边界；目录和解压需要 LZMA/7z 专用解码器。"
  };
}

function probeBzip2(bytes: Uint8Array): ArchiveProbe {
  const valid = bytes.length >= 4 && bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68 && bytes[3] >= 0x31 && bytes[3] <= 0x39;
  return {
    format: "BZIP2",
    valid,
    error: valid ? undefined : "缺少 BZh magic header。",
    meta: [
      { label: "签名", value: byteSignature(bytes) },
      { label: "块大小", value: valid ? `${String.fromCharCode(bytes[3])}00 KB` : "未知" }
    ],
    entries: [],
    note: "BZIP2 通常是单文件压缩流，本预览器当前展示容器头信息；解压可后续接入 bzip2 解码器。"
  };
}

function probeXz(bytes: Uint8Array): ArchiveProbe {
  const valid = bytes.length >= 6 && bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a && bytes[3] === 0x58 && bytes[4] === 0x5a && bytes[5] === 0x00;
  return {
    format: "XZ",
    valid,
    error: valid ? undefined : "缺少 XZ magic header。",
    meta: [
      { label: "签名", value: byteSignature(bytes) },
      { label: "Stream flags", value: bytes.length >= 8 ? `0x${bytes[6].toString(16).padStart(2, "0").toUpperCase()} 0x${bytes[7].toString(16).padStart(2, "0").toUpperCase()}` : "未知" }
    ],
    entries: [],
    note: "XZ 通常是单文件 LZMA2 压缩流，本预览器当前展示容器头信息；解压可后续接入 xz/lzma 解码器。"
  };
}

function readUint64Le(view: DataView, offset: number): bigint {
  return BigInt(view.getUint32(offset, true)) | (BigInt(view.getUint32(offset + 4, true)) << 32n);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function byteSignature(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "空文件";
  }
  const ascii = new TextDecoder("ascii").decode(bytes.slice(0, Math.min(bytes.length, 16))).replace(/[^\x20-\x7E]/g, ".");
  const hex = Array.from(bytes.slice(0, Math.min(bytes.length, 8)))
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
  return `${ascii} (${hex})`;
}

// 5. Lightweight TAR parser
function untar(arrayBuffer: ArrayBuffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const u8 = new Uint8Array(arrayBuffer);
  let offset = 0;

  const readString = (start: number, length: number): string => {
    let end = start;
    while (end < start + length && u8[end] !== 0) {
      end++;
    }
    return new TextDecoder().decode(u8.subarray(start, end)).trim();
  };

  while (offset + 512 <= arrayBuffer.byteLength) {
    const magic = readString(offset + 257, 6);
    if (magic !== "ustar" && magic !== "ustar\0") {
      let allZero = true;
      for (let i = 0; i < 512; i++) {
        if (u8[offset + i] !== 0) {
          allZero = false;
          break;
        }
      }
      if (allZero) {
        break; // End of archive
      }
      break;
    }

    const name = readString(offset, 100);
    const prefix = readString(offset + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;

    const sizeStr = readString(offset + 124, 12);
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = readString(offset + 156, 1);
    const dir = typeflag === "5" || fullName.endsWith("/");

    const contentOffset = offset + 512;
    entries.push({
      name: fullName,
      size,
      dir,
      read: async () => arrayBuffer.slice(contentOffset, contentOffset + size)
    });

    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return entries;
}

// 6. UI Helpers
function getIcon(name: string, dir: boolean): string {
  if (dir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return "🖼️";
    case "pdf":
      return "📕";
    case "doc":
    case "docx":
      return "📘";
    case "xls":
    case "xlsx":
      return "📗";
    case "ppt":
    case "pptx":
      return "📙";
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return "📦";
    case "mp4":
    case "mkv":
    case "avi":
    case "webm":
      return "🎥";
    case "mp3":
    case "wav":
    case "ogg":
      return "🎵";
    case "txt":
    case "md":
    case "html":
    case "js":
    case "ts":
    case "json":
    case "css":
      return "📄";
    default:
      return "📄";
  }
}
