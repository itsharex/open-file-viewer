import { inflate } from "pako";

const DOCUMENT_CONTAINER = 0x03e8;
const DOCUMENT_ATOM = 0x03e9;
const MASTER_PERSIST_ATOM = 0x03f3;
const SLIDE_CONTAINER = 0x03ee;
const SLIDE_ATOM = 0x03ef;
const MAIN_MASTER_CONTAINER = 0x03f8;
const TEXT_HEADER_ATOM = 0x0f9f;
const TEXT_CHARS_ATOM = 0x0fa0;
const STYLE_TEXT_PROP_ATOM = 0x0fa1;
const TEXT_MASTER_STYLE_ATOM = 0x0fa3;
const TEXT_BYTES_ATOM = 0x0fa8;
const FONT_ENTITY_ATOM = 0x0fb7;
const OFFICE_ART_SPGR_CONTAINER = 0xf003;
const OFFICE_ART_SP_CONTAINER = 0xf004;
const OFFICE_ART_SPGR_ATOM = 0xf009;
const OFFICE_ART_FSP = 0xf00a;
const OFFICE_ART_FOPT = 0xf00b;
const OFFICE_ART_CHILD_ANCHOR = 0xf00f;
const OFFICE_ART_CLIENT_ANCHOR = 0xf010;
const OFFICE_ART_PIB_PROPERTY = 0x0104;
const OFFICE_ART_CROP_FROM_TOP_PROPERTY = 0x0100;
const OFFICE_ART_CROP_FROM_BOTTOM_PROPERTY = 0x0101;
const OFFICE_ART_CROP_FROM_LEFT_PROPERTY = 0x0102;
const OFFICE_ART_CROP_FROM_RIGHT_PROPERTY = 0x0103;
const OFFICE_ART_ROTATION_PROPERTY = 0x0004;
const OFFICE_ART_TEXT_FLOW_PROPERTY = 0x0088;
const OFFICE_ART_FILL_COLOR_PROPERTY = 0x0181;
const OFFICE_ART_FILL_STYLE_PROPERTY = 0x01bf;
const OFFICE_ART_LINE_COLOR_PROPERTY = 0x01c0;
const OFFICE_ART_LINE_WIDTH_PROPERTY = 0x01cb;
const OFFICE_ART_LINE_STYLE_PROPERTY = 0x01ff;
const EMU_PER_MASTER_UNIT = 12700 / 8;

const BLIP_EMF = 0xf01a;
const BLIP_WMF = 0xf01b;
const BLIP_JPEG = 0xf01d;
const BLIP_PNG = 0xf01e;
const BLIP_TIFF = 0xf029;

type BinaryRecord = {
  start: number;
  payloadStart: number;
  end: number;
  version: number;
  instance: number;
  type: number;
};

export type LegacyPowerPointShape = {
  left: number;
  top: number;
  width: number;
  height: number;
  texts: string[];
  formattedTexts?: LegacyPowerPointFormattedText[];
  imageIndices: number[];
  textType?: number;
  shapeType?: number;
  fillColor?: string;
  lineColor?: string;
  fillEnabled?: boolean;
  lineEnabled?: boolean;
  lineWidth?: number;
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  imageCropTop?: number;
  imageCropBottom?: number;
  imageCropLeft?: number;
  imageCropRight?: number;
  verticalText?: boolean;
};

export type LegacyPowerPointCharacterStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  color?: string;
  fontRef?: number;
};

export type LegacyPowerPointTextRun = LegacyPowerPointCharacterStyle & {
  start: number;
  length: number;
};

export type LegacyPowerPointParagraphRun = {
  start: number;
  length: number;
  alignment?: "left" | "center" | "right" | "justify";
  lineSpacing?: number;
  indentLevel?: number;
};

export type LegacyPowerPointMasterTextStyles = Record<number, LegacyPowerPointCharacterStyle[]>;

export type LegacyPowerPointFormattedText = {
  text: string;
  characterRuns: LegacyPowerPointTextRun[];
  paragraphRuns: LegacyPowerPointParagraphRun[];
};

export type LegacyPowerPointSlide = {
  shapes: LegacyPowerPointShape[];
  masterShapes: LegacyPowerPointShape[];
  masterIdRef?: number;
  masterTextStyles: LegacyPowerPointMasterTextStyles;
};

export type LegacyPowerPointImage = {
  index: number;
  kind: "bitmap" | "emf" | "wmf";
  mimeType: string;
  bytes: Uint8Array;
};

export type LegacyPowerPointPresentation = {
  width: number;
  height: number;
  masterShapes: LegacyPowerPointShape[];
  slides: LegacyPowerPointSlide[];
  images: LegacyPowerPointImage[];
  fonts: string[];
};

export async function parseLegacyPowerPoint(arrayBuffer: ArrayBuffer): Promise<LegacyPowerPointPresentation> {
  if (arrayBuffer.byteLength < 512 || !hasCompoundFileSignature(new Uint8Array(arrayBuffer, 0, Math.min(8, arrayBuffer.byteLength)))) {
    throw new Error("The file is not a complete OLE compound document.");
  }
  const xlsxModule = await import("xlsx");
  const xlsx =
    (xlsxModule as unknown as { default?: typeof import("xlsx") }).default ||
    (xlsxModule as typeof import("xlsx"));
  const cfb = xlsx.CFB.read(new Uint8Array(arrayBuffer), { type: "array" });
  const documentEntry = xlsx.CFB.find(cfb, "PowerPoint Document");
  if (!documentEntry?.content) {
    throw new Error("PowerPoint Document stream was not found.");
  }

  const picturesEntry = xlsx.CFB.find(cfb, "Pictures");
  return parseLegacyPowerPointStreams(
    asUint8Array(documentEntry.content),
    picturesEntry?.content ? asUint8Array(picturesEntry.content) : undefined
  );
}

export function parseLegacyPowerPointStreams(
  documentStream: Uint8Array,
  picturesStream?: Uint8Array
): LegacyPowerPointPresentation {
  if (documentStream.byteLength < 8) {
    throw new Error("PowerPoint Document stream is empty.");
  }

  const view = new DataView(documentStream.buffer, documentStream.byteOffset, documentStream.byteLength);
  let width = 7200;
  let height = 5400;
  const masterIds = parseMasterIds(documentStream);
  const fonts = parseFontFamilies(documentStream);
  const masters: Array<{
    id?: number;
    shapes: LegacyPowerPointShape[];
    textStyles: LegacyPowerPointMasterTextStyles;
  }> = [];
  const slides: Array<LegacyPowerPointSlide & { inheritMasterObjects: boolean }> = [];

  walkRecords(documentStream, 0, documentStream.byteLength, (record) => {
    if (record.type === DOCUMENT_ATOM && record.end - record.payloadStart >= 8) {
      const candidateWidth = view.getUint32(record.payloadStart, true);
      const candidateHeight = view.getUint32(record.payloadStart + 4, true);
      if (candidateWidth > 0 && candidateHeight > 0) {
        width = candidateWidth;
        height = candidateHeight;
      }
      return false;
    }
    if (record.type === MAIN_MASTER_CONTAINER) {
      masters.push({
        id: masterIds[masters.length],
        shapes: parseShapeContainers(documentStream, record.payloadStart, record.end, width, height),
        textStyles: parseTextMasterStyles(documentStream, record.payloadStart, record.end)
      });
      return false;
    }
    if (record.type === SLIDE_CONTAINER) {
      const metadata = parseSlideMasterMetadata(documentStream, record.payloadStart, record.end);
      slides.push({
        shapes: parseShapeContainers(documentStream, record.payloadStart, record.end, width, height),
        masterShapes: [],
        masterTextStyles: {},
        masterIdRef: metadata.masterIdRef,
        inheritMasterObjects: metadata.inheritMasterObjects
      });
      return false;
    }
    return record.type === DOCUMENT_CONTAINER || record.version === 0x0f;
  });

  if (slides.length === 0) {
    throw new Error("No slide records were found in the PowerPoint Document stream.");
  }

  const masterShapes = deduplicateShapes(masters.flatMap((master) => master.shapes));
  const resolvedSlides = slides.map(({ inheritMasterObjects, ...slide }) => {
    const matchingMaster = masters.find((master) => master.id === slide.masterIdRef);
    return {
      ...slide,
      masterShapes: inheritMasterObjects
        ? matchingMaster?.shapes || (slide.masterIdRef === undefined ? masterShapes : [])
        : [],
      masterTextStyles: matchingMaster?.textStyles || {}
    };
  });

  return {
    width,
    height,
    masterShapes,
    slides: resolvedSlides,
    images: picturesStream ? parsePicturesStream(picturesStream) : [],
    fonts
  };
}

function parseTextMasterStyles(bytes: Uint8Array, start: number, end: number): LegacyPowerPointMasterTextStyles {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const styles: LegacyPowerPointMasterTextStyles = {};
  walkRecords(bytes, start, end, (record) => {
    if (record.type !== TEXT_MASTER_STYLE_ATOM || record.end - record.payloadStart < 2) {
      return record.version === 0x0f;
    }
    const levelCount = Math.min(5, view.getUint16(record.payloadStart, true));
    const levels: LegacyPowerPointCharacterStyle[] = styles[record.instance] || [];
    let offset = record.payloadStart + 2;
    for (let sequence = 0; sequence < levelCount && offset < record.end; sequence += 1) {
      let level = sequence;
      if (record.instance >= 5) {
        if (offset + 2 > record.end) break;
        level = view.getUint16(offset, true);
        offset += 2;
      }
      const paragraph = parseTextParagraphException(view, offset, record.end);
      if (!paragraph) break;
      offset = paragraph.offset;
      const character = parseTextCharacterException(view, offset, record.end);
      if (!character) break;
      offset = character.offset;
      levels[level] = { ...(levels[level] || {}), ...character.style };
    }
    styles[record.instance] = levels;
    return false;
  });
  return styles;
}

function parseFontFamilies(bytes: Uint8Array): string[] {
  const fonts: string[] = [];
  walkRecords(bytes, 0, bytes.byteLength, (record) => {
    if (record.type === FONT_ENTITY_ATOM && record.end - record.payloadStart >= 64) {
      const family = decodePresentationText(bytes.subarray(record.payloadStart, record.payloadStart + 64), true);
      if (family) fonts[record.instance] = family;
      return false;
    }
    return record.version === 0x0f;
  });
  return fonts;
}

function parseMasterIds(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ids: number[] = [];
  walkRecords(bytes, 0, bytes.byteLength, (record) => {
    if (record.type === MASTER_PERSIST_ATOM && record.end - record.payloadStart >= 16) {
      const masterId = view.getUint32(record.payloadStart + 12, true);
      if ((masterId & 0x80000000) !== 0) {
        ids.push(masterId);
      }
      return false;
    }
    return record.version === 0x0f;
  });
  return ids;
}

function parseSlideMasterMetadata(
  bytes: Uint8Array,
  start: number,
  end: number
): { masterIdRef?: number; inheritMasterObjects: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let masterIdRef: number | undefined;
  let inheritMasterObjects = true;
  walkRecords(bytes, start, end, (record) => {
    if (record.type !== SLIDE_ATOM || record.end - record.payloadStart < 22) {
      return record.version === 0x0f;
    }
    masterIdRef = view.getUint32(record.payloadStart + 12, true);
    inheritMasterObjects = (view.getUint16(record.payloadStart + 20, true) & 0x0001) !== 0;
    return false;
  });
  return { masterIdRef, inheritMasterObjects };
}

function parseShapeContainers(
  bytes: Uint8Array,
  start: number,
  end: number,
  slideWidth: number,
  slideHeight: number
): LegacyPowerPointShape[] {
  const shapes: LegacyPowerPointShape[] = [];
  for (const record of readDirectRecords(bytes, start, end)) {
    if (record.type === OFFICE_ART_SPGR_CONTAINER) {
      shapes.push(...parseShapeGroup(bytes, record.payloadStart, record.end, slideWidth, slideHeight));
      continue;
    }
    if (record.type === OFFICE_ART_SP_CONTAINER) {
      const shape = parseShape(bytes, record.payloadStart, record.end, slideWidth, slideHeight, true);
      if (shape && isRenderableShape(shape)) {
        shapes.push(shape);
      }
      continue;
    }
    if (record.version === 0x0f) {
      shapes.push(...parseShapeContainers(bytes, record.payloadStart, record.end, slideWidth, slideHeight));
    }
  }
  return shapes;
}

function parseShapeGroup(
  bytes: Uint8Array,
  start: number,
  end: number,
  slideWidth: number,
  slideHeight: number
): LegacyPowerPointShape[] {
  const records = readDirectRecords(bytes, start, end);
  const descriptor = records.find((record) =>
    record.type === OFFICE_ART_SP_CONTAINER && Boolean(parseGroupBounds(bytes, record.payloadStart, record.end))
  );
  const bounds = descriptor ? parseGroupBounds(bytes, descriptor.payloadStart, descriptor.end) : undefined;
  const placement = descriptor
    ? parseShape(bytes, descriptor.payloadStart, descriptor.end, slideWidth, slideHeight, false)
    : undefined;
  const shapes: LegacyPowerPointShape[] = [];

  for (const record of records) {
    if (record === descriptor) {
      continue;
    }
    if (record.type === OFFICE_ART_SPGR_CONTAINER) {
      shapes.push(...parseShapeGroup(bytes, record.payloadStart, record.end, slideWidth, slideHeight));
      continue;
    }
    if (record.type === OFFICE_ART_SP_CONTAINER) {
      const shape = parseShape(bytes, record.payloadStart, record.end, slideWidth, slideHeight, false);
      if (shape && isRenderableShape(shape)) {
        shapes.push(shape);
      }
    }
  }

  if (!bounds || !placement || bounds.width === 0 || bounds.height === 0) {
    return shapes;
  }
  return shapes.map((shape) => transformGroupedShape(shape, bounds, placement));
}

function parseGroupBounds(
  bytes: Uint8Array,
  start: number,
  end: number
): Pick<LegacyPowerPointShape, "left" | "top" | "width" | "height"> | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let bounds: Pick<LegacyPowerPointShape, "left" | "top" | "width" | "height"> | undefined;
  walkRecords(bytes, start, end, (record) => {
    if (record.type !== OFFICE_ART_SPGR_ATOM || record.end - record.payloadStart < 16) {
      return record.version === 0x0f;
    }
    const left = view.getInt32(record.payloadStart, true);
    const top = view.getInt32(record.payloadStart + 4, true);
    const right = view.getInt32(record.payloadStart + 8, true);
    const bottom = view.getInt32(record.payloadStart + 12, true);
    bounds = { left, top, width: right - left, height: bottom - top };
    return false;
  });
  return bounds;
}

function transformGroupedShape(
  shape: LegacyPowerPointShape,
  bounds: Pick<LegacyPowerPointShape, "left" | "top" | "width" | "height">,
  placement: Pick<LegacyPowerPointShape, "left" | "top" | "width" | "height">
): LegacyPowerPointShape {
  return {
    ...shape,
    left: placement.left + ((shape.left - bounds.left) / bounds.width) * placement.width,
    top: placement.top + ((shape.top - bounds.top) / bounds.height) * placement.height,
    width: (shape.width / bounds.width) * placement.width,
    height: (shape.height / bounds.height) * placement.height
  };
}

function parseShape(
  bytes: Uint8Array,
  start: number,
  end: number,
  slideWidth: number,
  slideHeight: number,
  normalizeChildAnchor: boolean
): LegacyPowerPointShape | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const textBlocks: string[] = [];
  const textStylePayloads: Uint8Array[] = [];
  const imageIndices: number[] = [];
  const visual: Pick<
    LegacyPowerPointShape,
    | "shapeType"
    | "fillColor"
    | "lineColor"
    | "fillEnabled"
    | "lineEnabled"
    | "lineWidth"
    | "rotation"
    | "imageCropTop"
    | "imageCropBottom"
    | "imageCropLeft"
    | "imageCropRight"
    | "flipHorizontal"
    | "flipVertical"
    | "verticalText"
  > = {};
  let textType: number | undefined;
  let anchor: Pick<LegacyPowerPointShape, "left" | "top" | "width" | "height"> | undefined;

  walkRecords(bytes, start, end, (record) => {
    if (record.type === OFFICE_ART_SP_CONTAINER) {
      return false;
    }
    if (record.type === OFFICE_ART_CLIENT_ANCHOR && record.end - record.payloadStart >= 8) {
      const large = record.end - record.payloadStart >= 16;
      const coordinate = (index: number) =>
        large
          ? view.getInt32(record.payloadStart + index * 4, true)
          : view.getInt16(record.payloadStart + index * 2, true);
      // MS-PPT OfficeArtClientAnchorData stores both SmallRectStruct and
      // RectStruct values in top, left, right, bottom order.
      const top = coordinate(0);
      const left = coordinate(1);
      const right = coordinate(2);
      const bottom = coordinate(3);
      anchor = {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
      };
      return false;
    }
    if (record.type === OFFICE_ART_CHILD_ANCHOR && record.end - record.payloadStart >= 16) {
      const left = view.getInt32(record.payloadStart, true);
      const top = view.getInt32(record.payloadStart + 4, true);
      const right = view.getInt32(record.payloadStart + 8, true);
      const bottom = view.getInt32(record.payloadStart + 12, true);
      const childAnchor = {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
      };
      anchor = normalizeChildAnchor
        ? normalizePresentationAnchor(childAnchor, slideWidth, slideHeight)
        : childAnchor;
      return false;
    }
    if (record.type === TEXT_CHARS_ATOM || record.type === TEXT_BYTES_ATOM) {
      const decoded = decodePresentationText(bytes.subarray(record.payloadStart, record.end), record.type === TEXT_CHARS_ATOM);
      if (decoded) {
        textBlocks.push(decoded);
      }
      return false;
    }
    if (record.type === STYLE_TEXT_PROP_ATOM) {
      textStylePayloads.push(bytes.subarray(record.payloadStart, record.end));
      return false;
    }
    if (record.type === TEXT_HEADER_ATOM && record.end - record.payloadStart >= 4) {
      textType = view.getUint32(record.payloadStart, true);
      return false;
    }
    if (record.type === OFFICE_ART_FSP) {
      visual.shapeType = record.instance;
      if (record.end - record.payloadStart >= 8) {
        const flags = view.getUint32(record.payloadStart + 4, true);
        visual.flipHorizontal = (flags & 0x40) !== 0;
        visual.flipVertical = (flags & 0x80) !== 0;
      }
      return false;
    }
    if (record.type === OFFICE_ART_FOPT) {
      collectImageReferences(view, record, imageIndices);
      collectShapeProperties(view, record, visual);
      return false;
    }
    return record.version === 0x0f;
  });

  if (!anchor) {
    return undefined;
  }
  const formattedTexts = textBlocks.map((text, index) =>
    parseStyleTextPropAtom(text, textStylePayloads[index])
  );
  return {
    ...anchor,
    texts: uniqueStrings(textBlocks),
    ...(textStylePayloads.length > 0 ? { formattedTexts } : {}),
    imageIndices: [...new Set(imageIndices)],
    ...visual,
    ...(textType === undefined ? {} : { textType })
  };
}

function parseStyleTextPropAtom(text: string, payload?: Uint8Array): LegacyPowerPointFormattedText {
  const formatted: LegacyPowerPointFormattedText = {
    text,
    characterRuns: [],
    paragraphRuns: []
  };
  if (!payload || payload.byteLength < 10) {
    return formatted;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const formattedLength = text.length + 1;
  let offset = 0;
  let covered = 0;
  while (covered < formattedLength && offset + 10 <= payload.byteLength) {
    const count = view.getUint32(offset, true);
    offset += 4;
    const indentLevel = view.getUint16(offset, true);
    offset += 2;
    const parsed = parseTextParagraphException(view, offset, payload.byteLength);
    if (!parsed) {
      return formatted;
    }
    offset = parsed.offset;
    formatted.paragraphRuns.push({
      start: covered,
      length: Math.min(count, Math.max(0, text.length - covered)),
      indentLevel,
      ...parsed.style
    });
    covered += count;
    if (count === 0) {
      return formatted;
    }
  }

  covered = 0;
  while (covered < formattedLength && offset + 8 <= payload.byteLength) {
    const count = view.getUint32(offset, true);
    offset += 4;
    const parsed = parseTextCharacterException(view, offset, payload.byteLength);
    if (!parsed) {
      break;
    }
    offset = parsed.offset;
    formatted.characterRuns.push({
      start: covered,
      length: Math.min(count, Math.max(0, text.length - covered)),
      ...parsed.style
    });
    covered += count;
    if (count === 0) {
      break;
    }
  }
  return formatted;
}

function parseTextParagraphException(
  view: DataView,
  start: number,
  end: number
): { offset: number; style: Omit<LegacyPowerPointParagraphRun, "start" | "length"> } | undefined {
  if (start + 4 > end) return undefined;
  const masks = view.getUint32(start, true);
  let offset = start + 4;
  const take = (size: number) => {
    if (offset + size > end) return false;
    offset += size;
    return true;
  };
  const readInt16 = () => {
    if (offset + 2 > end) return undefined;
    const value = view.getInt16(offset, true);
    offset += 2;
    return value;
  };

  if ((masks & 0x0000000f) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00000080) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00000010) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00000040) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00000020) !== 0 && !take(4)) return undefined;

  let alignment: LegacyPowerPointParagraphRun["alignment"];
  if ((masks & 0x00000800) !== 0) {
    const value = readInt16();
    if (value === undefined) return undefined;
    alignment = value === 1 || value === 4 || value === 5
      ? "center"
      : value === 2
        ? "right"
        : value === 3 || value === 6
          ? "justify"
          : "left";
  }

  let lineSpacing: number | undefined;
  if ((masks & 0x00001000) !== 0) {
    const value = readInt16();
    if (value === undefined) return undefined;
    lineSpacing = value > 0 ? value / 100 : undefined;
  }
  if ((masks & 0x00002000) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00004000) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00000100) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00000400) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00008000) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00100000) !== 0) {
    const count = readInt16();
    if (count === undefined || count < 0 || !take(count * 4)) return undefined;
  }
  if ((masks & 0x00010000) !== 0 && !take(2)) return undefined;
  if ((masks & 0x000e0000) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00200000) !== 0 && !take(2)) return undefined;
  return { offset, style: { ...(alignment ? { alignment } : {}), ...(lineSpacing ? { lineSpacing } : {}) } };
}

function parseTextCharacterException(
  view: DataView,
  start: number,
  end: number
): { offset: number; style: LegacyPowerPointCharacterStyle } | undefined {
  if (start + 4 > end) return undefined;
  const masks = view.getUint32(start, true);
  let offset = start + 4;
  const style: LegacyPowerPointCharacterStyle = {};
  const take = (size: number) => {
    if (offset + size > end) return false;
    offset += size;
    return true;
  };

  if ((masks & 0x00003fff) !== 0) {
    if (offset + 2 > end) return undefined;
    const fontStyle = view.getUint16(offset, true);
    offset += 2;
    if ((masks & 0x00000001) !== 0) style.bold = (fontStyle & 0x0001) !== 0;
    if ((masks & 0x00000002) !== 0) style.italic = (fontStyle & 0x0002) !== 0;
    if ((masks & 0x00000004) !== 0) style.underline = (fontStyle & 0x0004) !== 0;
  }
  if ((masks & 0x00010000) !== 0) {
    if (offset + 2 > end) return undefined;
    style.fontRef = view.getUint16(offset, true);
    offset += 2;
  }
  if ((masks & 0x00200000) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00400000) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00800000) !== 0 && !take(2)) return undefined;
  if ((masks & 0x00020000) !== 0) {
    if (offset + 2 > end) return undefined;
    style.fontSize = view.getInt16(offset, true);
    offset += 2;
  }
  if ((masks & 0x00040000) !== 0) {
    if (offset + 4 > end) return undefined;
    const color = decodeTextColor(view, offset);
    if (color) style.color = color;
    offset += 4;
  }
  if ((masks & 0x00080000) !== 0 && !take(2)) return undefined;
  // These extension-mask bits are required to be zero in TextCFException.
  // Ignore them here so a malformed producer cannot desynchronize the
  // surrounding record; the base exception itself carries no extra bytes.
  return { offset, style };
}

function decodeTextColor(view: DataView, offset: number): string | undefined {
  const index = view.getUint8(offset + 3);
  if (index !== 0xfe) return undefined;
  return `#${[view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function isRenderableShape(shape: LegacyPowerPointShape): boolean {
  return (
    shape.texts.length > 0 ||
    shape.imageIndices.length > 0 ||
    shape.fillEnabled === true ||
    shape.lineEnabled === true
  );
}

function readDirectRecords(bytes: Uint8Array, start: number, end: number): BinaryRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: BinaryRecord[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const record = readRecord(view, offset, end);
    if (!record) {
      break;
    }
    records.push(record);
    if (record.end <= offset) {
      break;
    }
    offset = record.end;
  }
  return records;
}

function normalizePresentationAnchor(
  anchor: Pick<LegacyPowerPointShape, "left" | "top" | "width" | "height">,
  slideWidth: number,
  slideHeight: number
): Pick<LegacyPowerPointShape, "left" | "top" | "width" | "height"> {
  const maximum = Math.max(
    Math.abs(anchor.left),
    Math.abs(anchor.top),
    Math.abs(anchor.left + anchor.width),
    Math.abs(anchor.top + anchor.height)
  );
  if (maximum <= Math.max(slideWidth, slideHeight) * 16) {
    return anchor;
  }
  return {
    left: anchor.left / EMU_PER_MASTER_UNIT,
    top: anchor.top / EMU_PER_MASTER_UNIT,
    width: anchor.width / EMU_PER_MASTER_UNIT,
    height: anchor.height / EMU_PER_MASTER_UNIT
  };
}

function collectImageReferences(view: DataView, record: BinaryRecord, target: number[]): void {
  const propertyEnd = Math.min(record.end, record.payloadStart + record.instance * 6);
  for (let offset = record.payloadStart; offset + 6 <= propertyEnd; offset += 6) {
    const propertyId = view.getUint16(offset, true) & 0x3fff;
    if (propertyId === OFFICE_ART_PIB_PROPERTY) {
      const imageIndex = view.getUint32(offset + 2, true);
      if (imageIndex > 0) {
        target.push(imageIndex);
      }
    }
  }
}

function collectShapeProperties(
  view: DataView,
  record: BinaryRecord,
  target: Pick<
    LegacyPowerPointShape,
    | "fillColor"
    | "lineColor"
    | "fillEnabled"
    | "lineEnabled"
    | "lineWidth"
    | "rotation"
    | "imageCropTop"
    | "imageCropBottom"
    | "imageCropLeft"
    | "imageCropRight"
    | "verticalText"
  >
): void {
  const propertyEnd = Math.min(record.end, record.payloadStart + record.instance * 6);
  for (let offset = record.payloadStart; offset + 6 <= propertyEnd; offset += 6) {
    const propertyId = view.getUint16(offset, true) & 0x3fff;
    const value = view.getUint32(offset + 2, true);
    if (propertyId === OFFICE_ART_FILL_COLOR_PROPERTY) {
      target.fillColor = decodeOfficeArtColor(value) || target.fillColor;
    } else if (propertyId === OFFICE_ART_FILL_STYLE_PROPERTY) {
      target.fillEnabled = (value & 0x10) !== 0;
    } else if (propertyId === OFFICE_ART_LINE_COLOR_PROPERTY) {
      target.lineColor = decodeOfficeArtColor(value) || target.lineColor;
    } else if (propertyId === OFFICE_ART_LINE_STYLE_PROPERTY) {
      target.lineEnabled = (value & 0x08) !== 0;
    } else if (propertyId === OFFICE_ART_LINE_WIDTH_PROPERTY) {
      target.lineWidth = Math.max(0.25, value / 12700);
    } else if (propertyId === OFFICE_ART_ROTATION_PROPERTY) {
      target.rotation = (value | 0) / 65536;
    } else if (propertyId === OFFICE_ART_CROP_FROM_TOP_PROPERTY) {
      target.imageCropTop = (value | 0) / 65536;
    } else if (propertyId === OFFICE_ART_CROP_FROM_BOTTOM_PROPERTY) {
      target.imageCropBottom = (value | 0) / 65536;
    } else if (propertyId === OFFICE_ART_CROP_FROM_LEFT_PROPERTY) {
      target.imageCropLeft = (value | 0) / 65536;
    } else if (propertyId === OFFICE_ART_CROP_FROM_RIGHT_PROPERTY) {
      target.imageCropRight = (value | 0) / 65536;
    } else if (propertyId === OFFICE_ART_TEXT_FLOW_PROPERTY) {
      target.verticalText = value === 1 || value === 3;
    }
  }
}

function decodeOfficeArtColor(value: number): string | undefined {
  // Direct OfficeArt colors store red, green and blue in the low three bytes.
  // Values with a non-zero high byte are indexed or system colors and need a
  // color-scheme lookup that is not available at shape level.
  if ((value & 0xff000000) !== 0) {
    return undefined;
  }
  const red = value & 0xff;
  const green = (value >>> 8) & 0xff;
  const blue = (value >>> 16) & 0xff;
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parsePicturesStream(bytes: Uint8Array): LegacyPowerPointImage[] {
  const images: LegacyPowerPointImage[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let index = 1;

  while (offset + 8 <= bytes.byteLength) {
    const record = readRecord(view, offset, bytes.byteLength);
    if (!record) {
      break;
    }
    const payload = bytes.subarray(record.payloadStart, record.end);
    let image: Omit<LegacyPowerPointImage, "index"> | undefined;
    if (record.type === BLIP_PNG) {
      image = extractBitmap(payload, "image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    } else if (record.type === BLIP_JPEG) {
      image = extractBitmap(payload, "image/jpeg", [0xff, 0xd8, 0xff]);
    } else if (record.type === BLIP_TIFF) {
      image = extractTiff(payload);
    } else if (record.type === BLIP_EMF) {
      const metafile = extractCompressedMetafile(payload);
      if (metafile) {
        image = { kind: "emf", mimeType: "image/x-emf", bytes: metafile };
      }
    } else if (record.type === BLIP_WMF) {
      const metafile = extractCompressedMetafile(payload);
      if (metafile) {
        image = { kind: "wmf", mimeType: "image/x-wmf", bytes: metafile };
      }
    }
    if (image) {
      images.push({ index, ...image });
    }
    index += 1;
    offset = record.end;
  }
  return images;
}

function extractBitmap(
  payload: Uint8Array,
  mimeType: string,
  signature: number[]
): Omit<LegacyPowerPointImage, "index"> | undefined {
  const start = findBytes(payload, signature);
  if (start < 0) {
    return undefined;
  }
  let end = payload.byteLength;
  if (mimeType === "image/jpeg") {
    const marker = findBytes(payload, [0xff, 0xd9], start + signature.length);
    if (marker >= 0) {
      end = marker + 2;
    }
  } else if (mimeType === "image/png") {
    const marker = findBytes(payload, [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], start + signature.length);
    if (marker >= 0) {
      end = marker + 8;
    }
  }
  return { kind: "bitmap", mimeType, bytes: payload.slice(start, end) };
}

function extractTiff(payload: Uint8Array): Omit<LegacyPowerPointImage, "index"> | undefined {
  const littleEndian = findBytes(payload, [0x49, 0x49, 0x2a, 0x00]);
  const bigEndian = findBytes(payload, [0x4d, 0x4d, 0x00, 0x2a]);
  const start = littleEndian >= 0 && bigEndian >= 0 ? Math.min(littleEndian, bigEndian) : Math.max(littleEndian, bigEndian);
  return start < 0 ? undefined : { kind: "bitmap", mimeType: "image/tiff", bytes: payload.slice(start) };
}

function extractCompressedMetafile(payload: Uint8Array): Uint8Array | undefined {
  for (const uidBytes of [16, 32]) {
    const headerOffset = uidBytes;
    const dataOffset = headerOffset + 34;
    if (dataOffset > payload.byteLength) {
      continue;
    }
    const view = new DataView(payload.buffer, payload.byteOffset + headerOffset, payload.byteLength - headerOffset);
    const uncompressedSize = view.getUint32(0, true);
    const savedSize = view.getUint32(28, true);
    const compression = view.getUint8(32);
    if (uncompressedSize === 0 || uncompressedSize > 128 * 1024 * 1024 || savedSize === 0 || dataOffset + savedSize > payload.byteLength) {
      continue;
    }
    const data = payload.subarray(dataOffset, dataOffset + savedSize);
    try {
      if (compression === 0x00) {
        const result = inflate(data);
        if (result.byteLength === uncompressedSize) {
          return result;
        }
      } else if (compression === 0xfe && data.byteLength === uncompressedSize) {
        return data.slice();
      }
    } catch {
      // Some records include a second UID. Try the next supported header offset.
    }
  }
  return undefined;
}

function walkRecords(
  bytes: Uint8Array,
  start: number,
  end: number,
  visitor: (record: BinaryRecord) => boolean
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;
  while (offset + 8 <= end) {
    const record = readRecord(view, offset, end);
    if (!record) {
      return;
    }
    if (visitor(record) && record.payloadStart < record.end) {
      walkRecords(bytes, record.payloadStart, record.end, visitor);
    }
    if (record.end <= offset) {
      return;
    }
    offset = record.end;
  }
}

function readRecord(view: DataView, offset: number, end: number): BinaryRecord | undefined {
  if (offset < 0 || offset + 8 > end || offset + 8 > view.byteLength) {
    return undefined;
  }
  const versionAndInstance = view.getUint16(offset, true);
  const length = view.getUint32(offset + 4, true);
  const payloadStart = offset + 8;
  const recordEnd = payloadStart + length;
  if (recordEnd > end || recordEnd > view.byteLength || recordEnd < payloadStart) {
    return undefined;
  }
  return {
    start: offset,
    payloadStart,
    end: recordEnd,
    version: versionAndInstance & 0x0f,
    instance: versionAndInstance >>> 4,
    type: view.getUint16(offset + 2, true)
  };
}

function decodePresentationText(bytes: Uint8Array, utf16: boolean): string {
  const decoder = new TextDecoder(utf16 ? "utf-16le" : "windows-1252");
  return decoder
    .decode(bytes)
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .trim();
}

function deduplicateShapes(shapes: LegacyPowerPointShape[]): LegacyPowerPointShape[] {
  const seen = new Set<string>();
  return shapes.filter((shape) => {
    const key = `${shape.left}:${shape.top}:${shape.width}:${shape.height}:${shape.textType ?? ""}:${shape.shapeType ?? ""}:${shape.fillColor ?? ""}:${shape.lineColor ?? ""}:${shape.fillEnabled ?? ""}:${shape.lineEnabled ?? ""}:${shape.lineWidth ?? ""}:${shape.rotation ?? ""}:${shape.imageIndices.join(",")}:${shape.texts.join("\u0001")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function findBytes(haystack: Uint8Array, needle: number[], from = 0): number {
  outer: for (let index = Math.max(0, from); index <= haystack.byteLength - needle.length; index += 1) {
    for (let part = 0; part < needle.length; part += 1) {
      if (haystack[index + part] !== needle[part]) {
        continue outer;
      }
    }
    return index;
  }
  return -1;
}

function asUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  throw new Error("Unsupported OLE stream payload.");
}

function hasCompoundFileSignature(bytes: Uint8Array): boolean {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return signature.every((byte, index) => bytes[index] === byte);
}
