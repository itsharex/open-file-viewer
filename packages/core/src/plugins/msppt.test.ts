import { deflate } from "pako";
import { describe, expect, it } from "vitest";
import { parseLegacyPowerPointStreams } from "./msppt";

describe("legacy PowerPoint parser", () => {
  it("reads slide geometry, text, master artwork, and picture references", () => {
    const master = record(0x03f8, shape({ left: 0, top: 0, width: 7200, height: 5400, imageIndex: 1 }), 0x0f);
    const slide = record(
      0x03ee,
      concat(
        shape({ left: 360, top: 320, width: 4800, height: 820, text: "Quarterly plan" }),
        shape({ left: 1500, top: 1100, width: 4200, height: 3000, imageIndex: 2 }),
        childShape({ left: 500, top: 1600, width: 1200, height: 240, text: "Column 1" })
      ),
      0x0f
    );
    const documentAtom = new Uint8Array(40);
    const documentView = new DataView(documentAtom.buffer);
    documentView.setUint32(0, 7200, true);
    documentView.setUint32(4, 5400, true);
    const documentStream = record(
      0x03e8,
      concat(record(0x03e9, documentAtom, 0x01), master, slide),
      0x0f
    );
    const picturesStream = concat(
      record(0xf01e, concat(new Uint8Array(16), tinyPng())),
      record(0xf01a, compressedMetafile(new Uint8Array([1, 0, 0, 0, 88, 0, 0, 0])))
    );

    const presentation = parseLegacyPowerPointStreams(documentStream, picturesStream);

    expect(presentation.width).toBe(7200);
    expect(presentation.height).toBe(5400);
    expect(presentation.masterShapes).toHaveLength(1);
    expect(presentation.masterShapes[0].imageIndices).toEqual([1]);
    expect(presentation.slides).toHaveLength(1);
    expect(presentation.slides[0].shapes[0]).toMatchObject({
      left: 360,
      top: 320,
      width: 4800,
      height: 820,
      texts: ["Quarterly plan"]
    });
    expect(presentation.slides[0].shapes[1].imageIndices).toEqual([2]);
    expect(presentation.slides[0].shapes[2]).toMatchObject({
      left: 500,
      top: 1600,
      width: 1200,
      height: 240,
      texts: ["Column 1"]
    });
    expect(presentation.images.map((image) => [image.index, image.kind])).toEqual([
      [1, "bitmap"],
      [2, "emf"]
    ]);
    expect(presentation.images[1].bytes).toEqual(new Uint8Array([1, 0, 0, 0, 88, 0, 0, 0]));
  });

  it("rejects streams without slides", () => {
    expect(() => parseLegacyPowerPointStreams(record(0x03e8, new Uint8Array(), 0x0f))).toThrow(
      "No slide records"
    );
  });
});

function shape(options: {
  left: number;
  top: number;
  width: number;
  height: number;
  text?: string;
  imageIndex?: number;
}): Uint8Array {
  const anchor = new Uint8Array(8);
  const anchorView = new DataView(anchor.buffer);
  anchorView.setUint16(0, options.left, true);
  anchorView.setUint16(2, options.top, true);
  anchorView.setUint16(4, options.left + options.width, true);
  anchorView.setUint16(6, options.top + options.height, true);
  const children = [record(0xf010, anchor)];
  if (options.imageIndex) {
    const property = new Uint8Array(6);
    const propertyView = new DataView(property.buffer);
    propertyView.setUint16(0, 0x4104, true);
    propertyView.setUint32(2, options.imageIndex, true);
    children.push(record(0xf00b, property, 0x03, 1));
  }
  if (options.text) {
    const encoded = new Uint8Array(options.text.length * 2);
    const encodedView = new DataView(encoded.buffer);
    for (let index = 0; index < options.text.length; index += 1) {
      encodedView.setUint16(index * 2, options.text.charCodeAt(index), true);
    }
    children.push(record(0x0fa0, encoded));
  }
  return record(0xf004, concat(...children), 0x0f);
}

function compressedMetafile(source: Uint8Array): Uint8Array {
  const compressed = deflate(source);
  const result = new Uint8Array(16 + 34 + compressed.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(16, source.byteLength, true);
  view.setUint32(16 + 28, compressed.byteLength, true);
  view.setUint8(16 + 32, 0);
  view.setUint8(16 + 33, 0xfe);
  result.set(compressed, 16 + 34);
  return result;
}

function childShape(options: {
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
}): Uint8Array {
  const anchor = new Uint8Array(16);
  const anchorView = new DataView(anchor.buffer);
  anchorView.setInt32(0, options.left, true);
  anchorView.setInt32(4, options.top, true);
  anchorView.setInt32(8, options.left + options.width, true);
  anchorView.setInt32(12, options.top + options.height, true);
  const text = new Uint8Array(options.text.length * 2);
  const textView = new DataView(text.buffer);
  for (let index = 0; index < options.text.length; index += 1) {
    textView.setUint16(index * 2, options.text.charCodeAt(index), true);
  }
  return record(0xf004, concat(record(0xf00f, anchor), record(0x0fa0, text)), 0x0f);
}

function tinyPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82
  ]);
}

function record(type: number, payload: Uint8Array, version = 0, instance = 0): Uint8Array {
  const result = new Uint8Array(8 + payload.byteLength);
  const view = new DataView(result.buffer);
  view.setUint16(0, (instance << 4) | version, true);
  view.setUint16(2, type, true);
  view.setUint32(4, payload.byteLength, true);
  result.set(payload, 8);
  return result;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
