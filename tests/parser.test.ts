import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEstimate } from "../src/services/estimateParser";
import { samplePages, header, row, token } from "./helpers";
test("reconstructs rooms, wrapped rows and pages; excludes recaps and ACV", () => {
  const result = parseEstimate(samplePages());
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].room, "Living Room");
  assert.equal(result.items[2].room, "Kitchen");
  assert.equal(
    result.items[0].description,
    "Paint walls two coats, standard finish",
  );
  assert.equal(result.items[0].rcv, "224.00");
  assert.equal(result.items[0].quantity, "100.00");
  assert.equal(result.items[0].unit, "SF");
  assert.equal(result.items[2].page, 2);
  assert.equal(result.job.originalContract, "709.00");
  assert.equal(result.job.customer, "Sample Customer");
  assert.ok(result.items.every((i) => !i.reviewed));
  assert.deepEqual(result.items[0].warnings, []);
});
test("missing optional columns stay blank and need PM review", () => {
  const tokens = [
    token("Bedroom", 48, 622),
    ...header(600, { tax: false, op: false }),
    ...row("1", "Replace flooring", 577).filter(
      (t) => t.x !== 411 && t.x !== 445,
    ),
  ];
  const result = parseEstimate([{ page: 1, tokens }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].tax, "");
  assert.equal(result.items[0].op, "");
  assert.equal(result.items[0].rcv, "224.00");
  assert.ok(
    result.items[0].warnings.some((w) => w.includes("O&P is not shown")),
  );
});
test("Xactimate column labels: LINE ITEM, QTY, UNIT COST, O & P", () => {
  const tokens = [
    token("Claim Number: 22-123456", 48, 720),
    token("Type of Loss: Water", 48, 700),
    token("Kitchen", 48, 622),
    token("LINE ITEM", 48, 600),
    token("QTY", 300, 600),
    token("UNIT", 365, 600),
    token("COST", 390, 600),
    token("TAX", 411, 600),
    token("O & P", 445, 600),
    token("RCV", 479, 600),
    token("DEPREC.", 526, 600),
    token("ACV", 571, 600),
    token("1.", 48, 577),
    token("Replace kitchen cabinets", 64, 577),
    token("1.00 EA", 300, 577),
    token("450.00", 365, 577),
    token("9.00", 411, 577),
    token("45.00", 445, 577),
    token("504.00", 479, 577),
    token("100.00", 526, 577),
    token("404.00", 571, 577),
  ];
  const result = parseEstimate([{ page: 1, tokens }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].room, "Kitchen");
  assert.equal(result.items[0].description, "Replace kitchen cabinets");
  assert.equal(result.items[0].quantity, "1.00");
  assert.equal(result.items[0].unit, "EA");
  assert.equal(result.items[0].rate, "450.00");
  assert.equal(result.items[0].tax, "9.00");
  assert.equal(result.items[0].op, "45.00");
  assert.equal(result.items[0].rcv, "504.00");
  assert.equal(result.job.claim, "22-123456");
});
test("numeric values on a second baseline complete a row without inventing values", () => {
  const result = parseEstimate([
    {
      page: 1,
      tokens: [
        ...header(),
        token("1. Paint walls", 48, 577),
        ...row("1", "", 560).filter((t) => t.x >= 300),
      ],
    },
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, "100.00");
  assert.equal(result.items[0].rcv, "224.00");
});
test("repeated headers preserve a wrapped item across a page boundary", () => {
  const result = parseEstimate([
    {
      page: 1,
      tokens: [
        token("Living Room", 48, 622),
        ...header(),
        ...row("1", "Paint walls", 560),
      ],
    },
    {
      page: 2,
      tokens: [
        ...header(),
        token("continued description", 64, 577),
        ...row("2", "Trim", 550),
      ],
    },
  ]);
  assert.equal(result.items.length, 2);
  assert.match(result.items[0].description, /continued description/);
  assert.equal(result.items[1].room, "Living Room");
  assert.notEqual(result.items[0].id, result.items[1].id);
});
test("scans and unsupported layouts yield manual-entry guidance", () => {
  assert.equal(parseEstimate([{ page: 1, tokens: [] }]).items.length, 0);
  assert.match(
    parseEstimate([
      { page: 1, tokens: [token("An unrelated contract", 40, 500)] },
    ]).warnings[0],
    /manually/,
  );
});
