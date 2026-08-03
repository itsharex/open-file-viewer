import { inflate } from "pako";

const DOCUMENT_CONTAINER = 0x03e8;
const DOCUMENT_ATOM = 0x03e9;
const SLIDE_CONTAINER = 0x03ee;
const MAIN_MASTER_CONTAINER = 0x03f8;
const TEXT_CHARS_ATOM = 0x0fa0;
const TEXT_BYTES_ATOM = 0x0fa8;
const OFFICE_ART_SP_CONTAINER = 0xf004;
const OFFICE_ART_FOPT = 0xf00b;
const OFFICE_ART_CHILD_ANCHOR = 0xf00f;
const OFFICE_ART_CLIENT_ANCHOR = 0xf010;
const OFFICE_ART_PIB_PROPERTY = 0x0104;

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
  imageIndices: number[];
};

export type LegacyPowerPointSlide = {
  shapes: LegacyPowerPointShape[];
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
  const masterShapes: LegacyPowerPointShape[] = [];
  const slides: LegacyPowerPointSlide[] = [];

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
      masterShapes.push(...parseShapeContainers(documentStream, record.payloadStart, record.end));
      return false;
    }
    if (record.type === SLIDE_CONTAINER) {
      slides.push({ shapes: parseShapeContainers(documentStream, record.payloadStart, record.end) });
      return false;
    }
    return record.type === DOCUMENT_CONTAINER || record.version === 0x0f;
  });

  if (slides.length === 0) {
    throw new Error("No slide records were found in the PowerPoint Document stream.");
  }

  return {
    width,
    height,
    masterShapes: deduplicateShapes(masterShapes),
    slides,
    images: picturesStream ? parsePicturesStream(picturesStream) : []
  };
}

function parseShapeContainers(bytes: Uint8Array, start: number, end: number): LegacyPowerPointShape[] {
  const shapes: LegacyPowerPointShape[] = [];
  walkRecords(bytes, start, end, (record) => {
    if (record.type === OFFICE_ART_SP_CONTAINER) {
      const shape = parseShape(bytes, record.payloadStart, record.end);
      if (shape && (shape.texts.length > 0 || shape.imageIndices.length > 0)) {
        shapes.push(shape);
      }
      return true;
    }
    return record.version === 0x0f;
  });
  return shapes;
}

function parseShape(bytes: Uint8Array, start: number, end: number): LegacyPowerPointShape | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const texts: string[] = [];
  const imageIndices: number[] = [];
  let anchor: Pick<LegacyPowerPointShape, "left" | "top" | "width" | "height"> | undefined;

  walkRecords(bytes, start, end, (record) => {
    if (record.type === OFFICE_ART_SP_CONTAINER) {
      return false;
    }
    if (record.type === OFFICE_ART_CLIENT_ANCHOR && record.end - record.payloadStart >= 8) {
      const left = view.getUint16(record.payloadStart, true);
      const top = view.getUint16(record.payloadStart + 2, true);
      const right = view.getUint16(record.payloadStart + 4, true);
      const bottom = view.getUint16(record.payloadStart + 6, true);
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
      anchor = {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
      };
      return false;
    }
    if (record.type === TEXT_CHARS_ATOM || record.type === TEXT_BYTES_ATOM) {
      const decoded = decodePresentationText(bytes.subarray(record.payloadStart, record.end), record.type === TEXT_CHARS_ATOM);
      if (decoded) {
        texts.push(decoded);
      }
      return false;
    }
    if (record.type === OFFICE_ART_FOPT) {
      collectImageReferences(view, record, imageIndices);
      return false;
    }
    return record.version === 0x0f;
  });

  if (!anchor) {
    return undefined;
  }
  return { ...anchor, texts: uniqueStrings(texts), imageIndices: [...new Set(imageIndices)] };
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
    const key = `${shape.left}:${shape.top}:${shape.width}:${shape.height}:${shape.imageIndices.join(",")}:${shape.texts.join("\u0001")}`;
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
