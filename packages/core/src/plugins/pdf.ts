import { createObjectUrl, revokeObjectUrl } from "../dom";
import { defaultMessages, formatPreviewMessage } from "../messages";
import type { PreviewFit, PreviewMessages, PreviewPlugin, PreviewSize } from "../types";
import { createEncryptedFallback, isEncryptedError } from "./encrypted";
import { getInitialZoom } from "./utils";

type PdfJsModule = typeof import("pdfjs-dist");
type PdfDocumentProxyLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<any>;
  destroy?: unknown;
  cleanup?: unknown;
};

export interface PdfPluginOptions {
  pdfjs?: PdfJsModule;
  workerSrc?: string;
  compatibilityMode?: "auto" | "modern" | "legacy";
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  useSystemFonts?: boolean;
  disableStream?: boolean;
  disableAutoFetch?: boolean;
  disableRange?: boolean;
  rangeChunkSize?: number;
  useFetchData?: boolean;
}

export interface PdfDocumentPreviewOptions {
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  isExternal?: boolean;
  viewport: HTMLElement;
  size: PreviewSize;
  fit: PreviewFit;
  zoom?: number;
  toolbar?: {
    setZoom(value: number | undefined): void;
  };
  pdfjs?: PdfJsModule;
  workerSrc?: string;
  compatibilityMode?: "auto" | "modern" | "legacy";
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  useSystemFonts?: boolean;
  disableStream?: boolean;
  disableAutoFetch?: boolean;
  disableRange?: boolean;
  rangeChunkSize?: number;
  useFetchData?: boolean;
  title?: string;
  fallbackTitle?: string;
  encryptedTitle?: string;
  encryptedMessage?: string;
  encryptedAction?: string;
  messages?: Partial<PreviewMessages>;
  revokeUrlOnDestroy?: boolean;
}

// 2D affine transform matrix multiplication helper
function multiplyMatrices(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

export function pdfPlugin(options: PdfJsModule | PdfPluginOptions = {}): PreviewPlugin {
  return {
    name: "pdf",
    match(file) {
      return file.mimeType === "application/pdf" || file.extension === "pdf";
    },
    async render(ctx) {
      const normalizedOptions = normalizePdfOptions(options);
      const url = createObjectUrl(ctx.file);
      const isExternal = Boolean(ctx.file.url);
      return renderPdfDocumentPreview({
        ...normalizedOptions,
        fileName: ctx.file.name,
        fileUrl: url,
        fileSize: ctx.file.size,
        isExternal,
        viewport: ctx.viewport,
        size: ctx.size,
        fit: ctx.options.fit,
        zoom: ctx.options.zoom,
        toolbar: ctx.toolbar,
        messages: ctx.options.messages,
        revokeUrlOnDestroy: true
      });
    }
  };
}

export async function renderPdfDocumentPreview(options: PdfDocumentPreviewOptions): Promise<{
  canCommand(command: string): boolean;
  command(command: string): boolean;
  resize(size: PreviewSize): void;
  preparePrint?(): void | Promise<void>;
  destroy(): void;
}> {
  const useLegacyCompatibility = shouldUseLegacyPdfCompatibility(options.compatibilityMode);
  if (useLegacyCompatibility) {
    installPromiseWithResolversPolyfill();
  }
  const pdf = options.pdfjs || (await import("pdfjs-dist"));
  const messages: PreviewMessages = { ...defaultMessages["en-US"], ...options.messages };
  configurePdfWorker(pdf, options.workerSrc, useLegacyCompatibility);

  const viewer = document.createElement("div");
  viewer.className = "ofv-pdf-viewer";
  if (options.title) {
    const title = document.createElement("strong");
    title.className = "ofv-pdf-viewer-title";
    title.textContent = options.title;
    viewer.append(title);
  }
  const summary = document.createElement("div");
  summary.className = "ofv-pdf-summary";
  summary.hidden = true;
  summary.setAttribute("aria-hidden", "true");
  summary.style.display = "none";
  const scroller = document.createElement("div");
  scroller.className = "ofv-pdf ofv-pdf-pages";
  viewer.append(summary, scroller);
  options.viewport.append(viewer);

  const showDocumentFallback = (error: unknown) => {
    viewer.remove();
    const fileLike = {
      source: options.fileUrl,
      name: options.fileName,
      extension: options.fileName.includes(".") ? options.fileName.split(".").pop() || "pdf" : "pdf",
      mimeType: "application/pdf",
      size: options.fileSize,
      url: options.fileUrl
    };
    const fallback = isEncryptedError(error)
      ? createEncryptedFallback(fileLike, options.fileUrl, {
          title: options.encryptedTitle || messages.pdfEncryptedTitle,
          message: options.encryptedMessage || messages.pdfEncryptedMessage,
          action: options.encryptedAction || messages.pdfDownload
        })
      : createPdfFallback(options.fileName, options.fileUrl, normalizePdfError(error, messages), messages, options.fallbackTitle);
    if (!fallback.classList.contains("ofv-pdf-web-fallback")) {
      options.viewport.classList.add("ofv-center");
    }
    options.viewport.append(fallback);
  };

  let documentTask: ReturnType<PdfJsModule["getDocument"]> | undefined;
  let doc: PdfDocumentProxyLike | undefined;
  try {
    const pdfData = options.useFetchData ? await loadPdfData(options.fileUrl) : undefined;
    documentTask = pdf.getDocument({
      ...(pdfData ? { data: pdfData } : { url: options.fileUrl }),
      cMapUrl: options.cMapUrl ?? `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdf.version}/cmaps/`,
      cMapPacked: options.cMapPacked ?? true,
      standardFontDataUrl: options.standardFontDataUrl ?? `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdf.version}/standard_fonts/`,
      useSystemFonts: options.useSystemFonts ?? true,
      disableStream: options.disableStream,
      disableAutoFetch: options.disableAutoFetch,
      disableRange: options.disableRange,
      rangeChunkSize: options.rangeChunkSize
    });
    doc = (await documentTask.promise.catch((error: unknown) => {
      showDocumentFallback(error);
      return undefined;
    })) as PdfDocumentProxyLike | undefined;
  } catch (error) {
    showDocumentFallback(error);
  }

  if (!doc) {
    return {
      canCommand() {
        return false;
      },
      command() {
        return false;
      },
      resize() {},
      destroy() {
        options.viewport.classList.remove("ofv-center");
        destroyPdfResource(documentTask);
        if (options.revokeUrlOnDestroy) {
          revokeObjectUrl(options.fileUrl, Boolean(options.isExternal));
        }
      }
    };
  }
  const pdfDocument = doc;

  const pagesMeta: Array<{ width: number; height: number; rotation: number }> = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    try {
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      pagesMeta.push({
        width: baseViewport.width,
        height: baseViewport.height,
        rotation: getPdfPageRotation(page)
      });
    } catch {
      pagesMeta.push({ width: 612, height: 792, rotation: 0 });
    }
  }

  const pageStates: Array<{
    wrapper: HTMLDivElement;
    canvas: HTMLCanvasElement | null;
    renderTask: any | null;
    renderPromise: Promise<void> | null;
    rendered: boolean;
  }> = [];

  let observer: IntersectionObserver | null = null;
  let printPreparation: Promise<void> | undefined;
  let currentSize = options.size;
  let zoomFactor = getInitialZoom({ options: { zoom: options.zoom ?? 1 } }, 0.25, 4);
  let rotation = 0;
  let currentPage = 1;

  // The scroller's clientWidth already excludes its (persistent) scrollbars;
  // sizing pages from the outer viewer width would overflow by the scrollbar
  // width and show a permanent sliver of horizontal scroll at 100%.
  const resolveLayoutWidth = (size: PreviewSize) =>
    scroller.clientWidth > 0 ? scroller.clientWidth : size.width;
  const resolveLayoutHeight = (size: PreviewSize) =>
    scroller.clientHeight > 0 ? scroller.clientHeight : size.height;

  const goToPage = (page: number, scroll = true) => {
    currentPage = Math.min(pdfDocument.numPages, Math.max(1, Math.round(page) || 1));
    pageNavigator.setCurrent(currentPage);
    const wrapper = pageStates[currentPage - 1]?.wrapper;
    if (!scroll || !wrapper) {
      return;
    }
    const top = Math.max(0, wrapper.offsetTop - 16);
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top, behavior: "smooth" });
    } else {
      scroller.scrollTop = top;
    }
  };

  const pageNavigator = createPdfPageNavigator(pdfDocument.numPages, messages, (page) => goToPage(page));
  viewer.insertBefore(pageNavigator.element, summary);

  const handleScrollerScroll = () => {
    const scrollerRect = scroller.getBoundingClientRect();
    const targetY = scrollerRect.top + Math.min(Math.max(scroller.clientHeight * 0.25, 40), 180);
    let nearestPage = currentPage;
    let nearestDistance = Number.POSITIVE_INFINITY;
    pageStates.forEach((state, index) => {
      const distance = Math.abs(state.wrapper.getBoundingClientRect().top - targetY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = index + 1;
      }
    });
    if (nearestPage !== currentPage) {
      currentPage = nearestPage;
      pageNavigator.setCurrent(currentPage);
    }
  };
  scroller.addEventListener("scroll", handleScrollerScroll, { passive: true });

  const updateSummary = () => {
    renderPdfSummary(summary, pdfDocument.numPages, pagesMeta, options.fit, zoomFactor, messages);
    options.toolbar?.setZoom(zoomFactor);
  };

  const clearPage = (pageIdx: number) => {
    const state = pageStates[pageIdx];
    if (!state || !state.rendered) return;

    if (state.renderTask) {
      try {
        state.renderTask.cancel();
      } catch (e) {
        // Ignore cancel errors
      }
      state.renderTask = null;
    }

    state.canvas = null;
    state.rendered = false;
    state.wrapper.replaceChildren();
    state.wrapper.append(
      createPageStatus("ofv-pdf-skeleton", formatPreviewMessage(messages.pdfPageLoading, { page: pageIdx + 1 }))
    );
  };

  const renderPage = async (pageIdx: number, size: PreviewSize) => {
    const state = pageStates[pageIdx];
    if (!state) return;

    while (state.renderPromise) {
      await state.renderPromise;
    }
    if (state.rendered) return;

    state.rendered = true;
    const renderPromise = (async () => {
      try {
        const page = await pdfDocument.getPage(pageIdx + 1);
        const meta = pagesMeta[pageIdx];
        const scale = resolvePdfPageScale(
          meta,
          options.fit,
          resolveLayoutWidth(size),
          resolveLayoutHeight(size),
          zoomFactor,
          rotation
        );
        const viewport = page.getViewport({ scale, rotation: getPdfRenderRotation(meta, rotation) });
        const outputScale = getPdfOutputScale();
        const cssWidth = Math.floor(viewport.width);
        const cssHeight = Math.floor(viewport.height);

        const canvas = document.createElement("canvas");
        canvas.className = "ofv-pdf-page";
        canvas.width = Math.floor(cssWidth * outputScale);
        canvas.height = Math.floor(cssHeight * outputScale);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas 2D context is not available.");
        }

        state.wrapper.replaceChildren(canvas);
        state.canvas = canvas;

        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
        });
        state.renderTask = renderTask;

        await renderTask.promise;
        state.renderTask = null;

        const textContent = await page.getTextContent();
        const textLayer = document.createElement("div");
        textLayer.className = "ofv-pdf-text-layer";
        textLayer.style.width = `${cssWidth}px`;
        textLayer.style.height = `${cssHeight}px`;
        state.wrapper.appendChild(textLayer);

        for (const item of textContent.items) {
          if (!("str" in item)) continue;
          const str = (item as any).str;
          if (!str.trim()) continue;

          const tx = multiplyMatrices(viewport.transform, (item as any).transform);
          const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);

          const span = document.createElement("span");
          span.textContent = str;
          span.style.fontSize = `${fontHeight}px`;
          span.style.lineHeight = "1";
          span.style.height = `${fontHeight}px`;
          span.style.fontFamily = (item as any).fontName || "sans-serif";
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - fontHeight}px`;
          span.style.transformOrigin = "0% 0%";

          textLayer.appendChild(span);

          if ((item as any).width) {
            const itemWidth = (item as any).width * scale;
            const actualWidth = span.offsetWidth || span.getBoundingClientRect().width;
            if (actualWidth > 0 && Math.abs(actualWidth - itemWidth) > 1) {
              span.style.transform = `scaleX(${itemWidth / actualWidth})`;
            }
          }
        }
        if (textLayer.childElementCount === 0 && isCanvasVisuallyBlank(canvas, context)) {
          state.wrapper.appendChild(
            createPageStatus(
              "ofv-pdf-empty",
              messages.pdfPageEmpty
            )
          );
        }
      } catch (err) {
        console.error(`Failed to render PDF page ${pageIdx + 1}:`, err);
        state.rendered = false;
        state.wrapper.replaceChildren(
          createPageStatus("ofv-pdf-error", messages.pdfPageRenderFailed)
        );
      }
    })();
    state.renderPromise = renderPromise;
    try {
      await renderPromise;
    } finally {
      if (state.renderPromise === renderPromise) {
        state.renderPromise = null;
      }
    }
  };

  const renderLayout = (size: PreviewSize) => {
    observer?.disconnect();
    updateSummary();
    scroller.replaceChildren();
    pageStates.length = 0;

    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const pageIdx = parseInt(entry.target.getAttribute("data-page-index") || "0", 10);
            const state = pageStates[pageIdx];
            if (!state) return;

            if (entry.isIntersecting) {
              if (!state.rendered) {
                void renderPage(pageIdx, size);
              }
            } else if (!printPreparation && state.rendered && pdfDocument.numPages > 8) {
              clearPage(pageIdx);
            }
          });
        },
        {
          root: scroller,
          rootMargin: "400px 0px 400px 0px"
        }
      );
    }

    for (let i = 0; i < pdfDocument.numPages; i++) {
      const meta = pagesMeta[i];
      const rotatedWidth = rotatedPdfWidth(meta, rotation);
      const rotatedHeight = rotatedPdfHeight(meta, rotation);
      const scale = resolvePdfPageScale(
        meta,
        options.fit,
        resolveLayoutWidth(size),
        resolveLayoutHeight(size),
        zoomFactor,
        rotation
      );

      const w = Math.floor(rotatedWidth * scale);
      const h = Math.floor(rotatedHeight * scale);

      const wrapper = document.createElement("div");
      wrapper.className = "ofv-pdf-page-wrapper";
      wrapper.setAttribute("data-page-index", String(i));
      wrapper.setAttribute("aria-label", formatPreviewMessage(messages.pdfPageLabel, { page: i + 1 }));
      wrapper.style.width = `${w}px`;
      wrapper.style.height = `${h}px`;
      wrapper.append(createPageStatus("ofv-pdf-skeleton", formatPreviewMessage(messages.pdfPageLoading, { page: i + 1 })));

      scroller.appendChild(wrapper);

      pageStates.push({
        wrapper,
        canvas: null,
        renderTask: null,
        renderPromise: null,
        rendered: false
      });

      if (observer) {
        observer.observe(wrapper);
      } else {
        void renderPage(i, size);
      }
    }

    if (observer) {
      window.setTimeout(() => {
        const eagerPages = pdfDocument.numPages > 8 ? 2 : pdfDocument.numPages;
        for (let i = 0; i < eagerPages; i++) {
          void renderPage(i, size);
        }
      }, 0);
    }
    goToPage(currentPage, false);
  };

  renderLayout(options.size);

  // Zooming past the container width anchors the page at its left edge, which
  // reads as "nothing changed" on overlay-scrollbar platforms. Keep the page
  // center in view instead, like native PDF viewers do.
  const centerHorizontalScroll = () => {
    scroller.scrollLeft = Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2);
  };

  let resizeTimer: number | undefined;
  return {
    canCommand(command) {
      return (
        command === "zoom-in" ||
        command === "zoom-out" ||
        command === "zoom-reset" ||
        command === "rotate-right" ||
        command === "rotate-left"
      );
    },
    command(command) {
      if (command === "zoom-in") {
        zoomFactor = Math.min(4, zoomFactor + 0.15);
        renderLayout(currentSize);
        centerHorizontalScroll();
        return true;
      }
      if (command === "zoom-out") {
        zoomFactor = Math.max(0.25, zoomFactor - 0.15);
        renderLayout(currentSize);
        centerHorizontalScroll();
        return true;
      }
      if (command === "zoom-reset") {
        zoomFactor = 1;
        rotation = 0;
        renderLayout(currentSize);
        centerHorizontalScroll();
        return true;
      }
      if (command === "rotate-right" || command === "rotate-left") {
        rotation = normalizePdfRotation(rotation + (command === "rotate-right" ? 90 : -90));
        renderLayout(currentSize);
        return true;
      }
      return false;
    },
    resize(size) {
      currentSize = size;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        renderLayout(size);
      }, 120);
    },
    preparePrint() {
      if (printPreparation) {
        return printPreparation;
      }
      const activeObserver = observer;
      activeObserver?.disconnect();
      printPreparation = (async () => {
        let nextPage = 0;
        const renderNext = async () => {
          while (nextPage < pageStates.length) {
            const pageIndex = nextPage;
            nextPage += 1;
            await renderPage(pageIndex, currentSize);
          }
        };
        const workerCount = Math.min(3, pageStates.length);
        await Promise.all(Array.from({ length: workerCount }, () => renderNext()));
      })().finally(() => {
        if (observer === activeObserver) {
          for (const state of pageStates) {
            activeObserver?.observe(state.wrapper);
          }
        }
        printPreparation = undefined;
      });
      return printPreparation;
    },
    destroy() {
      options.toolbar?.setZoom(undefined);
      pageNavigator.destroy();
      scroller.removeEventListener("scroll", handleScrollerScroll);
      window.clearTimeout(resizeTimer);
      observer?.disconnect();

      pageStates.forEach((state) => {
        if (state.renderTask) {
          try {
            state.renderTask.cancel();
          } catch (e) {
            // Ignore
          }
        }
      });
      pageStates.length = 0;

      destroyPdfResource(pdfDocument);
      destroyPdfResource(documentTask);
      if (options.revokeUrlOnDestroy) {
        revokeObjectUrl(options.fileUrl, Boolean(options.isExternal));
      }
    }
  };
}

function destroyPdfResource(resource: unknown): void {
  if (!resource || typeof resource !== "object") {
    return;
  }
  const candidate = resource as { destroy?: unknown; cleanup?: unknown };
  if (typeof candidate.destroy === "function") {
    void candidate.destroy();
    return;
  }
  if (typeof candidate.cleanup === "function") {
    void candidate.cleanup();
  }
}

function getPdfOutputScale(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  // A 1x backing canvas loses the small labels inside raster-heavy PDFs after
  // fit-to-container scaling. Keep two backing pixels per CSS pixel even on
  // standard-density displays, while retaining the existing memory cap.
  return Math.max(2, Math.min(window.devicePixelRatio || 1, 2.5));
}

function getPdfAvailableWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 1;
  }
  const gutter = width < 160 ? 16 : 32;
  return Math.max(1, width - gutter);
}

function getPdfAvailableHeight(height: number): number {
  if (!Number.isFinite(height) || height <= 0) {
    return 1;
  }
  const gutter = height < 160 ? 16 : 32;
  return Math.max(1, height - gutter);
}

function resolvePdfPageScale(
  meta: { width: number; height: number },
  fit: PreviewFit,
  layoutWidth: number,
  layoutHeight: number,
  zoomFactor: number,
  rotation: number
): number {
  const widthScale = getPdfAvailableWidth(layoutWidth) / rotatedPdfWidth(meta, rotation);
  const heightScale = getPdfAvailableHeight(layoutHeight) / rotatedPdfHeight(meta, rotation);
  let fitScale: number;
  switch (fit) {
    case "actual":
      fitScale = 1;
      break;
    case "width":
      fitScale = widthScale;
      break;
    case "height":
      fitScale = heightScale;
      break;
    case "cover":
      fitScale = Math.max(widthScale, heightScale);
      break;
    case "scale-down":
      fitScale = Math.min(1, widthScale, heightScale);
      break;
    case "contain":
    default:
      fitScale = Math.min(widthScale, heightScale);
      break;
  }
  return Math.max(0.05, Math.min(5, fitScale * zoomFactor));
}

function renderPdfSummary(
  summary: HTMLElement,
  pages: number,
  pagesMeta: Array<{ width: number; height: number }>,
  fit: PreviewFit,
  zoomFactor: number,
  messages: PreviewMessages
): void {
  summary.replaceChildren();
  appendPdfSummary(summary, messages.pdfSummaryPages, String(pages));
  const pageSizes = formatPdfPageSizes(pagesMeta);
  if (pageSizes) {
    appendPdfSummary(summary, messages.pdfSummaryPageSizes, pageSizes);
  }
  appendPdfSummary(summary, messages.pdfSummaryFit, fit === "actual" ? messages.pdfSummaryActualSize : messages.pdfSummaryFitWidth);
  appendPdfSummary(summary, messages.pdfSummaryZoom, `${Math.round(zoomFactor * 100)}%`);
}

function appendPdfSummary(parent: HTMLElement, label: string, value: string): void {
  const item = document.createElement("span");
  const key = document.createElement("span");
  key.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  item.append(key, content);
  parent.append(item);
}

function normalizePdfRotation(value: number): number {
  return ((value % 360) + 360) % 360;
}

function getPdfPageRotation(page: { rotate?: unknown }): number {
  const rotation = Number(page.rotate);
  return Number.isFinite(rotation) ? normalizePdfRotation(rotation) : 0;
}

function getPdfRenderRotation(meta: { rotation?: number }, userRotation: number): number {
  return normalizePdfRotation((meta.rotation || 0) + userRotation);
}

function isPdfRotatedSideways(rotation: number): boolean {
  const normalized = normalizePdfRotation(rotation);
  return normalized === 90 || normalized === 270;
}

function rotatedPdfWidth(meta: { width: number; height: number }, rotation: number): number {
  return isPdfRotatedSideways(rotation) ? meta.height : meta.width;
}

function rotatedPdfHeight(meta: { width: number; height: number }, rotation: number): number {
  return isPdfRotatedSideways(rotation) ? meta.width : meta.height;
}

function formatPdfPageSizes(pagesMeta: Array<{ width: number; height: number }>): string {
  const counts = new Map<string, number>();
  for (const page of pagesMeta) {
    const key = `${Math.round(page.width)} x ${Math.round(page.height)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([size, count]) => (count > 1 ? `${size} (${count})` : size))
    .join(", ");
}

function normalizePdfOptions(options: PdfJsModule | PdfPluginOptions): PdfPluginOptions {
  if ("getDocument" in options) {
    return { pdfjs: options };
  }
  return options;
}

async function loadPdfData(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load PDF data: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function isCanvasVisuallyBlank(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): boolean {
  if (canvas.width === 0 || canvas.height === 0 || typeof context.getImageData !== "function") {
    return false;
  }
  try {
    const sampleWidth = Math.min(canvas.width, 96);
    const sampleHeight = Math.min(canvas.height, 96);
    const stepX = Math.max(1, Math.floor(canvas.width / sampleWidth));
    const stepY = Math.max(1, Math.floor(canvas.height / sampleHeight));
    let sampled = 0;
    let nonBlank = 0;
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const pixel = context.getImageData(x, y, 1, 1).data;
        const red = pixel[0];
        const green = pixel[1];
        const blue = pixel[2];
        const alpha = pixel[3];
        sampled += 1;
        if (alpha > 8 && (red < 248 || green < 248 || blue < 248)) {
          nonBlank += 1;
          if (nonBlank / sampled > 0.002) {
            return false;
          }
        }
      }
    }
    return sampled > 0;
  } catch {
    return false;
  }
}

function createPageStatus(className: string, text: string): HTMLDivElement {
  const status = document.createElement("div");
  status.className = className;
  status.textContent = text;
  return status;
}

function createPdfFallback(
  fileName: string,
  url: string,
  message: string,
  messages: PreviewMessages,
  titleText = messages.pdfPreviewFailedTitle
): HTMLElement {
  if (isEmbeddableRemoteUrl(url)) {
    return createPdfWebFallback(fileName, url);
  }

  const fallback = document.createElement("div");
  fallback.className = "ofv-fallback";

  const title = document.createElement("strong");
  title.textContent = titleText;

  const meta = document.createElement("span");
  meta.textContent = `${message} ${fileName}`;

  const download = document.createElement("a");
  download.href = url;
  download.download = fileName;
  download.textContent = messages.pdfDownload;

  fallback.append(title, meta, download);
  return fallback;
}

function createPdfWebFallback(fileName: string, url: string): HTMLElement {
  const fallback = document.createElement("div");
  fallback.className = "ofv-pdf-web-fallback";

  const iframe = document.createElement("iframe");
  iframe.className = "ofv-pdf-web-fallback-frame";
  iframe.src = url;
  iframe.title = `${fileName} HTML preview`;
  iframe.setAttribute("sandbox", "allow-forms allow-popups allow-presentation allow-same-origin");

  fallback.append(iframe);
  return fallback;
}

function isEmbeddableRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function normalizePdfError(error: unknown, messages: PreviewMessages): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name?: unknown }).name) : "";
  const lower = `${name} ${message}`.toLowerCase();
  if (lower.includes("invalid") || lower.includes("missing") || lower.includes("corrupt")) {
    return messages.pdfCorruptedMessage;
  }
  return messages.pdfCannotLoadMessage;
}

function createPdfPageNavigator(
  total: number,
  messages: PreviewMessages,
  onChange: (page: number) => void
): { element: HTMLElement; setCurrent(page: number): void; destroy(): void } {
  const element = document.createElement("div");
  element.className = "ofv-pdf-page-navigator";

  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "‹";
  previous.title = messages.pdfPreviousPage;
  previous.setAttribute("aria-label", messages.pdfPreviousPage);

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = String(total);
  input.value = "1";
  input.inputMode = "numeric";
  input.setAttribute("aria-label", messages.pdfPageInput);

  const position = document.createElement("span");
  position.textContent = formatPreviewMessage(messages.pdfPagePosition, { total });

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  next.title = messages.pdfNextPage;
  next.setAttribute("aria-label", messages.pdfNextPage);

  const commit = () => onChange(Number(input.value));
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      commit();
    }
  };
  const handlePrevious = () => onChange(Number(input.value) - 1);
  const handleNext = () => onChange(Number(input.value) + 1);
  input.addEventListener("change", commit);
  input.addEventListener("keydown", handleKeydown);
  previous.addEventListener("click", handlePrevious);
  next.addEventListener("click", handleNext);
  element.append(previous, input, position, next);

  return {
    element,
    setCurrent(page) {
      input.value = String(page);
      previous.disabled = page <= 1;
      next.disabled = page >= total;
    },
    destroy() {
      input.removeEventListener("change", commit);
      input.removeEventListener("keydown", handleKeydown);
      previous.removeEventListener("click", handlePrevious);
      next.removeEventListener("click", handleNext);
    }
  };
}

function configurePdfWorker(pdf: PdfJsModule, workerSrc?: string, legacy = false): void {
  if (workerSrc) {
    pdf.GlobalWorkerOptions.workerSrc = workerSrc;
    return;
  }

  if (!pdf.GlobalWorkerOptions.workerSrc && typeof window !== "undefined") {
    const build = legacy ? "legacy/build" : "build";
    pdf.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdf.version}/${build}/pdf.worker.mjs`;
  }
}

function shouldUseLegacyPdfCompatibility(mode: PdfPluginOptions["compatibilityMode"] = "auto"): boolean {
  if (mode === "legacy") {
    return true;
  }
  if (mode === "modern") {
    return false;
  }

  const promise = Promise as PromiseConstructor & { withResolvers?: unknown };
  if (typeof promise.withResolvers !== "function") {
    return true;
  }

  if (typeof navigator === "undefined") {
    return false;
  }
  return /(?:QIHU|360SE|360EE)/i.test(navigator.userAgent);
}

function installPromiseWithResolversPolyfill(): void {
  const promise = Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };
  if (typeof promise.withResolvers === "function") {
    return;
  }

  Object.defineProperty(promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: <T>() => {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const pending = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise: pending, resolve, reject };
    }
  });
}
