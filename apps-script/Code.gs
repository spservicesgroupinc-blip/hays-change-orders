/**
 * Hays + Sons Change Orders — Google Sheets + Drive storage backend.
 *
 * Container-bound script: paste this file into the Apps Script editor attached
 * to the "Drafts" spreadsheet (Extensions → Apps Script), set the API_KEY
 * script property, then deploy as a web app (execute as me, access: Anyone).
 *
 * Endpoints (all require the shared API key):
 *   GET  ?action=list             → { ok, drafts: [{summary…}] }
 *   GET  ?action=open&id=…        → { ok, draft }
 *   GET  ?action=pdf&id=…         → { ok, name, mimeType, data(base64) }
 *   POST {action:"save", draft}   → { ok }
 *   POST {action:"delete", id}    → { ok }
 *   POST {action:"uploadPdf", …}  → { ok, fileId }
 */

const SHEET_NAME = "Drafts";
const DRIVE_FOLDER_NAME = "hays-change-orders";
const API_KEY_PROP = "API_KEY";

const COLS = {
  ID: 0,
  REVISION: 1,
  CREATED_AT: 2,
  UPDATED_AT: 3,
  STEP: 4,
  CUSTOMER: 5,
  JOB_NUMBER: 6,
  ORDER_NUMBER: 7,
  ADDRESS: 8,
  CHANGES_COUNT: 9,
  SOURCE_NAME: 10,
  SOURCE_PAGES: 11,
  DRIVE_FILE_ID: 12,
  DATA: 13,
};
const COLUMN_COUNT = 14;

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function fail_(message) {
  return json_({ ok: false, error: message });
}

function verifiedKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty(
    API_KEY_PROP,
  );
  return Boolean(key) && key === expected;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      "id",
      "revision",
      "createdAt",
      "updatedAt",
      "step",
      "customer",
      "jobNumber",
      "orderNumber",
      "address",
      "changesCount",
      "sourceName",
      "sourcePages",
      "driveFileId",
      "data",
    ]);
  }
  return sheet;
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty("DRIVE_FOLDER_ID");
  if (cached) {
    try {
      return DriveApp.getFolderById(cached);
    } catch (e) {
      // fall through and recreate
    }
  }
  const root = DriveApp.getRootFolder();
  const matches = root.getFoldersByName(DRIVE_FOLDER_NAME);
  const folder = matches.hasNext()
    ? matches.next()
    : root.createFolder(DRIVE_FOLDER_NAME);
  props.setProperty("DRIVE_FOLDER_ID", folder.getId());
  return folder;
}

function findRow_(id) {
  const sheet = sheet_();
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const ids = sheet.getRange(2, COLS.ID + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i += 1) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return null;
}

function rowToSummary_(values) {
  return {
    id: String(values[COLS.ID] || ""),
    revision: Number(values[COLS.REVISION] || 0),
    createdAt: String(values[COLS.CREATED_AT] || ""),
    updatedAt: String(values[COLS.UPDATED_AT] || ""),
    step: Number(values[COLS.STEP] || 0),
    customer: String(values[COLS.CUSTOMER] || ""),
    jobNumber: String(values[COLS.JOB_NUMBER] || ""),
    orderNumber: String(values[COLS.ORDER_NUMBER] || ""),
    address: String(values[COLS.ADDRESS] || ""),
    changesCount: Number(values[COLS.CHANGES_COUNT] || 0),
    sourceName: String(values[COLS.SOURCE_NAME] || ""),
    hasSource: Boolean(values[COLS.DRIVE_FILE_ID]),
  };
}

function draftToRow_(draft) {
  const source = draft && draft.source ? draft.source : null;
  const job = draft && draft.job ? draft.job : {};
  return [
    draft.id,
    draft.revision,
    draft.createdAt,
    draft.updatedAt,
    draft.step,
    job.customer || "",
    job.jobNumber || "",
    job.orderNumber || "",
    job.address || "",
    Array.isArray(draft.changes) ? draft.changes.length : 0,
    source ? source.name : "",
    source ? source.pages : "",
    source && source.driveFileId ? source.driveFileId : "",
    JSON.stringify(draft),
  ];
}

function doGet(e) {
  const p = e.parameter || {};
  if (!verifiedKey_(p.key)) return fail_("Unauthorized.");
  if (p.action === "list") return list_();
  if (p.action === "open") return open_(p.id);
  if (p.action === "pdf") return pdf_(p.id);
  return fail_("Unknown action.");
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return fail_("Invalid request.");
  }
  if (!verifiedKey_(body.key)) return fail_("Unauthorized.");
  if (body.action === "save") return save_(body.draft);
  if (body.action === "delete") return delete_(body.id);
  if (body.action === "uploadPdf") return uploadPdf_(body);
  return fail_("Unknown action.");
}

function list_() {
  const sheet = sheet_();
  const last = sheet.getLastRow();
  const values =
    last >= 2
      ? sheet.getRange(2, 1, last - 1, COLUMN_COUNT).getValues()
      : [];
  const rows = values
    .map(rowToSummary_)
    .sort(function (a, b) {
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  return json_({ ok: true, drafts: rows });
}

function open_(id) {
  const row = findRow_(id);
  if (!row) return fail_("Draft not found.");
  const values = sheet_().getRange(row, 1, 1, COLUMN_COUNT).getValues()[0];
  return json_({ ok: true, draft: JSON.parse(String(values[COLS.DATA])) });
}

function pdf_(id) {
  try {
    const file = DriveApp.getFileById(id);
    const bytes = file.getBlob().getBytes();
    return json_({
      ok: true,
      name: file.getName(),
      mimeType: file.getMimeType(),
      data: Utilities.base64Encode(bytes),
    });
  } catch (e) {
    return fail_("Source PDF not found.");
  }
}

function save_(draft) {
  if (!draft || !draft.id) return fail_("Draft is missing.");
  const sheet = sheet_();
  const row = findRow_(draft.id);
  if (row) {
    const currentRevision = Number(
      sheet.getRange(row, COLS.REVISION + 1).getValue() || 0,
    );
    if (currentRevision > draft.revision)
      return fail_(
        "A newer version of this draft already exists. Refresh and reopen it before editing.",
      );
    const values = draftToRow_(draft);
    sheet.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(draftToRow_(draft));
  }
  return json_({ ok: true });
}

function delete_(id) {
  const row = findRow_(id);
  if (!row) return json_({ ok: true });
  const sheet = sheet_();
  const fileId = String(
    sheet.getRange(row, COLS.DRIVE_FILE_ID + 1).getValue() || "",
  );
  sheet.deleteRow(row);
  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e) {
      // already gone
    }
  }
  return json_({ ok: true });
}

function uploadPdf_(body) {
  const bytes = Utilities.base64Decode(String(body.data || ""));
  const mimeType = String(body.mimeType || "application/pdf");
  const name = String(body.name || "estimate.pdf");
  const blob = Utilities.newBlob(bytes, mimeType, name);
  let fileId = String(body.fileId || "");
  if (fileId) {
    DriveApp.getFileById(fileId).setBlob(blob);
  } else {
    fileId = folder_().createFile(blob).getId();
  }
  const replaceFileId = String(body.replaceFileId || "");
  if (replaceFileId && replaceFileId !== fileId) {
    try {
      DriveApp.getFileById(replaceFileId).setTrashed(true);
    } catch (e) {
      // already gone
    }
  }
  return json_({ ok: true, fileId: fileId });
}
