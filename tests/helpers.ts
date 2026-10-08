import {
  createDraft,
  createChange,
  blankEstimate,
  type ChangeOrderDraft,
} from "../src/types";
import type { PositionedPage, TextToken } from "../src/services/estimateParser";
export const token = (
  text: string,
  x: number,
  y: number,
  width = text.length * 4,
): TextToken => ({ text, x, y, width });
export function header(
  y = 600,
  options: { tax?: boolean; op?: boolean } = {},
): TextToken[] {
  return [
    ["DESCRIPTION", 48],
    ["QUANTITY", 300],
    ["UNIT PRICE", 365],
    ...(options.tax === false ? [] : [["TAX", 411]]),
    ...(options.op === false ? [] : [["O&P", 445]]),
    ["RCV", 479],
    ["DEPREC.", 526],
    ["ACV", 571],
  ].map(([text, x]) => token(String(text), Number(x), y));
}
export function row(
  n: string,
  description: string,
  y: number,
  qty = "100.00 SF",
  rate = "2.00",
  tax = "4.00",
  op = "20.00",
  rcv = "224.00",
): TextToken[] {
  return [
    token(`${n}.`, 48, y),
    token(description, 64, y),
    token(qty, 300, y),
    token(rate, 365, y),
    token(tax, 411, y),
    token(op, 445, y),
    token(rcv, 479, y),
    token("50.00", 526, y),
    token("174.00", 571, y),
  ];
}
export function samplePages(): PositionedPage[] {
  return [
    {
      page: 1,
      tokens: [
        token("Insured: Sample Customer", 48, 720),
        token("Property: 123 Sample Street, Fort Wayne, IN", 48, 700),
        token("Claim Number: TEST-001", 48, 680),
        token("Insurance Carrier: Sample Carrier", 48, 660),
        token("Living Room", 48, 622),
        ...header(),
        ...row("1", "Paint walls", 577),
        token("two coats, standard finish", 64, 565),
        ...row(
          "2",
          "Baseboard replacement",
          540,
          "20.00 LF",
          "5.00",
          "3.00",
          "10.00",
          "113.00",
        ),
        token("Totals: Living Room", 48, 510),
        token("337.00", 479, 510),
      ],
    },
    {
      page: 2,
      tokens: [
        token("Kitchen", 48, 622),
        ...header(),
        ...row(
          "3",
          "Cabinet repair",
          577,
          "1.00 EA",
          "300.00",
          "12.00",
          "60.00",
          "372.00",
        ),
        token("Summary", 48, 520),
        token("Replacement Cost Value 709.00", 48, 500),
        token("Actual Cash Value 559.00", 48, 480),
      ],
    },
  ];
}
export function validDraft(): ChangeOrderDraft {
  const d = createDraft();
  Object.assign(d.job, {
    customer: "Sample Customer",
    address: "123 Sample Street, Fort Wayne, IN 46808",
    jobNumber: "FW-TEST-001",
    projectManager: "Sample PM",
    branchContact: "Sample Contractor",
    carrier: "Sample Carrier",
    claim: "TEST-001",
    originalContract: "10000.00",
  });
  const original = {
    ...blankEstimate(),
    room: "Living Room",
    lineNumber: "1",
    description: "Paint walls",
    quantity: "100",
    unit: "SF",
    rate: "2.00",
    tax: "4.00",
    op: "20.00",
    rcv: "224.00",
    page: 1,
    reviewed: true,
  };
  d.estimate = [original];
  const change = createChange(original, "revise");
  Object.assign(change, {
    quantity: "150",
    tax: "6.00",
    op: "30.00",
    reason: "Additional wall area discovered",
    pricingConfirmed: true,
  });
  d.changes = [change];
  return d;
}
