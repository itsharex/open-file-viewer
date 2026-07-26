import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-markup";
import "./style.css";
import { initMotion } from "./motion";
import { initGithubStars } from "./github";

Prism.manual = true;

type SiteTheme = "dark" | "light";
type Language = "zh" | "en";

const zhTranslations: Record<string, string> = {
  "nav.docs": "文档",
  "nav.frameworks": "框架",
  "nav.formats": "格式",
  "nav.playground": "在线使用",
  "nav.about": "关于我们",
  "action.getStarted": "开始接入",
  "action.liveDemo": "在线体验",
  contents: "目录",
  "footer.text": "面向现代 Web 产品的文件预览 SDK。",
  "aria.primaryNav": "主导航",
  "aria.apiSections": "API 章节",
  "aria.aboutSections": "关于我们章节",
  "api.pageTitle": "API 参考 - Open File Viewer",
  "api.hero.title": "Open File Viewer 接入与 API 指南",
  "api.hero.eyebrow": "API 文档",
  "api.sidebar.overview": "能力概览",
  "api.sidebar.frameworks": "支持框架",
  "api.sidebar.install": "安装",
  "api.sidebar.optional": "可选依赖",
  "api.sidebar.quickStart": "快速接入",
  "api.sidebar.core": "核心 API",
  "api.sidebar.instance": "实例方法",
  "api.sidebar.toolbar": "工具栏自定义",
  "api.sidebar.plugins": "插件机制",
  "api.sidebar.builtIn": "插件清单",
  "api.sidebar.faq": "常见问题",
  "api.eyebrow.overview": "能力概览",
  "api.eyebrow.frameworks": "框架",
  "api.eyebrow.install": "安装",
  "api.eyebrow.optional": "可选依赖",
  "api.eyebrow.quickStart": "快速开始",
  "api.eyebrow.core": "核心 API",
  "api.eyebrow.instance": "预览器实例",
  "api.eyebrow.toolbar": "工具栏",
  "api.eyebrow.plugins": "插件协议",
  "api.eyebrow.builtIn": "内置插件",
  "api.eyebrow.faq": "常见问题",
  "api.overview.title": "从一个稳定容器开始接入文件预览",
  "api.overview.body":
    "Open File Viewer 由一个框架无关的 core 加多个 UI 适配器组成。核心负责文件识别、插件匹配、容器尺寸、工具栏命令、错误降级和生命周期；React、Vue、Svelte 适配器只是把同一套能力包装成组件。",
  "api.overview.plugins": "内置预览插件",
  "api.overview.protocol": "统一插件协议",
  "api.frameworks.title": "支持的框架",
  "api.frameworks.vanilla":
    "直接调用 <code>createViewer()</code>。适合任意 Web 页面、低代码平台、微前端容器和非框架项目。",
  "api.frameworks.react":
    "使用 <code>@open-file-viewer/react</code> 的 <code>FileViewer</code> 组件，支持 <code>renderToolbar</code> 完全替换工具栏。",
  "api.frameworks.vue":
    "使用 <code>@open-file-viewer/vue</code> 的 <code>OpenFileViewer</code> 组件，支持 <code>#toolbar</code> slot。",
  "api.frameworks.svelte":
    '使用 <code>@open-file-viewer/svelte</code> 的 <code>OpenFileViewer</code> 组件，支持 <code>slot="toolbar"</code> 和 <code>renderToolbar</code>。',
  "api.install.title": "安装",
  "api.install.body": "core 是必装包；如果使用具体框架，再安装对应适配器。",
  "api.install.stylesTitle": "样式必须引入",
  "api.install.stylesBody":
    "默认 UI、工具栏、错误态、各类插件容器都依赖 <code>@open-file-viewer/core/style.css</code>。业务项目可在它之后覆盖 CSS 变量或 class。",
  "api.optional.title": "按需安装的增强能力",
  "api.optional.body":
    "core 默认安装只包含通用预览能力。少数专有格式或流媒体格式需要业务项目按需安装额外依赖；未安装时，插件会展示元信息或下载降级，不会阻塞普通文件预览。",
  "api.optional.pdf":
    "<code>pdfPlugin()</code> 需要业务项目提供 <code>pdfjs-dist</code> worker 地址，适合 Vite、Webpack、Next.js 等不同构建环境自行处理 worker 资源。",
  "api.optional.dwg":
    "<code>cadPlugin()</code> 默认会尝试 LibreDWG WASM。需要 DWG 线稿预览时安装 <code>@mlightcad/libredwg-web</code> 并配置 <code>wasmBaseUrl</code>。",
  "api.optional.video":
    "<code>videoPlugin()</code> 对 MP4、WebM、MOV 等原生格式不需要额外依赖；FLV、MPEG-TS/M2TS 需要业务项目安装 <code>mpegts.js</code>，未安装时展示下载 fallback。",
  "api.optional.pnpmTitle": "pnpm 11 / blockExoticSubdeps 说明",
  "api.optional.pnpmBody":
    "<code>mpegts.js</code> 的上游依赖中包含 git 形式的 <code>webworkify-webpack</code>。因此 Open File Viewer 不再把它作为 core 强制依赖。只有确实需要 FLV/M2TS 播放时才安装它；如果你的 pnpm 配置阻止 git 子依赖，可以在业务项目中覆盖到 npm 版本，或继续使用内置下载降级。",
  "api.optional.umiTitle": "Umi / utoo PDF 兼容配置",
  "api.optional.umiBody":
    "如果 PDF 文件和 worker 都能正常访问，但预览仍进入 fallback，并且控制台出现 <code>Cannot set properties of undefined (setting 'onPull')</code>，可以开启 <code>useFetchData</code>，让主线程先读取 PDF 字节再交给 pdf.js，绕开 worker 网络流兼容问题。",
  "api.quickStart.title": "如何接入",
  "api.options.container":
    "必填。预览器挂载容器，传字符串时会通过 <code>document.querySelector</code> 查找。",
  "api.options.file": "单文件预览源。URL 需要目标资源允许跨域访问。",
  "api.options.files": "多文件队列。配合默认工具栏可以上一份、下一份切换。",
  "api.options.initialIndex": "多文件队列初始下标，默认从第一个文件开始。",
  "api.options.fileName":
    "当文件源不是 <code>File</code> 时建议传入，插件会根据扩展名判断格式。",
  "api.options.mimeType": "补充 MIME 类型，适合 Blob、ArrayBuffer 或扩展名不可靠的远程地址。",
  "api.options.size": "预览容器尺寸。常用 <code>100%</code>、<code>640px</code>、<code>70vh</code>。",
  "api.options.fit": "内容适配方式。不同插件会尽量遵循同一语义。",
  "api.options.plugins": "插件列表。按数组顺序匹配，建议把更具体的业务插件放在通用插件前面。",
  "api.options.fallback":
    "不支持格式的降级策略。需要完全自定义时配合 <code>renderFallback</code>。",
  "api.options.toolbar": "默认工具栏开关或配置对象，可控制按钮、文案、图标、顺序和业务动作。",
  "api.options.theme": "预览器主题。<code>auto</code> 会跟随系统或宿主环境。",
  "api.options.className": "添加到根节点的业务 class，便于局部样式覆盖。",
  "api.options.onLoad": "当前文件加载成功后触发。",
  "api.options.onError": "插件渲染或文件读取失败时触发。",
  "api.options.onUnsupported": "没有插件匹配当前文件时触发。",
  "api.instance.title": "实例方法",
  "api.instance.reload": "重新加载当前文件，或传入新文件源进行替换。",
  "api.instance.next": "切换到队列中的下一个文件。",
  "api.instance.previous": "切换到队列中的上一个文件。",
  "api.instance.goTo": "切换到指定下标。",
  "api.instance.getIndex": "返回当前队列下标。",
  "api.instance.resize": "容器尺寸变化后主动通知当前插件重新计算布局。",
  "api.instance.destroy": "销毁预览器、清理事件和插件资源。",
  "api.toolbar.title": "工具栏自定义",
  "api.toolbar.body":
    "工具栏可以从轻到重分三层定制：配置内置按钮、增加业务按钮、完全替换渲染。样式层也可以覆盖 <code>.ofv-toolbar</code>、<code>.ofv-toolbar button</code>、<code>.ofv-toolbar-search</code>。",
  "api.toolbar.labelsTitle": "自定义文案",
  "api.toolbar.labelsBody": "通过 <code>labels</code> 和 <code>titles</code> 调整按钮文案或业务术语。",
  "api.toolbar.orderTitle": "自定义顺序",
  "api.toolbar.orderBody": "<code>order</code> 同时支持内置按钮 ID 和业务按钮 ID。",
  "api.toolbar.iconsTitle": "自定义图标",
  "api.toolbar.iconsBody": "<code>icons</code> 接收 SVG 字符串、HTMLElement 或 SVGElement。",
  "api.toolbar.actionsTitle": "业务按钮",
  "api.toolbar.actionsBody":
    "<code>actions</code> 可增加审批、收藏、分享等按钮，并支持 hidden / disabled 函数。",
  "api.toolbar.replaceTitle": "在 React、Vue 或 Svelte 中完全替换工具栏",
  "api.plugins.title": "插件机制",
  "api.plugins.body":
    "插件只需要实现 <code>match(file)</code> 和 <code>render(ctx)</code>。当文件进入预览器时，core 会按插件数组顺序查找第一个匹配项，并把统一的上下文交给它渲染。",
  "api.plugins.orderTitle": "插件顺序很重要",
  "api.plugins.orderBody":
    "如果你有业务专属格式或服务端转换结果，建议把自定义插件放在通用插件之前，避免被 <code>textPlugin</code> 或 fallback 先匹配。",
  "api.builtIn.title": "内置插件清单",
  "api.builtIn.image": "jpg、png、gif、webp、avif、svg、bmp、ico、heic、heif 等图片格式。",
  "api.builtIn.pdf": "PDF 渲染、缩放、搜索、打印和高清画布渲染。",
  "api.builtIn.office": "doc、docx、xls、xlsx、pptx、rtf、odt、ods、odp 等 Office 与开放文档格式。",
  "api.builtIn.text": "txt、md、json、yaml、toml、代码文件和语法高亮。",
  "api.builtIn.archive": "zip、rar、7z、tar、gz 等压缩包目录和文件结构。",
  "api.builtIn.gis": "geojson、kml、kmz、gpx、topojson、shp 等地图数据。",
  "api.builtIn.model3d": "gltf、glb、obj、stl、fbx、dae、3mf、usdz 等 3D 模型。",
  "api.builtIn.cad":
    "dxf、step、ifc、gds、oas 等工程图纸与芯片版图预览；DWG 默认尝试 LibreDWG WASM，失败回缩略图或元信息，也可通过 <code>binaryRenderer</code> 接入 CADViewer、MxCAD 或转换服务。",
  "api.builtIn.email": "eml、msg、mbox 邮件正文、头部信息和附件结构。",
  "api.faq.title": "常见问题",
  "api.faq.remoteTitle": "远程 URL 预览为什么失败？",
  "api.faq.remoteBody":
    "浏览器必须能直接访问文件，并且目标地址需要允许 CORS。对于私有文件，建议由业务后端签发临时 URL，或先 fetch 成 Blob 再传给预览器。",
  "api.faq.resizeTitle": "容器宽度变化后如何避免排版问题？",
  "api.faq.resizeBody":
    "优先给外层容器稳定的 width / height，并在布局变化后调用实例的 <code>resize()</code>。内置插件会尽量把滚动限制在预览容器内部。",
  "api.faq.convertTitle": "如何接入服务端转换？",
  "api.faq.convertBody":
    "可以写一个自定义插件，在 <code>render(ctx)</code> 中调用你的转换服务，然后把返回的 HTML、图片、PDF 或结构化数据渲染到 <code>ctx.viewport</code>。",
  "api.faq.qiankunTitle": "qiankun / micro-app 子应用中 Office 预览为什么一直加载？",
  "api.faq.qiankunBody":
    "微前端沙箱会在子应用卸载时移除 window <code>message</code> 事件监听器，而 jszip 依赖的 <code>setImmediate</code> polyfill 正是基于它实现的，导致 <code>JSZip.loadAsync</code> 永远不返回，docx、xlsx、pptx、epub、ofd 等 zip 类预览停留在加载状态。新版本检测到 <code>__POWERED_BY_QIANKUN__</code> 等沙箱标志后会自动切换到基于 MessageChannel 的调度器；0.1.27 及更早版本可在子应用入口的所有 import 之前手动补丁 <code>window.setImmediate = (fn, ...args) =&gt; setTimeout(fn, 0, ...args)</code>。",
  "about.pageTitle": "关于我们 - Open File Viewer",
  "about.hero.title": "开源不易，感谢每一次认真使用。",
  "about.hero.eyebrow": "关于 Open File Viewer",
  "about.sidebar.openSource": "开源项目",
  "about.sidebar.support": "支持作者",
  "about.sidebar.thanks": "致谢",
  "about.eyebrow.openSource": "开源项目",
  "about.eyebrow.thanks": "致谢",
  "about.openSource.title": "把复杂文件预览沉淀成长期可维护的基础设施",
  "about.openSource.body":
    "Open File Viewer 会持续完善更多格式预览、框架接入和真实业务场景。项目希望为原生 JavaScript、React、Vue、Svelte 等技术栈提供一套稳定、可扩展、适合生产环境迭代的 Web 文件预览能力。",
  "about.openSource.formats": "文件格式与插件能力",
  "about.openSource.protocol": "统一预览容器与插件协议",
  "about.support.title": "支持这个项目继续进化",
  "about.support.body": "如果这个开源项目帮你节省了开发时间，欢迎给项目点一个免费的 GitHub Star。",
  "about.thanks.title": "每一次反馈，都会让预览体验更进一步",
  "about.thanks.body":
    "欢迎通过 GitHub Issue 反馈真实业务里的文件样例、排版问题、容器适配问题和新的格式诉求。项目会持续围绕更稳定的预览、更清晰的接入和更完整的格式覆盖向前迭代。",
  "about.thanks.issueTitle": "反馈问题",
  "about.thanks.issueBody": "遇到格式识别、渲染异常、移动端适配或工具栏交互问题时，欢迎提交可复现信息。",
  "about.thanks.caseTitle": "贡献案例",
  "about.thanks.caseBody": "如果你在业务中接入了 Open File Viewer，也欢迎分享使用场景和优化建议。"
};

const themeToggle = requiredElement<HTMLButtonElement>("#themeToggle");
const languageToggle = requiredElement<HTMLButtonElement>("#languageToggle");
const englishContent = new Map(
  Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]")).map((element) => [element, element.innerHTML])
);
const englishAlt = new Map(
  Array.from(document.querySelectorAll<HTMLElement>("[data-i18n-alt]")).map((element) => [element, element.getAttribute("alt") || ""])
);
const englishAria = new Map(
  Array.from(document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]")).map((element) => [
    element,
    element.getAttribute("aria-label") || ""
  ])
);
const englishTitle = document.title;
const pageTitleKey = document.body.classList.contains("about-doc-page") ? "about.pageTitle" : "api.pageTitle";
let language: Language = readStorage("ofv-language") === "zh" ? "zh" : "en";
let siteTheme: SiteTheme = readStorage("ofv-site-theme") === "light" ? "light" : "dark";

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required docs element: ${selector}`);
  }
  return element;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local preferences are optional.
  }
}

function iconSvg(id: string): string {
  return `<svg aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
}

function applySiteTheme(nextTheme: SiteTheme) {
  siteTheme = nextTheme;
  document.documentElement.dataset.siteTheme = siteTheme;
  themeToggle.innerHTML = iconSvg(siteTheme === "dark" ? "icon-sun" : "icon-moon");
  themeToggle.setAttribute(
    "aria-label",
    language === "zh"
      ? siteTheme === "dark"
        ? "切换到浅色模式"
        : "切换到深色模式"
      : siteTheme === "dark"
        ? "Switch to light mode"
        : "Switch to dark mode"
  );
  writeStorage("ofv-site-theme", siteTheme);
}

function applyLanguage(nextLanguage: Language) {
  language = nextLanguage;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = language === "zh" ? zhTranslations[pageTitleKey] : englishTitle;

  for (const [element, content] of englishContent) {
    const key = element.dataset.i18n;
    element.innerHTML = language === "zh" && key && zhTranslations[key] ? zhTranslations[key] : content;
  }
  for (const [element, alt] of englishAlt) {
    const key = element.dataset.i18nAlt;
    element.setAttribute("alt", language === "zh" && key && zhTranslations[key] ? zhTranslations[key] : alt);
  }
  for (const [element, ariaLabel] of englishAria) {
    const key = element.dataset.i18nAriaLabel;
    element.setAttribute("aria-label", language === "zh" && key && zhTranslations[key] ? zhTranslations[key] : ariaLabel);
  }

  languageToggle.textContent = language === "zh" ? "EN" : "ZH";
  languageToggle.setAttribute("aria-label", language === "zh" ? "切换到英文" : "Switch to Chinese");
  writeStorage("ofv-language", language);
  applySiteTheme(siteTheme);
}

function syncNavigationState(): void {
  document.documentElement.dataset.navState = window.scrollY > 36 ? "scrolled" : "top";
}

function setHighlightedCode(element: HTMLElement, source: string, languageName: string) {
  const grammar = Prism.languages[languageName] || Prism.languages.markup || Prism.languages.plain;
  element.className = `language-${languageName}`;
  element.parentElement?.classList.add(`language-${languageName}`);
  const highlighted = Prism.highlight(source, grammar, languageName);
  element.innerHTML = highlighted
    .split("\n")
    .map((line: string, index: number) => `<span class="code-line" style="--i:${index}">${line || "&nbsp;"}</span>`)
    .join("");
}

function highlightCodeBlocks() {
  for (const code of document.querySelectorAll<HTMLElement>("pre code")) {
    const languageName = code.dataset.language || "typescript";
    setHighlightedCode(code, code.textContent || "", languageName);
  }
}

themeToggle.addEventListener("click", () => {
  applySiteTheme(siteTheme === "dark" ? "light" : "dark");
});

languageToggle.addEventListener("click", () => {
  applyLanguage(language === "zh" ? "en" : "zh");
});

window.addEventListener("scroll", syncNavigationState, { passive: true });

applyLanguage(language);
highlightCodeBlocks();
syncNavigationState();
initMotion();
void initGithubStars();
requestAnimationFrame(() => {
  document.documentElement.dataset.siteReady = "true";
  document.documentElement.dataset.siteBoot = "ready";
});
