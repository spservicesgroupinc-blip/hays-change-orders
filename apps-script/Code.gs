/**
 * Hays + Sons Change Orders — Google Sheets + Drive storage backend.
 *
 * Container-bound script: paste this whole file into the Apps Script editor
 * attached to a Google Sheet (Extensions → Apps Script), then run setup()
 * once (or use the "Change Orders" menu). setup() creates the Drafts sheet
 * and the Drive folder. Finally deploy as a web app (execute as me, access:
 * Anyone) and paste the Web app URL into .env.local.
 *
 * Endpoints:
 *   GET  ?action=list             → { ok, drafts: [{summary…}] }
 *   GET  ?action=open&id=…        → { ok, draft }
 *   GET  ?action=pdf&id=…         → { ok, name, mimeType, data(base64) }
 *   POST {action:"save", draft}   → { ok }
 *   POST {action:"delete", id}    → { ok }
 *   POST {action:"uploadPdf", …}  → { ok, fileId }
 */

const SHEET_NAME = "Drafts";
const DRIVE_FOLDER_NAME = "hays-change-orders";

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

function fail_(message, code, currentRevision) {
  return json_({ ok: false, error: message, code: code || "SERVICE_ERROR", currentRevision: currentRevision });
}

function sheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("SPREADSHEET_ID");
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Run setup() in the spreadsheet editor to configure SPREADSHEET_ID.");
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

function setup() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", active.getId());
  const sheet = sheet_();
  const folder = folder_();
  requestsSheet_();
  jobsSheet_();
  const summary = [
    "Setup complete.",
    "Drafts sheet: " + sheet.getName(),
    "Drive folder: " + folder.getName(),
    "",
    "Then: Deploy → New deployment → Web app",
    "  Execute as: Me",
    "  Who has access: Anyone",
    "After deploying, paste the Web app URL into .env.local as",
    "VITE_APPS_SCRIPT_URL and restart npm run dev.",
  ].join("\n");
  Logger.log(summary);
  try {
    SpreadsheetApp.getUi().alert(
      "Change Orders setup",
      summary,
      SpreadsheetApp.getUi().ButtonSet.OK,
    );
  } catch (e) {
    // Headless context; Logger already has the summary.
  }
  return summary;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Change Orders")
    .addItem("Run one-time setup", "setup")
    .addToUi();
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
  const p = (e && e.parameter) || {};
  if (p.action === "bootstrap") return guarded_(function () { return bootstrap_(); });
  if (p.action === "listRequests") return guarded_(function () { return listRequests_(); });
  if (p.action === "openRequest") return guarded_(function () { return openRequest_(p.id); });
  if (p.action === "listJobs") return guarded_(function () { return listJobs_(); });
  if (p.action === "fetchAttachment") return guarded_(function () { return fetchAttachment_(p.requestId, p.attachmentId); });
  if (p.action === "list") return list_();
  if (p.action === "open") return open_(p.id);
  if (p.action === "pdf") return pdf_(p.id);
  return fail_("Unknown action.");
}

function doPost(e) {
  if (!e || !e.postData) return fail_("Invalid request.");
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return fail_("Invalid request.");
  }
  if (body.action === "saveRequest") return guarded_(function () { return saveRequest_(body); });
  if (body.action === "claimRequest") return guarded_(function () { return claimRequest_(body); });
  if (body.action === "transitionRequest") return guarded_(function () { return transitionRequest_(body); });
  if (body.action === "uploadAttachment") return guarded_(function () { return uploadAttachment_(body); });
  if (body.action === "completeRequest") return guarded_(function () { return completeRequest_(body); });
  if (body.action === "convertLegacyRequest") return guarded_(function () { return convertLegacyRequest_(body); });
  if (body.action === "importJobs") return guarded_(function () { return importJobs_(body); });
  if (body.action === "save") return save_(body.draft);
  if (body.action === "delete") return delete_(body.id);
  if (body.action === "uploadPdf") return uploadPdf_(body);
  return fail_("Unknown action.");
}

function draftRows_() {
  const sheet = sheet_();
  const last = sheet.getLastRow();
  const values =
    last >= 2
      ? sheet.getRange(2, 1, last - 1, COLUMN_COUNT).getValues()
      : [];
  return values
    .map(rowToSummary_)
    .sort(function (a, b) {
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}
function list_() {
  return json_({ ok: true, drafts: draftRows_() });
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
  // Replaced crashing code (.setBlob on file objects) with safely building entirely new files.
  const fileId = folder_().createFile(blob).getId();
  return json_({ ok: true, fileId: fileId });
}

const REQUEST_HEADERS = ["id", "revision", "createdAt", "updatedAt", "status", "estimatorName", "customer", "jobNumber", "projectManager", "orderNumber", "address", "changesCount", "attachmentsCount", "dataFileId", "previousDataFileId", "folderId"];
const JOB_HEADERS = ["id", "jobNumber", "customer", "address", "projectManager", "estimator", "status", "customerPhone", "customerEmail", "active", "updatedAt"];
const RC = { ID: 0, REVISION: 1, CREATED: 2, UPDATED: 3, STATUS: 4, ESTIMATOR: 5, CUSTOMER: 6, JOB: 7, PM: 8, ORDER: 9, ADDRESS: 10, CHANGES: 11, ATTACHMENTS: 12, DATA: 13, PREVIOUS: 14, FOLDER: 15 };
function problem_(code, message, revision) { const error = new Error(message); error.code = code; error.currentRevision = revision; throw error; }
function guarded_(fn) { try { return fn(); } catch (error) { return fail_(error.message || "The sync service is unavailable.", error.code, error.currentRevision); } }
function locked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) problem_("BUSY", "Another update is in progress. Retry in a moment.");
  try { return fn(); } finally { lock.releaseLock(); }
}
function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) problem_("SETUP_REQUIRED", "Run setup() in the spreadsheet editor to configure SPREADSHEET_ID.");
  return SpreadsheetApp.openById(id);
}
function requestsSheet_() {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName("Requests");
  if (!sheet) { sheet = ss.insertSheet("Requests"); sheet.appendRow(REQUEST_HEADERS); }
  return sheet;
}
function jobsSheet_() {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName("Jobs");
  if (!sheet) { sheet = ss.insertSheet("Jobs"); sheet.appendRow(JOB_HEADERS); }
  return sheet;
}
function jobRow_(v) {
  return { id: String(v[0]), jobNumber: String(v[1] || ""), customer: String(v[2] || ""), address: String(v[3] || ""), projectManager: String(v[4] || ""), estimator: String(v[5] || ""), status: String(v[6] || ""), customerPhone: String(v[7] || ""), customerEmail: String(v[8] || ""), active: v[9] === true || String(v[9]).toLowerCase() === "true", updatedAt: String(v[10] || "") };
}
function jobRows_() {
  const sheet = jobsSheet_(); const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, JOB_HEADERS.length).getValues();
  return rows.map(jobRow_);
}
function listJobs_() {
  return json_({ ok: true, jobs: jobRows_() });
}
function importJobs_(body) {
  if (!body || !Array.isArray(body.jobs)) problem_("VALIDATION", "A jobs array is required.");
  if (body.jobs.length > 5000) problem_("VALIDATION", "Too many jobs to import at once.");
  const sheet = jobsSheet_();
  const now = new Date().toISOString();
  const values = body.jobs.map(function (job) {
    return [String(job.id || ""), String(job.jobNumber || ""), String(job.customer || ""), String(job.address || ""), String(job.projectManager || ""), String(job.estimator || ""), String(job.status || ""), String(job.customerPhone || ""), String(job.customerEmail || ""), Boolean(job.active), String(job.updatedAt || now)];
  });
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, JOB_HEADERS.length).clearContent();
  if (values.length) sheet.getRange(2, 1, values.length, JOB_HEADERS.length).setValues(values);
  SpreadsheetApp.flush();
  return json_({ ok: true, jobs: body.jobs });
}
function requestRow_(id) {
  const sheet = requestsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const rows = sheet.getRange(2, 1, last - 1, REQUEST_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) if (String(rows[i][RC.ID]) === String(id)) return { row: i + 2, values: rows[i] };
  return null;
}
function readSnapshot_(row) {
  try { return JSON.parse(DriveApp.getFileById(String(row.values[RC.DATA])).getBlob().getDataAsString("UTF-8")); }
  catch (error) { problem_("DATA_UNAVAILABLE", "The saved request data could not be loaded. No changes were made."); }
}
function summary_(v) {
  return { id: String(v[RC.ID]), revision: Number(v[RC.REVISION]), createdAt: String(v[RC.CREATED]), updatedAt: String(v[RC.UPDATED]), status: String(v[RC.STATUS]), estimatorName: String(v[RC.ESTIMATOR] || ""), changesCount: Number(v[RC.CHANGES]), attachmentsCount: Number(v[RC.ATTACHMENTS]), job: { customer: String(v[RC.CUSTOMER] || ""), jobNumber: String(v[RC.JOB] || ""), projectManager: String(v[RC.PM] || ""), orderNumber: String(v[RC.ORDER] || ""), address: String(v[RC.ADDRESS] || "") } };
}
function requestRows_() {
  const sheet = requestsSheet_(); const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, REQUEST_HEADERS.length).getValues();
  return rows.map(summary_).sort(function(a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
}
function listRequests_() {
  return json_({ ok: true, requests: requestRows_() });
}
function bootstrap_() {
  // One round-trip loads everything the dashboard and job picker need, instead
  // of three separate Apps Script executions (each with a cold-start delay).
  return json_({ ok: true, requests: requestRows_(), drafts: draftRows_(), jobs: jobRows_() });
}
function openRequest_(id) {
  const row = requestRow_(id); if (!row) problem_("NOT_FOUND", "Request not found.");
  return json_({ ok: true, request: readSnapshot_(row).request });
}
function checkMutation_(body) {
  if (!body.mutationId || typeof body.mutationId !== "string" || body.mutationId.length > 100) problem_("VALIDATION", "A mutation identifier is required.");
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) problem_("VALIDATION", "A valid expected revision is required.");
}
function sameMutation_(snapshot, mutationId) { return snapshot && Array.isArray(snapshot.mutations) && snapshot.mutations.indexOf(mutationId) >= 0; }
function revisionCheck_(row, expected) {
  const revision = row ? Number(row.values[RC.REVISION]) : 0;
  if (expected !== revision) problem_("CONFLICT", "This request changed in another window. Reopen it before applying your edits.", revision);
}
function commitRequest_(request, row, snapshot, mutationId, existingFolder) {
  const now = new Date().toISOString();
  request.revision = row ? Number(row.values[RC.REVISION]) + 1 : 1;
  request.updatedAt = now; request.createdAt = row ? String(row.values[RC.CREATED]) : now;
  const folder = existingFolder || (row ? DriveApp.getFolderById(String(row.values[RC.FOLDER])) : folder_().createFolder("request-" + request.id));
  const mutations = (snapshot && snapshot.mutations || []).concat(mutationId).slice(-100);
  const data = JSON.stringify({ request: request, mutations: mutations });
  if (data.length > 5000000) problem_("VALIDATION", "The request is too large to save.");
  const file = folder.createFile(Utilities.newBlob(data, "application/json", "request-r" + request.revision + "-" + mutationId + ".json"));
  const values = [request.id, request.revision, request.createdAt, now, request.status, request.estimatorName, request.job.customer, request.job.jobNumber, request.job.projectManager, request.job.orderNumber, request.job.address, request.requestedChanges.length, request.attachments.length, file.getId(), row ? String(row.values[RC.DATA]) : "", folder.getId()];
  const sheet = requestsSheet_();
  sheet.getRange(row ? row.row : sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  SpreadsheetApp.flush();
  return json_({ ok: true, request: request });
}
function decimal_(value, signed) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d{1,6})?$/.test(value.trim())) return false;
  const number = Number(value); return Number.isFinite(number) && Math.abs(number) <= 10000000000 && (signed || number >= 0);
}
function moneyCents_(value) {
  if (!decimal_(value, true)) throw new Error("Invalid decimal.");
  const parts = decimalParts_(value);
  return roundDecimalCents_(parts.digits, parts.places, parts.negative);
}
function subtotalCents_(quantity, rate) {
  if (!decimal_(quantity, false) || !decimal_(rate, true)) throw new Error("Invalid decimal.");
  const q = decimalParts_(quantity); const r = decimalParts_(rate);
  return roundDecimalCents_(multiplyDigits_(q.digits, r.digits), q.places + r.places, q.negative !== r.negative);
}
function decimalParts_(value) {
  const text = value.trim(); const negative = text.charAt(0) === "-";
  const parts = (negative ? text.slice(1) : text).split("."); const decimal = parts[1] || "";
  return { digits: (parts[0] + decimal).replace(/^0+(?=\d)/, ""), places: decimal.length, negative: negative };
}
function multiplyDigits_(left, right) {
  const result = Array(left.length + right.length).fill(0);
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) result[i + j + 1] += Number(left.charAt(i)) * Number(right.charAt(j));
  for (let k = result.length - 1; k > 0; k--) { result[k - 1] += Math.floor(result[k] / 10); result[k] %= 10; }
  return result.join("").replace(/^0+(?=\d)/, "");
}
function incrementDigits_(digits) {
  const result = digits.split(""); let carry = 1;
  for (let i = result.length - 1; i >= 0 && carry; i--) { const sum = Number(result[i]) + carry; result[i] = String(sum % 10); carry = Math.floor(sum / 10); }
  if (carry) result.unshift("1"); return result.join("");
}
function roundDecimalCents_(digits, places, negative) {
  let centsDigits;
  if (places <= 2) centsDigits = digits + "0".repeat(2 - places);
  else {
    const discard = places - 2; const padded = digits.padStart(discard + 1, "0"); centsDigits = padded.slice(0, -discard);
    if (Number(padded.charAt(padded.length - discard)) >= 5) centsDigits = incrementDigits_(centsDigits);
  }
  const magnitude = Number(centsDigits);
  if (!Number.isSafeInteger(magnitude) || magnitude > 1000000000000) throw new Error("Amount is too large.");
  return negative ? -magnitude : magnitude;
}
function submissionErrors_(request) {
  // A request may be submitted with any data. Estimators review the scope and
  // ask for information instead, so submission blocks on nothing — no required
  // fields, no minimum work areas, and no quote-cost formatting rules.
  return [];
}
function readyErrors_(request) {
  const errors = submissionErrors_(request); const job = request.job;
  if (!request.estimatorName.trim()) errors.push("An estimator must claim this request.");
  if (!request.contractConfirmed) errors.push("Confirm the contract amounts and working days.");
  if (!request.customerScopeConfirmed || !request.customerScope.trim()) errors.push("Confirm the customer-facing scope summary.");
  ["branchName", "branchAddress", "branchPhone", "branchContact", "orderNumber", "date"].forEach(function(key) { if (!String(job[key] || "").trim()) errors.push(key + " is required."); });
  if (job.insuranceRelated && (!job.carrier.trim() || !job.claim.trim())) errors.push("Enter the carrier and claim number.");
  const date = new Date(job.date + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(job.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== job.date) errors.push("Enter a valid change-order date.");
  if (!decimal_(job.originalContract, false) || !decimal_(job.previousChanges, true)) errors.push("Enter valid contract amounts.");
  if (!/^\d+$/.test(job.addedDays) || Number(job.addedDays) > 3650) errors.push("Enter valid added working days.");
  if (!request.pricedItems.length) errors.push("Add at least one priced item.");
  const originalIds = {}; let net = 0;
  request.requestedChanges.forEach(function(change, index) { if (!request.pricedItems.some(function(row) { return row.requestChangeId === change.id; }) && !String(request.exclusions[change.id] || "").trim()) errors.push("Change " + (index + 1) + ": add pricing or an exclusion reason."); });
  request.pricedItems.forEach(function(row, index) {
    const prefix = "Item " + (index + 1) + ": ";
    if (!request.requestedChanges.some(function(change) { return change.id === row.requestChangeId; })) errors.push(prefix + "link to an existing requested change.");
    if (!String(row.description || "").trim() || !String(row.reason || "").trim() || !row.pricingConfirmed) errors.push(prefix + "enter customer description/reason and confirm pricing.");
    const original = row.original;
    if (original) {
      if (originalIds[original.id]) errors.push(prefix + "original item is priced twice."); originalIds[original.id] = true;
      if (!original.reviewed || !String(original.description || "").trim() || !String(original.unit || "").trim() || ["quantity", "rate", "tax", "op", "rcv"].some(function(key) { return !decimal_(original[key], key !== "quantity"); })) errors.push(prefix + "review original estimate values.");
    }
    try {
      const baseline = original ? moneyCents_(original.rcv) : 0; let revised;
      if (row.action === "remove") {
        if (original) revised = 0;
        else if (decimal_(row.manualCredit, false) && moneyCents_(row.manualCredit) > 0) revised = -moneyCents_(row.manualCredit);
        else throw new Error("Enter a positive credit.");
      } else if (row.customerPrice) {
        if (!decimal_(row.customerPrice.total, baseline < 0)) throw new Error("Invalid customer total.");
        ["tax", "op"].forEach(function(key) { if (row.customerPrice[key] !== null && !decimal_(row.customerPrice[key], baseline < 0)) throw new Error("Invalid included breakdown."); });
        revised = moneyCents_(row.customerPrice.total);
        const tax = row.customerPrice.tax === null ? 0 : moneyCents_(row.customerPrice.tax);
        const op = row.customerPrice.op === null ? 0 : moneyCents_(row.customerPrice.op);
        if (baseline >= 0 && tax + op > revised) throw new Error("Included tax/O&P exceed customer total.");
      } else {
        if (!String(row.unit || "").trim() || ["quantity", "rate", "tax", "op"].some(function(key) { return !decimal_(row[key], key !== "quantity" && baseline < 0); })) throw new Error("Invalid item pricing.");
        const base = subtotalCents_(row.quantity, row.rate);
        revised = original ? baseline + base - subtotalCents_(original.quantity, original.rate) + moneyCents_(row.tax) - moneyCents_(original.tax) + moneyCents_(row.op) - moneyCents_(original.op) : base + moneyCents_(row.tax) + moneyCents_(row.op);
      }
      if (revised < 0 && baseline >= 0 && row.action !== "remove") throw new Error("Invalid negative revised total.");
      net += revised - baseline;
    } catch (error) { errors.push(prefix + "correct pricing values."); }
  });
  try { if (moneyCents_(job.originalContract) + moneyCents_(job.previousChanges) + net < 0) errors.push("The revised contract amount cannot be negative."); } catch (error) { /* field errors already above */ }
  return errors;
}
function shapeCheck_(request) {
  if (!request || request.schemaVersion !== 2 || !request.id || typeof request.id !== "string" || request.id.length > 100 || !request.job) problem_("VALIDATION", "A valid version-2 request is required.");
  ["requestedChanges", "quotes", "attachments", "estimate", "pricedItems", "extractionWarnings"].forEach(function(key) { if (!Array.isArray(request[key])) problem_("VALIDATION", key + " must be a list."); });
  if (!request.exclusions || typeof request.exclusions !== "object" || Array.isArray(request.exclusions)) problem_("VALIDATION", "Exclusions must be keyed by requested change.");
  ["estimatorName", "informationQuestion", "customerScope"].forEach(function(key) { if (typeof request[key] !== "string") problem_("VALIDATION", key + " must be text."); });
  const jobKeys = ["customer", "address", "jobNumber", "projectManager", "branchName", "branchAddress", "branchPhone", "branchContact", "carrier", "claim", "orderNumber", "date", "originalContract", "previousChanges", "addedDays"];
  jobKeys.forEach(function(key) { if (typeof request.job[key] !== "string") problem_("VALIDATION", "Job " + key + " must be text."); });
  const unique = function(rows) { const seen = {}; rows.forEach(function(row) { if (!row || !row.id || typeof row.id !== "string" || seen[row.id]) problem_("VALIDATION", "Item identifiers must be unique."); seen[row.id] = true; }); };
  unique(request.requestedChanges); unique(request.quotes); unique(request.attachments); unique(request.estimate); unique(request.pricedItems);
  request.requestedChanges.forEach(function(change) {
    ["room", "description", "reason", "measurements", "materials", "scheduleImpact"].forEach(function(key) { if (typeof change[key] !== "string") problem_("VALIDATION", "Requested change " + key + " must be text."); });
    if (["add", "revise", "remove"].indexOf(change.action) < 0 || !Array.isArray(change.estimateItemIds)) problem_("VALIDATION", "Invalid requested change.");
    if (change.estimateItemIds.some(function(id) { return !request.estimate.some(function(item) { return item.id === id; }); })) problem_("VALIDATION", "A referenced estimate item is missing.");
  });
  request.quotes.forEach(function(quote) {
    ["subcontractor", "trade", "cost", "notes"].forEach(function(key) { if (typeof quote[key] !== "string") problem_("VALIDATION", "Quote " + key + " must be text."); });
    if (!Array.isArray(quote.changeIds) || !Array.isArray(quote.attachmentIds) || quote.changeIds.some(function(id) { return !request.requestedChanges.some(function(change) { return change.id === id; }); }) || quote.attachmentIds.some(function(id) { return !request.attachments.some(function(attachment) { return attachment.id === id && attachment.kind === "quote"; }); })) problem_("VALIDATION", "A quote references a missing change or quote attachment.");
  });
  if (request.estimateAttachmentId && !request.attachments.some(function(attachment) { return attachment.id === request.estimateAttachmentId && attachment.kind === "estimate"; })) problem_("VALIDATION", "The source estimate attachment is missing.");
}
function attachmentFile_(row, attachment) {
  let file, metadata;
  try { file = DriveApp.getFileById(attachment.driveFileId); metadata = JSON.parse(file.getDescription()); } catch (error) { problem_("VALIDATION", "An attachment is unavailable. Upload it again or remove it."); }
  const parents = file.getParents(); let belongs = false;
  while (parents.hasNext()) if (parents.next().getId() === String(row.values[RC.FOLDER])) belongs = true;
  if (!belongs || metadata.requestId !== String(row.values[RC.ID]) || metadata.attachment.id !== attachment.id || metadata.attachment.driveFileId !== attachment.driveFileId) problem_("VALIDATION", "Attachment does not belong to this request.");
  return { file: file, attachment: metadata.attachment };
}
function intakeFingerprint_(request) {
  return JSON.stringify([request.requestedChanges, request.quotes, request.attachments, request.estimate, request.estimateAttachmentId, ["customer", "address", "jobNumber", "projectManager", "carrier", "claim", "insuranceRelated"].map(function(key) { return request.job[key]; })]);
}
function invalidateIntake_(previous, request) {
  const affected = {}; const all = function() { request.requestedChanges.forEach(function(change) { affected[change.id] = true; }); };
  const shared = function(value) { return JSON.stringify([value.estimate, value.estimateAttachmentId, ["customer", "address", "jobNumber", "projectManager", "carrier", "claim", "insuranceRelated"].map(function(key) { return value.job[key]; })]); };
  if (shared(previous) !== shared(request)) all();
  previous.requestedChanges.concat(request.requestedChanges).forEach(function(change) { const old = previous.requestedChanges.filter(function(item) { return item.id === change.id; })[0]; const next = request.requestedChanges.filter(function(item) { return item.id === change.id; })[0]; if (JSON.stringify(old) !== JSON.stringify(next)) affected[change.id] = true; });
  previous.quotes.concat(request.quotes).forEach(function(quote) { const old = previous.quotes.filter(function(item) { return item.id === quote.id; })[0]; const next = request.quotes.filter(function(item) { return item.id === quote.id; })[0]; if (JSON.stringify(old) !== JSON.stringify(next)) { const ids = (old ? old.changeIds : []).concat(next ? next.changeIds : []); if (!ids.length) all(); else ids.forEach(function(id) { affected[id] = true; }); } });
  previous.attachments.concat(request.attachments).forEach(function(attachment) { const old = previous.attachments.filter(function(item) { return item.id === attachment.id; })[0]; const next = request.attachments.filter(function(item) { return item.id === attachment.id; })[0]; if (JSON.stringify(old) !== JSON.stringify(next)) { const ids = []; previous.quotes.concat(request.quotes).forEach(function(quote) { if (quote.attachmentIds.indexOf(attachment.id) >= 0) quote.changeIds.forEach(function(id) { ids.push(id); }); }); if (!ids.length) all(); else ids.forEach(function(id) { affected[id] = true; }); } });
  request.pricedItems.forEach(function(item) { if (affected[item.requestChangeId]) item.pricingConfirmed = false; }); request.contractConfirmed = false; request.customerScopeConfirmed = false;
}
function saveRequest_(body) {
  checkMutation_(body); shapeCheck_(body.request);
  return locked_(function() {
    const request = body.request; const row = requestRow_(request.id); const snapshot = row ? readSnapshot_(row) : null;
    if (sameMutation_(snapshot, body.mutationId)) return json_({ ok: true, request: snapshot.request });
    revisionCheck_(row, body.expectedRevision);
    if (!row) {
      if (request.status !== "draft" || request.estimatorName || request.attachments.length) problem_("VALIDATION", "New requests must begin as empty-attachment drafts.");
      request.submittedAt = null; request.informationQuestion = "";
    } else {
      const previous = snapshot.request;
      if (previous.status === "submitted" || previous.status === "ready" || previous.status === "completed") problem_("STATE", "Reopen or claim this request before editing it.");
      if (request.status !== previous.status || request.estimatorName !== previous.estimatorName) problem_("STATE", "Use the claim or status action to change review state.");
      request.submittedAt = previous.submittedAt; request.informationQuestion = previous.informationQuestion; request.legacyDraftId = previous.legacyDraftId;
      request.attachments = request.attachments.map(function(attachment) { return attachmentFile_(row, attachment).attachment; });
      if (intakeFingerprint_(previous) !== intakeFingerprint_(request)) {
        invalidateIntake_(previous, request);
      }
    }
    return commitRequest_(request, row, snapshot, body.mutationId);
  });
}
function claimRequest_(body) {
  checkMutation_(body);
  if (!String(body.estimatorName || "").trim()) problem_("VALIDATION", "Enter the estimator name.");
  return locked_(function() {
    const row = requestRow_(body.id); if (!row) problem_("NOT_FOUND", "Request not found.");
    const snapshot = readSnapshot_(row); if (sameMutation_(snapshot, body.mutationId)) return json_({ ok: true, request: snapshot.request });
    revisionCheck_(row, body.expectedRevision); const request = snapshot.request;
    if (request.estimatorName && request.estimatorName !== body.estimatorName.trim()) problem_("CLAIMED", "This request is already assigned to " + request.estimatorName + ".", request.revision);
    if (request.status !== "submitted") problem_("STATE", "Only a submitted request can be claimed.");
    request.estimatorName = body.estimatorName.trim(); request.status = "in_review";
    return commitRequest_(request, row, snapshot, body.mutationId);
  });
}
function transitionRequest_(body) {
  checkMutation_(body);
  return locked_(function() {
    const row = requestRow_(body.id); if (!row) problem_("NOT_FOUND", "Request not found.");
    const snapshot = readSnapshot_(row); if (sameMutation_(snapshot, body.mutationId)) return json_({ ok: true, request: snapshot.request });
    revisionCheck_(row, body.expectedRevision); const request = snapshot.request; const target = body.status; let errors = [];
    if (target === "submitted" && ["draft", "needs_information"].indexOf(request.status) >= 0) {
      errors = submissionErrors_(request); request.submittedAt = new Date().toISOString(); request.informationQuestion = "";
    } else if (target === "needs_information" && request.status === "in_review") {
      if (!String(body.question || "").trim()) errors.push("Describe the information the project manager must provide."); request.informationQuestion = String(body.question || "").trim();
    } else if (target === "ready" && request.status === "in_review") { errors = readyErrors_(request); }
    else problem_("STATE", "That status change is not permitted.");
    if (errors.length) problem_("VALIDATION", errors.join("\n"));
    request.status = target === "submitted" && request.estimatorName ? "in_review" : target;
    return commitRequest_(request, row, snapshot, body.mutationId);
  });
}
function completeRequest_(body) {
  if (!body.id || !body.mutationId) problem_("VALIDATION", "Request and mutation identifiers are required.");
  if (!Array.isArray(body.documents) || !body.documents.length) problem_("VALIDATION", "Attach at least one final document before completing.");
  checkMutation_(body);
  return locked_(function () {
    const row = requestRow_(body.id);
    if (!row) problem_("NOT_FOUND", "Request not found.");
    const snapshot = readSnapshot_(row);
    if (sameMutation_(snapshot, body.mutationId)) return json_({ ok: true, request: snapshot.request });
    revisionCheck_(row, body.expectedRevision);
    const request = snapshot.request;
    if (request.status !== "ready") problem_("STATE", "Only a ready request can be completed.");
    const folder = DriveApp.getFolderById(String(row.values[RC.FOLDER]));
    const documents = body.documents.map(function (doc, index) {
      const info = doc || {};
      const label = "Document " + (index + 1);
      if (typeof info.name !== "string" || !info.name.trim() || info.mimeType !== "application/pdf" || !Number.isInteger(info.size) || info.size <= 0 || info.size > 15 * 1024 * 1024 || typeof info.data !== "string" || info.data.length > 21 * 1024 * 1024) problem_("VALIDATION", label + " is incomplete or too large.");
      let bytes; try { bytes = Utilities.base64Decode(info.data); } catch (error) { problem_("UPLOAD_FAILED", label + " could not be decoded."); }
      if (bytes.length !== info.size) problem_("VALIDATION", label + " size does not match its content.");
      const b = bytes.map(function (value) { return value & 255; });
      if (!(b[0] === 37 && b[1] === 80 && b[2] === 68 && b[3] === 70 && b[4] === 45)) problem_("VALIDATION", label + " is not a valid PDF.");
      const attachmentId = Utilities.getUuid();
      const name = String(info.name).split(/[\\/]/).pop().slice(0, 200);
      const file = folder.createFile(Utilities.newBlob(bytes, "application/pdf", "attachment-" + attachmentId));
      const attachment = { id: attachmentId, kind: "document", name: name, mimeType: "application/pdf", size: bytes.length, driveFileId: file.getId() };
      file.setDescription(JSON.stringify({ requestId: body.id, mutationId: body.mutationId, attachment: attachment }));
      return attachment;
    });
    request.attachments = (request.attachments || []).concat(documents);
    request.status = "completed";
    return commitRequest_(request, row, snapshot, body.mutationId);
  });
}
function uploadAttachment_(body) {
  const info = body.file;
  if (!body.requestId || !body.attachmentId || !body.mutationId || !info || ["estimate", "quote", "photo", "document"].indexOf(info.kind) < 0) problem_("VALIDATION", "Attachment details are incomplete.");
  const allowed = info.kind === "photo" ? ["image/jpeg", "image/png", "image/webp"] : ["application/pdf"];
  if (allowed.indexOf(info.mimeType) < 0 || !Number.isInteger(info.size) || info.size <= 0 || info.size > 15 * 1024 * 1024 || typeof info.data !== "string" || info.data.length > 21 * 1024 * 1024) problem_("VALIDATION", "Choose a supported file smaller than 15 MB.");
  let bytes; try { bytes = Utilities.base64Decode(info.data); } catch (error) { problem_("UPLOAD_FAILED", "The file could not be decoded. Retry the upload."); }
  if (bytes.length !== info.size) problem_("VALIDATION", "The file size does not match its content.");
  const b = bytes.map(function(value) { return value & 255; });
  const signature = info.mimeType === "application/pdf" ? b[0] === 37 && b[1] === 80 && b[2] === 68 && b[3] === 70 && b[4] === 45 : info.mimeType === "image/jpeg" ? b[0] === 255 && b[1] === 216 && b[2] === 255 : info.mimeType === "image/png" ? b.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10" : b.slice(0, 4).join(",") === "82,73,70,70" && b.slice(8, 12).join(",") === "87,69,66,80";
  if (!signature) problem_("VALIDATION", "The file content does not match its selected type.");
  return locked_(function() {
    const row = requestRow_(body.requestId); if (!row) problem_("NOT_FOUND", "Save the request before uploading attachments.");
    const folder = DriveApp.getFolderById(String(row.values[RC.FOLDER])); const filename = "attachment-" + body.attachmentId;
    const existing = folder.getFilesByName(filename);
    if (existing.hasNext()) {
      const metadata = JSON.parse(existing.next().getDescription());
      if (metadata.mutationId !== body.mutationId) problem_("CONFLICT", "This attachment identifier is already in use.");
      return json_({ ok: true, attachment: metadata.attachment });
    }
    const request = readSnapshot_(row).request;
    if (request.status === "submitted" || request.status === "ready" || request.status === "completed") problem_("STATE", "Reopen the request before uploading attachments.");
    const name = String(info.name || "attachment").split(/[\\/]/).pop().slice(0, 200);
    const file = folder.createFile(Utilities.newBlob(bytes, info.mimeType, filename));
    const attachment = { id: String(body.attachmentId), kind: info.kind, name: name, mimeType: info.mimeType, size: bytes.length, driveFileId: file.getId() };
    file.setDescription(JSON.stringify({ requestId: body.requestId, mutationId: body.mutationId, attachment: attachment }));
    return json_({ ok: true, attachment: attachment });
  });
}
function fetchAttachment_(requestId, attachmentId) {
  const row = requestRow_(requestId); if (!row) problem_("NOT_FOUND", "Request not found.");
  const request = readSnapshot_(row).request; const attachment = request.attachments.filter(function(item) { return item.id === attachmentId; })[0];
  if (!attachment) problem_("NOT_FOUND", "Attachment is not linked to this request.");
  const owned = attachmentFile_(row, attachment);
  return json_({ ok: true, name: owned.attachment.name, mimeType: owned.attachment.mimeType, data: Utilities.base64Encode(owned.file.getBlob().getBytes()) });
}
function convertLegacyRequest_(body) {
  if (!body.id || !body.mutationId) problem_("VALIDATION", "Legacy draft and mutation identifiers are required.");
  return locked_(function() {
    const sheet = requestsSheet_(); const last = sheet.getLastRow(); const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, REQUEST_HEADERS.length).getValues();
    // Safely iterate backward so a broken/deleted request's snapshot will not abort migration search
    for (let i = rows.length - 1; i >= 0; i--) { 
      try {
        const snapshot = readSnapshot_({ values: rows[i] }); 
        if (sameMutation_(snapshot, body.mutationId)) return json_({ ok: true, request: snapshot.request }); 
      } catch (error) {
        // Skip over unreachable files safely
      }
    }
    const oldRow = findRow_(body.id); if (!oldRow) problem_("NOT_FOUND", "Legacy draft not found.");
    const old = JSON.parse(String(sheet_().getRange(oldRow, COLS.DATA + 1).getValue())); const id = Utilities.getUuid();
    const folder = folder_().createFolder("request-" + id); const attachments = []; let estimateId = null;
    if (old.source && old.source.driveFileId) {
      const attachmentId = Utilities.getUuid(); 
      try {
        const copy = DriveApp.getFileById(old.source.driveFileId).makeCopy("attachment-" + attachmentId, folder);
        const attachment = { id: attachmentId, kind: "estimate", name: old.source.name, mimeType: "application/pdf", size: copy.getBlob().getBytes().length, driveFileId: copy.getId() };
        copy.setDescription(JSON.stringify({ requestId: id, mutationId: body.mutationId, attachment: attachment })); attachments.push(attachment); estimateId = attachmentId;
      } catch (copyError) {
        // Suppress failure if legacy source doesn't exist anymore
      }
    }
    // Prevent unhandled TypeErrors from mappings when an unpopulated draft had no changes
    const changes = old.changes || [];
    const request = { schemaVersion: 2, id: id, revision: 0, createdAt: "", updatedAt: "", status: "draft", estimatorName: "", submittedAt: null, informationQuestion: "", job: old.job, requestedChanges: changes.map(function(item) { return { id: Utilities.getUuid(), room: item.room, action: item.action, description: item.description, reason: item.reason, measurements: "", materials: "", scheduleImpact: "", estimateItemIds: item.original ? [item.original.id] : [] }; }), quotes: [], attachments: attachments, estimate: old.estimate || [], estimateAttachmentId: estimateId, extractionWarnings: old.extractionWarnings || [], pricedItems: [], exclusions: {}, customerScope: old.scope || "", customerScopeEdited: Boolean(old.scopeEdited), customerScopeConfirmed: false, contractConfirmed: false, legacyDraftId: old.id };
    request.pricedItems = changes.map(function(item, index) { return Object.assign({}, item, { requestChangeId: request.requestedChanges[index].id, pricingConfirmed: false }); });
    return commitRequest_(request, null, null, body.mutationId, folder);
  });
}