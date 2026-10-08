# Hays + Sons Change Orders

A separate, browser-based app for project managers to create itemized change orders from Xactimate Final Draft PDFs. The reference application remains in `C:\Users\russe\haysdocuments-2`.

## Run

```powershell
cd C:\Users\russe\hays-change-orders
npm install
npm run dev
```

Open http://127.0.0.1:3010. `npm run build` creates the production site in `dist`; `npm run preview` serves that build on the same port. Drafts are stored in Google Sheets and source PDFs in Google Drive through an Apps Script backend — see `docs/google-sheets-setup.md` for the one-time setup.

## Use

1. Create a change order and upload a selectable-text Xactimate Final Draft PDF (up to 40 MB). Review extracted rooms and original item values alongside the source. Missing values stay blank; enter applicable tax/O&P dollars, including zero where appropriate. Mark the original items reviewed.
2. Revise or credit original items, or add new work. Enter revised quantity/rate, tax and overhead/profit dollar amounts, and a reason. Confirm pricing on each item.
3. Confirm the customer, job, branch, insurance, signed original contract amount, previous authorized changes, and working days. Edit the generated scope summary if needed.
4. Preview/print/download the packet, form, or Attachment A. Signature spaces are included for owner and contractor.

Printed RCV remains the original baseline. A revision adds the change in rounded quantity × unit price and the changes in PM-reviewed tax/O&P dollars to that baseline. A removal credits full original RCV. Money uses decimal-string arithmetic with integer cents and half-away-from-zero rounding. Depreciation, ACV, and recap amounts do not become line items.

Drafts sync automatically to a shared Google Sheet, and uploaded source PDFs are stored in a Google Drive folder, so project managers see the same drafts across devices. Each save sends the draft to the Apps Script backend (the PDF stays in Drive), and a stale tab cannot overwrite a newer revision. Storage failures are shown and prevent leaving an unsaved draft through the app. Keep downloaded copies of completed documents.

The parser supports positioned Final Draft tables, wrapped descriptions, repeated headers, and explicit RCV columns. It also reads right-aligned RESET / REMOVE / REPLACE / TAX / O&P / TOTAL reports, combining the printed per-unit prices into the editable unit price while keeping the printed TOTAL as the original RCV. Source price components stay available during review. Existing negative credit lines are preserved and can be revised or removed. Room sketches, trade headings, page footers, recap totals, depreciation, and ACV do not become priced work. PDFs vary; review extracted fields against the source before generation. Scanned PDFs and unsupported reports use manual entry. The app does not infer pricing-list rates, tax applicability, or O&P rules. A later change order must use the appropriate current estimate baseline; previously exported packets do not automatically update the baseline or previous authorized changes.

## Verification

```powershell
npm run typecheck
npm test
npm run fixtures
npm run test:browser
npm run build
```

The fixtures are anonymous Xactimate-style reports, including split pricing, resets, credit lines, and room sketches. `tmp/` holds generated short/long packets and browser screenshots for QA. Browser tests require Playwright Chromium (`npx playwright install chromium` if absent). The supplied 29-page estimate was verified to extract all 296 source line items, matching the printed tax, O&P, room totals, and $167,045.81 RCV. To repeat the optional real-estimate browser regression, set `HAYS_ESTIMATE_SAMPLE` to that PDF's absolute path before running `npm run test:browser`; customer PDFs are not checked into the repository.
