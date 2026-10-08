import type { PositionedPage } from "../src/services/estimateParser";
import { token } from "./helpers";

// Anonymous regression data using the right-aligned column geometry of a real
// Xactimate RESET / REMOVE / REPLACE final draft. No customer PDF is checked in.
export function splitHeader(y = 600) {
  return [
    token("DESCRIPTION", 36, y, 62.505),
    token("QTY", 221.7, y, 19.503),
    token("RESET", 267.49, y, 29.511),
    token("REMOVE", 312.3, y, 40.5),
    token("REPLACE", 365.6, y, 43.002),
    token("TAX", 445.4, y, 18.999),
    token("O&P", 500.2, y, 19.998),
    token("TOTAL", 544.49, y, 31.509),
  ];
}
export function splitRow(
  n: string,
  description: string,
  y: number,
  qty: string,
  reset: string,
  remove: string,
  replace: string,
  tax: string,
  op: string,
  total: string,
) {
  return [
    token(
      `${n}. ${description}`,
      36,
      y,
      Math.min(description.length * 4 + 12, 140),
    ),
    token(qty, 235.2 - qty.length * 4.5, y, qty.length * 4.5),
    ...[reset, remove, replace, tax, op, total].flatMap((text, i) =>
      text
        ? [
            token(
              text,
              [297, 352.8, 408.6, 464.4, 520.2, 576][i] - text.length * 4.5,
              y,
              text.length * 4.5,
            ),
          ]
        : [],
    ),
  ];
}
export function splitPages(): PositionedPage[] {
  return [
    {
      page: 1,
      tokens: [
        token("Insured:", 75, 720),
        token("Sample Customer", 127, 720),
        token("Home: 555-0100", 405, 720),
        token("Property:", 75, 690),
        token("123 Sample Street", 127, 690),
        token("E-mail: sample@example.test", 405, 686),
        token("Fort Wayne, IN 46808", 127, 676),
        token("Claim Number: TEST-001", 36, 650),
        token("Policy Number: TBD", 260, 650),
        token("Type of Loss: Wind", 440, 650),
      ],
    },
    {
      page: 2,
      tokens: [
        token("Roof Framing", 36, 622),
        ...splitHeader(),
        token("****ROOF FRAMING****", 36, 584),
        ...splitRow(
          "1",
          "R&R Stud wall",
          560,
          "128.00 SF",
          "",
          "0.27",
          "2.46",
          "8.15",
          "71.54",
          "429.13",
        ),
        token(
          "Temporary support note extending across the full page.",
          36,
          544,
          450,
        ),
        ...splitRow(
          "2",
          "Fir / Larch",
          522,
          "2.00 EA",
          "",
          "0.00",
          "15.32",
          "2.14",
          "6.54",
          "39.32",
        ),
        token("(material only)", 36, 512),
        token("****CEILING JOISTS****", 36, 494),
        token("SAMPLE_ESTIMATE", 27, 62),
        token("Page: 2", 554, 62),
      ],
    },
    {
      page: 3,
      tokens: [
        token("CONTINUED - Roof Framing", 239, 655),
        ...splitHeader(632),
        ...splitRow(
          "21",
          "R&R Joist - floor or ceiling -",
          614,
          "467.50 LF",
          "",
          "0.91",
          "2.31",
          "30.76",
          "307.22",
          "1,843.34",
        ),
        token("w/blocking", 36, 604),
        ...splitRow(
          "345",
          "LABOR ONLY",
          590,
          "1.00 EA",
          "",
          "0.00",
          "-692.08",
          "0.00",
          "0.00",
          "-692.08",
        ),
        token("Total: Roof Framing", 36, 566),
        token("1,619.71", 540, 566),
        token("F3", 81.95, 501, 6.336),
        token("F3", 81.95, 501, 6.336),
        token("House Roof", 164.95, 502.34, 49.72),
        ...splitHeader(405),
        ...splitRow(
          "22",
          "Roof work",
          386,
          "2.00 SF",
          "",
          "0.20",
          "1.80",
          "0.00",
          "0.80",
          "4.80",
        ),
        token("Totals: House Roof", 36, 365),
        token("3' 1\"", 96, 341),
        token("Breeze way", 164.95, 341),
        token("Height: 7' 9\"", 520, 341),
        token("Subroom: Closet (1)", 164.95, 320),
        token("Height: 7' 9\"", 520, 320),
        ...splitHeader(280),
        ...splitRow(
          "47",
          "Detach & Reset Disconnect box",
          260,
          "1.00 EA",
          "46.63",
          "0.00",
          "0.00",
          "0.00",
          "9.32",
          "55.95",
        ),
        token("Totals: Breeze way", 36, 240),
      ],
    },
    {
      page: 4,
      tokens: [
        token("Summary for Dwelling", 260, 627),
        token("Replacement Cost Value", 36, 526),
        token("$1,680.46", 525, 526),
        token("Actual Cash Value", 36, 505),
        token("$1,200.00", 525, 505),
        token("1. A numbered recap narrative", 36, 480),
        token("100.00", 545, 480),
      ],
    },
  ];
}
