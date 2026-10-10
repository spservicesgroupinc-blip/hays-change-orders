import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { samplePages, validDraft } from "../tests/helpers";
import { generateDocuments } from "../src/services/pdfGenerate";
import { createChange } from "../src/types";
await mkdir("tmp/fixtures", { recursive: true });
await mkdir("tmp/pdfs", { recursive: true });
const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (const data of samplePages()) {
  const page = source.addPage([612, 792]);
  for (const t of data.tokens)
    page.drawText(t.text, { x: t.x, y: t.y, size: 8, font });
}
await writeFile("tmp/fixtures/xactimate-final-draft.pdf", await source.save());
const scan = await PDFDocument.create();
const scanPage = scan.addPage([612, 792]);
scanPage.drawRectangle({ x: 45, y: 80, width: 520, height: 630 });
await writeFile("tmp/fixtures/no-text.pdf", await scan.save());
await writeFile("tmp/fixtures/photo-800x600.png", photoPng(800, 600));
const d = validDraft();
const documents = await generateDocuments(d);
await writeFile(
  "tmp/pdfs/short-packet.pdf",
  new Uint8Array(await documents.combined.arrayBuffer()),
);
d.scopeEdited = true;
d.scope =
  "This detailed scope will continue on the attachment so the customer can read the entire description. ".repeat(
    30,
  ) + "END OF COMPLETE SCOPE.";
for (let i = 0; i < 14; i++) {
  const item = createChange(null);
  Object.assign(item, {
    description: `Additional repair ${i + 1}: ${"Install matching materials and verify the finish. ".repeat(3)}`,
    room: "Kitchen",
    quantity: "2",
    rate: "45.50",
    tax: "6.37",
    op: "18.20",
    reason: "Customer-approved upgrade to the damaged finishes.",
    pricingConfirmed: true,
  });
  d.changes.push(item);
}
const long = await generateDocuments(d);
await writeFile(
  "tmp/pdfs/long-packet.pdf",
  new Uint8Array(await long.combined.arrayBuffer()),
);
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/**
 * A two-tone 8-bit RGB PNG, encoded with node:zlib so the annotation test has a
 * real photo to draw on without committing a binary to the repo.
 */
function photoPng(width: number, height: number): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0; // PNG filter type: none
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      const sky = y < height / 2;
      raw[at] = sky ? 176 : 92;
      raw[at + 1] = sky ? 196 : 108;
      raw[at + 2] = sky ? 214 : 122;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}
console.log(
  "Created synthetic Xactimate fixtures, QA packets and a photo fixture in tmp/.",
);
