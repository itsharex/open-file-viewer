# @open-file-viewer/core

Framework-agnostic browser file preview core for Open File Viewer.

Open File Viewer renders files inside your own DOM container instead of opening a new window. It supports images, PDF, Office documents, audio, video, text/code, archives, email, drawings, CAD, 3D, GIS, data and design asset formats through a plugin-based pipeline.

DWG/DWF are proprietary binary CAD formats. `cadPlugin()` uses a two-layer model: it tries the built-in LibreDWG WASM DWG preview by default, then falls back to embedded thumbnails or metadata; applications can use `binaryRenderer` as the highest-priority override for custom renderers or server-side CAD conversion services.

Data/design asset previews are pure frontend where practical: SQLite shows header, schema and sample rows from common table leaf pages; PDF-compatible Illustrator files embed a browser PDF preview; PSD/PSB tries the Photoshop composite image; XPS/OXPS renders a lightweight FixedPage SVG view plus extracted text and package structure.

- Website: https://open-file-viewer-workspace.void.app
- GitHub: https://github.com/xushanpei/open-file-viewer
- npm: https://www.npmjs.com/package/@open-file-viewer/core

## Install

```bash
npm install @open-file-viewer/core
```

PDF preview requires `pdfjs-dist`:

```bash
npm install pdfjs-dist
```

DWG geometry preview uses optional LibreDWG WASM. The package can be installed by applications that want the default built-in DWG linework path:

```bash
npm install @mlightcad/libredwg-web
```

Copy `libredwg-web.wasm` to a public directory and point `cadPlugin` to it:

```ts
cadPlugin({ libreDwg: { wasmBaseUrl: "/vendor/libredwg-web" } });
```

Native browser video formats such as MP4, WebM and MOV do not need extra dependencies. HLS uses `hls.js`, which is bundled with the core package. FLV and MPEG-TS/M2TS playback is optional: install `mpegts.js` in your application only if you need those formats. If it is not installed, `videoPlugin()` shows the built-in download fallback for FLV/M2TS files.

```bash
npm install mpegts.js
```

`mpegts.js` currently depends on a git-based `webworkify-webpack` fork. pnpm 11 users with `blockExoticSubdeps` enabled can keep `@open-file-viewer/core` installed normally because `mpegts.js` is no longer a required dependency. If your app really needs FLV/M2TS playback, either allow that dependency in your app or override it to the npm release:

```json
{
  "pnpm": {
    "overrides": {
      "webworkify-webpack": "2.1.5"
    }
  }
}
```

## Quick Start

```ts
import {
  createViewer,
  imagePlugin,
  videoPlugin,
  audioPlugin,
  textPlugin,
  pdfPlugin,
  officePlugin,
  archivePlugin,
  emailPlugin,
  drawingPlugin,
  cadPlugin,
  model3dPlugin,
  gisPlugin,
  fallbackPlugin
} from "@open-file-viewer/core";
import "@open-file-viewer/core/style.css";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

const viewer = createViewer({
  container: "#viewer",
  file: fileOrUrl,
  fileName: "contract.pdf",
  width: "100%",
  height: "70vh",
  fit: "contain",
  toolbar: true,
  theme: "auto",
  plugins: [
    imagePlugin(),
    videoPlugin(),
    audioPlugin(),
    textPlugin(),
    pdfPlugin({ workerSrc: pdfWorkerSrc }),
    officePlugin(),
    archivePlugin(),
    emailPlugin(),
    drawingPlugin(),
    cadPlugin(),
    model3dPlugin(),
    gisPlugin(),
    fallbackPlugin()
  ]
});

viewer.resize();
viewer.destroy();
```

### PDF loading compatibility

If PDF preview falls back in Umi Max, utoo pack or similar build environments and the console shows
`Cannot set properties of undefined (setting 'onPull')` from pdf.js, enable `useFetchData`. It fetches
the PDF bytes on the main thread and then passes `data` to pdf.js, avoiding the worker network stream
path that can break in those bundlers:

```ts
pdfPlugin({
  workerSrc: pdfWorkerSrc,
  useFetchData: true
});
```

This keeps compatibility at the cost of holding one extra copy of the PDF in memory, so use it only
for affected environments.

For 360 Secure Browser, 360 Extreme Browser, and older Chromium kernels, `pdfPlugin()` defaults to
`compatibilityMode: "auto"`. It installs the `Promise.withResolvers` compatibility shim when needed
and selects the matching PDF.js legacy worker. If an enterprise browser hides its 360 user-agent
marker, force the compatibility path with `pdfPlugin({ compatibilityMode: "legacy" })`. When
self-hosting that worker, point `workerSrc` to the same-version
`pdfjs-dist/legacy/build/pdf.worker.min.mjs`. Use `compatibilityMode: "modern"` only when targeting
modern Chrome or Edge exclusively.

## High-Fidelity Office Conversion

Browser-side Office renderers cannot perfectly reproduce Word/WPS layout for files with anchored
textboxes, absolute positioning, custom fonts, headers/footers or legacy binary formats. For those
files, configure `officePlugin({ convert })` to send the file to your own LibreOffice, OnlyOffice or
Microsoft Graph conversion service and return a PDF. The converted PDF is rendered by the built-in
PDF viewer.

```ts
officePlugin({
  pdf: { workerSrc: pdfWorkerSrc },
  async convert({ file, arrayBuffer, reason }) {
    const form = new FormData();
    form.append("file", new Blob([arrayBuffer]), file.name);
    form.append("reason", reason);

    const response = await fetch("/api/office/convert-to-pdf", {
      method: "POST",
      body: form
    });

    if (!response.ok) {
      throw new Error("Office conversion failed");
    }

    return {
      blob: await response.blob(),
      fileName: file.name.replace(/\.[^.]+$/, ".pdf"),
      mimeType: "application/pdf"
    };
  }
});
```

Open File Viewer does not upload files by default. The conversion hook is only called when you
explicitly configure it, and currently targets `complex-docx` and `legacy-office` cases. You can also
return `{ url, fileName, mimeType: "application/pdf" }` when your service stores the converted PDF.

## CAD Customization

`cadPlugin()` has two CAD preview layers:

1. Default built-in path: DWG automatically tries LibreDWG WASM. If linework cannot be produced but the file contains an embedded preview image, the plugin shows that thumbnail. If the engine is unavailable or parsing fails, it shows DWG/DWF metadata and conversion guidance.
2. External enhancement path: `binaryRenderer` can take over DWG/DWF completely for CADViewer, MxCAD, a custom WebGL/SVG renderer, or a backend PNG/PDF/SVG/DXF conversion service.

Use the built-in DWG preview for lightweight local rendering:

```ts
cadPlugin({ libreDwg: { wasmBaseUrl: "/vendor/libredwg-web" } });
```

Disable it when you only want metadata and conversion guidance:

```ts
cadPlugin({ libreDwg: false });
```

Or let a custom renderer/service take over DWG/DWF completely. This is the recommended path for high-fidelity layouts, fonts, xrefs, print space, and production CAD workflows:

```ts
cadPlugin({
  async binaryRenderer({ panel, fileName, bytes }) {
    const result = await uploadToCadPreviewService(bytes, fileName);
    panel.append(result.element);
    return { destroy: () => result.dispose() };
  }
});
```

## Supported Inputs

`createViewer` accepts local files and remote sources:

- `File`
- `Blob`
- URL string
- `ArrayBuffer`
- multiple files through `files`

## Package Notes

Import the stylesheet once in your app:

```ts
import "@open-file-viewer/core/style.css";
```

React, Vue and Svelte adapters are available as separate packages:

```bash
npm install @open-file-viewer/react
npm install @open-file-viewer/vue
npm install @open-file-viewer/svelte
```

## Toolbar Customization

The toolbar can be configured from simple feature toggles to a fully custom renderer:

```ts
createViewer({
  container: "#viewer",
  file,
  toolbar: {
    labels: {
      download: "Download",
      fullscreen: "Fullscreen",
      search: "Search"
    },
    order: ["search", "download", "approve", "fullscreen"],
    actions: [
      {
        id: "approve",
        label: "Approve",
        onClick(ctx) {
          openApprovalDialog(ctx.file);
        }
      }
    ]
  },
  plugins
});
```

Use `toolbar.render(ctx)` when you need to replace the toolbar completely. The context exposes file metadata, queue navigation, preview commands, download, fullscreen, print and search helpers.

## Locale and Fallback Text

Built-in states, fallback panels, toolbar labels, and plugin messages default to English. Set `locale: "zh-CN"` for Simplified Chinese, or override individual PDF, image, text, Office, and custom-plugin strings with `messages`:

```ts
createViewer({
  container: "#viewer",
  file,
  locale: "zh-CN",
  messages: {
    unsupportedTitle: "No inline preview available",
    downloadFile: "Download original file",
    pdfPreviewFailedTitle: "Unable to open report",
    imageDownload: "Save original image"
  },
  plugins
});
```

The PDF viewer includes a synchronized page navigator with previous/next buttons and a numeric page input. Enter a page number and press Enter to jump directly to it.

## License

MIT
