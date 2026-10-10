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

1. **Project managers** describe what changed. Create a request, enter the job and property details, add one card per room/work area (add, revise, or remove work; what and why), attach photos, estimate PDFs, or subcontractor quotes, and submit to estimating. Drafts autosave as you type.
2. **Estimators** claim requests from the shared queue, review the PM's scope and quoted subcontractor costs, then price each work area — either as a final all-in customer price (tax and O&P included) or as retained quantity/rate line items. Replace several original items with a quoted lump sum, or enter a manual credit.
3. **Admins** import each customer's contract amount with the job list: the Dash JobSummaryReport CSV (or an export with a contract-amount column) becomes the searchable job directory on the Jobs page. Picking a job in the request form fills in the job number, customer, property address, responsible project manager, and the customer's original contract amount, so nobody retypes the contract amount on the change order. Estimators can still override any of it.
4. Estimators fill in the remaining contract details, previous authorized changes, insurance details, change-order number/date, and added working days as they become available. Nothing blocks the review: mark the request ready at any point, and blank details print blank with unreadable amounts printed as $0.00.
5. Completed requests become read-only; preview, print, or download the Hays cover, Attachment A, and combined packet. Subcontractor costs, quote PDFs, vendor details, and internal notes never appear in customer documents.

Legacy change orders from the previous four-step editor remain in a separate section: open them to finish, or convert one into a shared request (its PDFs are copied and prior pricing carried forward for estimator review).

Printed RCV remains the original baseline. A revision adds the change in rounded quantity × unit price and the changes in estimator-reviewed tax/O&P dollars to that baseline. A removal credits full original RCV. Money uses decimal-string arithmetic with integer cents and half-away-from-zero rounding. Depreciation, ACV, and recap amounts do not become line items.

Drafts and requests sync automatically to Google Sheets, and uploaded PDFs are stored in Google Drive, so the team sees the same queue across devices. Each save carries an expected revision and retry identifier, so a stale tab cannot overwrite a newer edit. Storage failures are shown and prevent leaving unsaved work through the app. Keep downloaded copies of completed documents.

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
