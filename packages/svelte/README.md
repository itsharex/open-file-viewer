# @open-file-viewer/svelte

Svelte adapter for Open File Viewer.

This package wraps `@open-file-viewer/core` as a Svelte component while keeping the same plugin system, toolbar, theme and responsive container behavior.

- Website: https://open-file-viewer-workspace.void.app
- GitHub: https://github.com/xushanpei/open-file-viewer
- npm: https://www.npmjs.com/package/@open-file-viewer/svelte

## Install

```bash
npm install @open-file-viewer/core @open-file-viewer/svelte
```

PDF preview requires `pdfjs-dist`:

```bash
npm install pdfjs-dist
```

## Quick Start

```svelte
<script lang="ts">
  import { OpenFileViewer } from "@open-file-viewer/svelte";
  import {
    imagePlugin,
    officePlugin,
    pdfPlugin,
    textPlugin
  } from "@open-file-viewer/core";
  import "@open-file-viewer/core/style.css";
  import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

  export let file: File;

  const plugins = [
    imagePlugin(),
    textPlugin(),
    pdfPlugin({ workerSrc: pdfWorkerSrc }),
    officePlugin()
  ];
</script>

<OpenFileViewer
  {file}
  fileName={file.name}
  width="100%"
  height="640px"
  fit="contain"
  toolbar
  theme="auto"
  {plugins}
/>
```

## Props

The component accepts the same preview options as `createViewer`, including:

- `file` / `files`
- `initialIndex`
- `fileName`
- `width` / `height`
- `fit`
- `toolbar`
- `theme`
- `plugins`
- `onLoad`
- `onError`
- `onUnsupported`

## Custom Toolbar

Use the `toolbar` slot when the toolbar needs product-specific controls:

```svelte
<OpenFileViewer files={files} plugins={plugins}>
  <svelte:fragment slot="toolbar" let:ctx>
    {#if ctx}
      <button disabled={!ctx.canPrevious} on:click={() => void ctx.previous()}>上一份</button>
      <span>{ctx.index + 1} / {ctx.length}</span>
      <button disabled={!ctx.canNext} on:click={() => void ctx.next()}>下一份</button>
      <button on:click={ctx.download}>下载</button>
      <button on:click={() => openApprovalDialog(ctx.file)}>审批</button>
    {/if}
  </svelte:fragment>
</OpenFileViewer>
```

For lighter customization, pass `toolbar.labels`, `toolbar.icons`, `toolbar.order` and `toolbar.actions`.

## License

MIT
