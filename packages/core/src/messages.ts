import type { PreviewLocale, PreviewMessages, PreviewOptions } from "./types";

export const defaultMessages: Record<PreviewLocale, PreviewMessages> = {
  "zh-CN": {
    loading: "正在加载预览...",
    unsupportedTitle: "当前文件暂不支持在线预览",
    downloadTitle: "当前文件可下载后查看",
    downloadFile: "下载文件",
    file: "文件",
    unnamedFile: "未命名文件",
    format: "格式",
    unknown: "未知",
    mime: "MIME",
    undeclared: "未声明",
    size: "大小",
    source: "来源",
    remoteUrl: "远程 URL",
    localFile: "本地/内存文件",
    textPlainLanguage: "纯文本",
    textLineCount: "{count} 行",
    textWrap: "换行",
    textCopy: "复制",
    textCopied: "已复制",
    textCopyFailed: "复制失败",
    textDownload: "下载",
    textDownloadReady: "下载已准备",
    textLargeFileNotice: "文件较大，当前展示前 {size}，复制和下载仍会使用完整内容。",
    textHighlightSkipped: "内容较大，已跳过语法高亮以保持滚动流畅。",
    textPreviewFailedTitle: "文本预览失败",
    textPreviewFailedMessage: "无法读取该文本内容，可能是远程文件不可访问或响应状态异常。",
    textOpenOriginal: "打开原文件",
    officeLegacyConversionTitle: "Office 转换提示",
    officeLegacyBinaryNotice:
      "属于旧版 Microsoft Office 二进制格式，浏览器内无法高保真解析；当前仅展示可信文本片段和结构指纹，完整排版建议接入 LibreOffice/OnlyOffice 服务端转换为 PDF/HTML。",
    officeLegacyMetaFormatType: "格式类型",
    officeLegacyMetaFileStructure: "文件结构",
    officeLegacyOleDetected: "检测到 OLE Compound File 签名",
    officeLegacyOleMissing: "未检测到标准 OLE 签名，按原始二进制尝试提取",
    officeLegacyMetaTextFragments: "文本片段",
    officeLegacyTextFragmentCount: "{count} 段",
    officeLegacyMetaParseStatus: "解析状态",
    officeLegacyReadableFragments: "可读文本片段",
    officeLegacyNoText: "未提取到稳定可读文本。该文件可能经过压缩、加密，或文本编码无法在浏览器端可靠识别；请使用服务端 LibreOffice/OnlyOffice 转换后预览。",
    officeLegacyWordParseFailed: "Word 二进制解析失败：{message}",
    officeSheetParseFailed: "表格解析失败：{message}",
    officeUnsupportedTitle: "Office 基础预览",
    officeUnsupportedLegacyMessage:
      "该格式属于老二进制或专有格式，浏览器内无法可靠解析；建议接入 LibreOffice/OnlyOffice 服务端转换为 PDF/HTML 后预览。",
    officeUnsupportedGenericMessage: "该格式通常需要服务端转换或专用解析器才能高保真预览。",
    officeUnsupportedIntro: "已进入 Office 插件。{message}",
    officeUnsupportedSupportedFormats:
      "当前版本优先支持 docx、rtf、odt/fodt、xlsx/xls/csv/ods、pptx/ppsx、odp/fodp 的基础内容预览。",
    officeErrorWithMessage: "解析器返回：{message}",
    officeErrorWithoutMessage: "解析器未返回具体错误信息。"
  },
  "en-US": {
    loading: "Loading preview...",
    unsupportedTitle: "Preview is not available for this file",
    downloadTitle: "This file can be downloaded and opened locally",
    downloadFile: "Download file",
    file: "File",
    unnamedFile: "Untitled file",
    format: "Format",
    unknown: "Unknown",
    mime: "MIME",
    undeclared: "Not declared",
    size: "Size",
    source: "Source",
    remoteUrl: "Remote URL",
    localFile: "Local or in-memory file",
    textPlainLanguage: "plain text",
    textLineCount: "{count} lines",
    textWrap: "Wrap",
    textCopy: "Copy",
    textCopied: "Copied",
    textCopyFailed: "Copy failed",
    textDownload: "Download",
    textDownloadReady: "Download ready",
    textLargeFileNotice: "Large file, showing the first {size}. Copy and download still use the full content.",
    textHighlightSkipped: "Large content, syntax highlighting was skipped to keep scrolling smooth.",
    textPreviewFailedTitle: "Text preview failed",
    textPreviewFailedMessage: "Unable to read this text content. The remote file may be unreachable or returned an invalid response.",
    textOpenOriginal: "Open original file",
    officeLegacyConversionTitle: "Office conversion guidance",
    officeLegacyBinaryNotice:
      "belongs to a legacy Microsoft Office binary format that cannot be rendered with high fidelity in the browser. The preview shows trusted text fragments and structural fingerprints; use a LibreOffice/OnlyOffice server conversion to PDF/HTML for complete layout fidelity.",
    officeLegacyMetaFormatType: "Format type",
    officeLegacyMetaFileStructure: "File structure",
    officeLegacyOleDetected: "OLE Compound File signature detected",
    officeLegacyOleMissing: "No standard OLE signature detected; extracting from raw binary data",
    officeLegacyMetaTextFragments: "Text fragments",
    officeLegacyTextFragmentCount: "{count} fragments",
    officeLegacyMetaParseStatus: "Parse status",
    officeLegacyReadableFragments: "Readable text fragments",
    officeLegacyNoText: "No stable readable text was extracted. The file may be compressed, encrypted, or use text encoding that cannot be reliably recognized in the browser; use LibreOffice/OnlyOffice server conversion before previewing.",
    officeLegacyWordParseFailed: "Word binary parse failed: {message}",
    officeSheetParseFailed: "Spreadsheet parse failed: {message}",
    officeUnsupportedTitle: "Office basic preview",
    officeUnsupportedLegacyMessage:
      "This is a legacy binary or proprietary format that cannot be reliably parsed in the browser; convert it to PDF/HTML through LibreOffice/OnlyOffice on the server before previewing.",
    officeUnsupportedGenericMessage: "This format usually needs server-side conversion or a dedicated parser for high-fidelity preview.",
    officeUnsupportedIntro: "is handled by the Office plugin. {message}",
    officeUnsupportedSupportedFormats:
      "This version prioritizes basic previews for docx, rtf, odt/fodt, xlsx/xls/csv/ods, pptx/ppsx, and odp/fodp files.",
    officeErrorWithMessage: "Parser returned: {message}",
    officeErrorWithoutMessage: "Parser did not return a specific error."
  }
};

export function resolveMessages(options: Pick<PreviewOptions, "locale" | "messages">): PreviewMessages {
  return {
    ...defaultMessages[options.locale || "zh-CN"],
    ...options.messages
  };
}

export function formatPreviewMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
