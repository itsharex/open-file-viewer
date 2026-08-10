import { deflate } from "pako";
import { describe, expect, it } from "vitest";
import { parseLegacyPowerPointStreams } from "./msppt";

describe("legacy PowerPoint parser", () => {
  it("reads slide geometry, text, master artwork, and picture references", () => {
    const master = record(
      0x03f8,
      concat(
        textMasterStyle(4, 18, 5, [0x80, 0xa8, 0x12, 0xfe]),
        shape({ left: 0, top: 0, width: 7200, height: 5400, imageIndex: 1, imageCropLeft: 32768 })
      ),
      0x0f
    );
    const slide = record(
      0x03ee,
      concat(
        shape({ left: 360, top: 320, width: 4800, height: 820, text: "Quarterly plan", textType: 0 }),
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
      concat(record(0x03e9, documentAtom, 0x01), fontEntity("微软雅黑", 5), master, slide),
      0x0f
    );
    const picturesStream = concat(
      record(0xf01e, concat(new Uint8Array(16), tinyPng())),
      record(0xf01a, compressedMetafile(new Uint8Array([1, 0, 0, 0, 88, 0, 0, 0])))
    );

    const presentation = parseLegacyPowerPointStreams(documentStream, picturesStream);

    expect(presentation.width).toBe(7200);
    expect(presentation.height).toBe(5400);
    expect(presentation.fonts[5]).toBe("微软雅黑");
    expect(presentation.masterShapes).toHaveLength(1);
    expect(presentation.masterShapes[0].imageIndices).toEqual([1]);
    expect(presentation.masterShapes[0].imageCropLeft).toBe(0.5);
    expect(presentation.slides).toHaveLength(1);
    expect(presentation.slides[0].masterShapes).toHaveLength(1);
    expect(presentation.slides[0].masterTextStyles[4][0]).toMatchObject({
      fontRef: 5,
      fontSize: 18,
      color: "#80a812"
    });
    expect(presentation.slides[0].shapes[0]).toMatchObject({
      left: 360,
      top: 320,
      width: 4800,
      height: 820,
      texts: ["Quarterly plan"],
      textType: 0
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

  it("applies only the master referenced by each slide", () => {
    const firstMasterId = 0x80000000;
    const secondMasterId = 0x80000001;
    const firstMaster = record(
      0x03f8,
      shape({ left: 0, top: 0, width: 7200, height: 5400, imageIndex: 1 }),
      0x0f
    );
    const secondMaster = record(
      0x03f8,
      shape({ left: 0, top: 0, width: 7200, height: 5400, imageIndex: 2 }),
      0x0f
    );
    const firstSlide = record(
      0x03ee,
      concat(slideAtom(firstMasterId), shape({ left: 400, top: 400, width: 1200, height: 400, text: "One" })),
      0x0f
    );
    const secondSlide = record(
      0x03ee,
      concat(slideAtom(secondMasterId), shape({ left: 400, top: 400, width: 1200, height: 400, text: "Two" })),
      0x0f
    );
    const documentStream = record(
      0x03e8,
      concat(masterPersist(firstMasterId), masterPersist(secondMasterId), firstMaster, secondMaster, firstSlide, secondSlide),
      0x0f
    );

    const presentation = parseLegacyPowerPointStreams(documentStream);

    expect(presentation.slides[0].masterShapes[0].imageIndices).toEqual([1]);
    expect(presentation.slides[1].masterShapes[0].imageIndices).toEqual([2]);
  });

  it("reads signed small and large client anchors in top-left-right-bottom order", () => {
    const slide = record(
      0x03ee,
      concat(
        shape({ left: -120, top: 320, width: 1320, height: 480, text: "Small anchor" }),
        largeShape({ left: 540, top: 1620, width: 4800, height: 2100, text: "Large anchor" })
      ),
      0x0f
    );
    const documentStream = record(0x03e8, slide, 0x0f);

    const presentation = parseLegacyPowerPointStreams(documentStream);

    expect(presentation.slides[0].shapes).toEqual([
      {
        left: -120,
        top: 320,
        width: 1320,
        height: 480,
        texts: ["Small anchor"],
        imageIndices: []
      },
      {
        left: 540,
        top: 1620,
        width: 4800,
        height: 2100,
        texts: ["Large anchor"],
        imageIndices: []
      }
    ]);
  });

  it("maps grouped child anchors into the group's presentation placement", () => {
    const slide = record(
      0x03ee,
      shapeGroup(
        { left: 0, top: 0, width: 5760, height: 4320 },
        { left: 0, top: 0, width: 9144000, height: 6858000 },
        childShape({
          left: 914400,
          top: 685800,
          width: 4572000,
          height: 3429000,
          text: "Grouped content"
        })
      ),
      0x0f
    );
    const documentStream = record(0x03e8, slide, 0x0f);

    const presentation = parseLegacyPowerPointStreams(documentStream);

    expect(presentation.slides[0].shapes[0]).toMatchObject({
      left: 576,
      top: 432,
      width: 2880,
      height: 2160,
      texts: ["Grouped content"]
    });
  });

  it("keeps visual-only shapes and reads their OfficeArt fill and line styles", () => {
    const slide = record(
      0x03ee,
      shape({
        left: 720,
        top: 360,
        width: 1800,
        height: 420,
        shapeType: 2,
        fillColor: 0x12a880,
        fillEnabled: true,
        lineColor: 0x25895c,
        lineEnabled: true,
        lineWidth: 25400,
        flipHorizontal: true,
        flipVertical: true,
        verticalText: true
      }),
      0x0f
    );
    const presentation = parseLegacyPowerPointStreams(record(0x03e8, slide, 0x0f));

    expect(presentation.slides[0].shapes[0]).toMatchObject({
      shapeType: 2,
      fillColor: "#80a812",
      fillEnabled: true,
      lineColor: "#5c8925",
      lineEnabled: true,
      lineWidth: 2,
      flipHorizontal: true,
      flipVertical: true,
      verticalText: true
    });
  });

  it("reads the real paragraph and character formatting stored with legacy slide text", () => {
    const slide = record(
      0x03ee,
      concat(
        shape({
          left: 720,
          top: 360,
          width: 1800,
          height: 420,
          text: "学习目标",
          textStyle: fromHex("05000000000002000a00020007000500000001006700010005000500050018005c8925fe")
        }),
        shape({
          left: 800,
          top: 900,
          width: 2600,
          height: 420,
          text: "Contents Page",
          textStyle: fromHex("0e000000000002080a000200010007000e00000000006700070008000700200092d050fe")
        })
      ),
      0x0f
    );

    const presentation = parseLegacyPowerPointStreams(record(0x03e8, slide, 0x0f));

    expect(presentation.slides[0].shapes[0].formattedTexts?.[0]).toMatchObject({
      text: "学习目标",
      characterRuns: [{ start: 0, length: 4, bold: true, fontSize: 24, color: "#5c8925" }]
    });
    expect(presentation.slides[0].shapes[1].formattedTexts?.[0]).toMatchObject({
      text: "Contents Page",
      paragraphRuns: [{ start: 0, length: 13, alignment: "center" }],
      characterRuns: [{ start: 0, length: 13, fontSize: 32, color: "#92d050" }]
    });
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
  textType?: number;
  imageIndex?: number;
  shapeType?: number;
  fillColor?: number;
  fillEnabled?: boolean;
  lineColor?: number;
  lineEnabled?: boolean;
  lineWidth?: number;
  textStyle?: Uint8Array;
  imageCropLeft?: number;
  verticalText?: boolean;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}): Uint8Array {
  const anchor = new Uint8Array(8);
  const anchorView = new DataView(anchor.buffer);
  anchorView.setInt16(0, options.top, true);
  anchorView.setInt16(2, options.left, true);
  anchorView.setInt16(4, options.left + options.width, true);
  anchorView.setInt16(6, options.top + options.height, true);
  const children = [record(0xf010, anchor)];
  if (options.shapeType !== undefined) {
    const shapeDescriptor = new Uint8Array(8);
    const flags = (options.flipHorizontal ? 0x40 : 0) | (options.flipVertical ? 0x80 : 0);
    new DataView(shapeDescriptor.buffer).setUint32(4, flags, true);
    children.push(record(0xf00a, shapeDescriptor, 0x02, options.shapeType));
  }
  const styleProperties: Array<[number, number]> = [];
  if (options.fillColor !== undefined) styleProperties.push([0x0181, options.fillColor]);
  if (options.fillEnabled !== undefined) styleProperties.push([0x01bf, options.fillEnabled ? 0x10 : 0x100000]);
  if (options.lineColor !== undefined) styleProperties.push([0x01c0, options.lineColor]);
  if (options.lineWidth !== undefined) styleProperties.push([0x01cb, options.lineWidth]);
  if (options.lineEnabled !== undefined) styleProperties.push([0x01ff, options.lineEnabled ? 0x08 : 0x80000]);
  if (options.imageCropLeft !== undefined) styleProperties.push([0x0102, options.imageCropLeft]);
  if (options.verticalText !== undefined) styleProperties.push([0x0088, options.verticalText ? 1 : 0]);
  if (styleProperties.length > 0) {
    const properties = new Uint8Array(styleProperties.length * 6);
    const propertiesView = new DataView(properties.buffer);
    styleProperties.forEach(([id, value], index) => {
      propertiesView.setUint16(index * 6, id, true);
      propertiesView.setUint32(index * 6 + 2, value, true);
    });
    children.push(record(0xf00b, properties, 0x03, styleProperties.length));
  }
  if (options.imageIndex) {
    const property = new Uint8Array(6);
    const propertyView = new DataView(property.buffer);
    propertyView.setUint16(0, 0x4104, true);
    propertyView.setUint32(2, options.imageIndex, true);
    children.push(record(0xf00b, property, 0x03, 1));
  }
  if (options.text) {
    if (options.textType !== undefined) {
      const textHeader = new Uint8Array(4);
      new DataView(textHeader.buffer).setUint32(0, options.textType, true);
      children.push(record(0x0f9f, textHeader));
    }
    const encoded = new Uint8Array(options.text.length * 2);
    const encodedView = new DataView(encoded.buffer);
    for (let index = 0; index < options.text.length; index += 1) {
      encodedView.setUint16(index * 2, options.text.charCodeAt(index), true);
    }
    children.push(record(0x0fa0, encoded));
    if (options.textStyle) {
      children.push(record(0x0fa1, options.textStyle));
    }
  }
  return record(0xf004, concat(...children), 0x0f);
}

function masterPersist(masterId: number): Uint8Array {
  const payload = new Uint8Array(20);
  new DataView(payload.buffer).setUint32(12, masterId, true);
  return record(0x03f3, payload);
}

function fontEntity(name: string, index: number): Uint8Array {
  const payload = new Uint8Array(68);
  const view = new DataView(payload.buffer);
  for (let character = 0; character < Math.min(31, name.length); character += 1) {
    view.setUint16(character * 2, name.charCodeAt(character), true);
  }
  return record(0x0fb7, payload, 0, index);
}

function textMasterStyle(instance: number, fontSize: number, fontRef: number, color: number[]): Uint8Array {
  const payload = new Uint8Array(18);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 1, true);
  view.setUint32(2, 0, true);
  view.setUint32(6, 0x00070000, true);
  view.setUint16(10, fontRef, true);
  view.setInt16(12, fontSize, true);
  payload.set(color, 14);
  return record(0x0fa3, payload, 0, instance);
}

function slideAtom(masterIdRef: number): Uint8Array {
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  view.setUint32(12, masterIdRef, true);
  view.setUint16(20, 0x0007, true);
  return record(0x03ef, payload, 0x02);
}

function largeShape(options: {
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
}): Uint8Array {
  const anchor = new Uint8Array(16);
  const anchorView = new DataView(anchor.buffer);
  anchorView.setInt32(0, options.top, true);
  anchorView.setInt32(4, options.left, true);
  anchorView.setInt32(8, options.left + options.width, true);
  anchorView.setInt32(12, options.top + options.height, true);
  const encoded = new Uint8Array(options.text.length * 2);
  const encodedView = new DataView(encoded.buffer);
  for (let index = 0; index < options.text.length; index += 1) {
    encodedView.setUint16(index * 2, options.text.charCodeAt(index), true);
  }
  return record(0xf004, concat(record(0xf010, anchor), record(0x0fa0, encoded)), 0x0f);
}

function shapeGroup(
  placement: { left: number; top: number; width: number; height: number },
  bounds: { left: number; top: number; width: number; height: number },
  ...children: Uint8Array[]
): Uint8Array {
  const groupBounds = new Uint8Array(16);
  const groupBoundsView = new DataView(groupBounds.buffer);
  groupBoundsView.setInt32(0, bounds.left, true);
  groupBoundsView.setInt32(4, bounds.top, true);
  groupBoundsView.setInt32(8, bounds.left + bounds.width, true);
  groupBoundsView.setInt32(12, bounds.top + bounds.height, true);
  const anchor = new Uint8Array(8);
  const anchorView = new DataView(anchor.buffer);
  anchorView.setInt16(0, placement.top, true);
  anchorView.setInt16(2, placement.left, true);
  anchorView.setInt16(4, placement.left + placement.width, true);
  anchorView.setInt16(6, placement.top + placement.height, true);
  const descriptor = record(
    0xf004,
    concat(record(0xf009, groupBounds), record(0xf010, anchor)),
    0x0f
  );
  return record(0xf003, concat(descriptor, ...children), 0x0f);
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

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) || [], (byte) => Number.parseInt(byte, 16));
}
