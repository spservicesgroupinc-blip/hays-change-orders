import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";
import { parseEstimate, type PositionedPage } from "./estimateParser";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export async function extractEstimate(
  blob: Blob,
  onProgress: (value: string) => void,
) {
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  try {
    const pages: PositionedPage[] = [];
    for (let p = 1; p <= document.numPages; p++) {
      onProgress(`Reading page ${p} of ${document.numPages}…`);
      const page = await document.getPage(p);
      const content = await page.getTextContent();
      pages.push({
        page: p,
        tokens: content.items.flatMap((item) =>
          "str" in item
            ? [
                {
                  text: item.str,
                  x: item.transform[4],
                  y: item.transform[5],
                  width: item.width,
                },
              ]
            : [],
        ),
      });
      page.cleanup();
    }
    const result = parseEstimate(pages);
    if (!pages.some((page) => page.tokens.some((token) => token.text.trim())))
      result.warnings = [
        "This PDF has no selectable text. Scans and photos need OCR; enter the items manually or upload a text-based Final Draft PDF.",
      ];
    return { ...result, pages: document.numPages };
  } finally {
    await document.destroy();
  }
}
