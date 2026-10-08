# Google Sheets + Apps Script setup

The app stores every change-order draft as a row in a Google Sheet and keeps
the uploaded source PDFs in a Google Drive folder. The frontend talks to a
deployed Apps Script web app.

## 1. Create the spreadsheet

1. Go to <https://sheets.google.com> and create a new blank spreadsheet named
   **Hays Change Orders**.
2. Optionally rename the first sheet. The script creates a **Drafts** sheet
   automatically on first use, so the default sheet can stay.

## 2. Paste the script

1. In the spreadsheet, open **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content and paste the entire contents of
   `apps-script/Code.gs`.
3. The script must be a **container-bound** script (created from inside the
   spreadsheet). Do not paste it into a standalone project, because
   `SpreadsheetApp.getActiveSpreadsheet()` only works when bound to the sheet.

The `appsscript.json` manifest (`apps-script/appsscript.json`) is provided for
reference. In the Apps Script editor you can confirm the runtime by going to
**Project Settings** and checking that it runs under V8. The web-app settings
(execute as the deploying user, access: Anyone) are set during deployment in
step 4.

## 3. Run the one-time setup

1. In the Apps Script editor, select the `setup` function from the toolbar
   dropdown and click **Run** — or reload the spreadsheet and use the
   **Change Orders → Run one-time setup** menu.
2. Accept the OAuth consent for **Google Sheets** and **Google Drive** when
   prompted.
3. `setup()` creates the **Drafts** sheet, creates the **hays-change-orders**
   Drive folder, and generates an API key. It shows a dialog with:
   - the **API key** → save this for step 5 (`VITE_APPS_SCRIPT_KEY`);
   - the deploy instructions.

Re-running `setup()` is safe: it reuses the existing sheet, folder, and key.

> The key is an access guard, not encryption. Anyone who can read the built
> JavaScript can extract it. For real authentication, replace the key check
> with Google Sign-In later.

## 4. Deploy as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Choose type **Web app**.
3. Description: `Hays change orders`.
4. **Execute as:** `Me (your account)`.
5. **Who has access:** `Anyone`.
6. Click **Deploy**, authorize if prompted, and copy the **Web app URL**. It
   looks like `https://script.google.com/macros/s/<id>/exec`.

Whenever you edit `Code.gs` later, create a **new deployment** (or edit the
existing one and point it to the new version) for production users to see the
change.

## 5. Point the app at it

Create `c:\Users\russe\hays-change-orders\.env.local` with:

```ini
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/<id>/exec
VITE_APPS_SCRIPT_KEY=<the same API_KEY value from step 3>
```

Then restart `npm run dev` (Vite reads `.env.local` at startup).

## 6. Verify

1. Open <http://127.0.0.1:3010>, create a draft, and upload a small PDF.
2. In the spreadsheet, a **Drafts** sheet should appear with one row.
3. In Google Drive, a folder named **hays-change-orders** should contain the
   PDF.
4. Open the app in a second browser/device: the draft should appear and open,
   and the source PDF should load from Drive.

## Notes

- **Upload size**: the client caps uploads at 15 MB. Apps Script web-app POST
  bodies are limited, and the PDF travels as base64 (~1.33× its size).
- **Limits**: list/open return JSON; the sheet stores the full draft as a JSON
  string in the `data` column plus a few searchable columns.
- **Revisions**: a save only lands if its `revision` is greater than or equal
  to the stored one, so a stale tab cannot overwrite a newer edit.
- **Local tests** expect the default local API path (`/__api__`) and are mocked
  in Playwright. Do not point `.env.local` at the real URL while running the
  browser tests.
