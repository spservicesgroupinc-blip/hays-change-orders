/**
 * Hays + Sons Change Orders — Google Sheets + Drive storage backend.
 *
 * Container-bound script: paste this whole file into the Apps Script editor
 * attached to a Google Sheet (Extensions → Apps Script), then run setup()
 * once (or use the "Change Orders" menu). setup() creates the Requests and
 * Jobs sheets and the Drive folder. Finally deploy as a web app (execute as
 * me, access: Anyone) and paste the Web app URL into .env.local.
 *
 * Endpoints:
 *   GET  ?action=bootstrap          → { ok, requests, jobs }
 *   GET  ?action=listRequests       → { ok, requests: [{summary…}] }
 *   GET  ?action=openRequest&id=…   → { ok, request }
 *   GET  ?action=listJobs           → { ok, jobs }
 *   GET  ?action=fetchAttachment…   → { ok, name, mimeType, data(base64) }
 *   POST {action:"saveRequest"}      → { ok, request }
 *   POST {action:"claimRequest"}     → { ok, request }
 *   POST {action:"transitionRequest"} → { ok, request }
 *   POST {action:"uploadAttachment"}  → { ok, attachment }
 *   POST {action:"importJobs"}        → { ok, jobs }  (replaces the Jobs sheet)
 */

const DRIVE_FOLDER_NAME = "hays-change-orders";

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function fail_(message, code, currentRevision) {
  return json_({ ok: false, error: message, code: code || "SERVICE_ERROR", currentRevision: currentRevision });
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
  const folder = folder_();
  requestsSheet_();
  jobsSheet_();
  const summary = [
    "Setup complete.",
    "Requests sheet: Requests",
    "Jobs sheet: Jobs",
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

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === "bootstrap") return guarded_(function () { return bootstrap_(); });
  if (p.action === "listRequests") return guarded_(function () { return listRequests_(); });
  if (p.action === "openRequest") return guarded_(function () { return openRequest_(p.id); });
  if (p.action === "listJobs") return guarded_(function () { return listJobs_(); });
  if (p.action === "fetchAttachment") return guarded_(function () { return fetchAttachment_(p.requestId, p.attachmentId); });
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
  if (body.action === "importJobs") return guarded_(function () { return importJobs_(body); });
  return fail_("Unknown action.");
}

const REQUEST_HEADERS = ["id", "revision", "createdAt", "updatedAt", "status", "estimatorName", "customer", "jobNumber", "projectManager", "orderNumber", "address", "changesCount", "attachmentsCount", "dataFileId", "previousDataFileId", "folderId"];
// contractAmount is appended last on purpose: a Jobs sheet deployed before the
// column existed keeps every existing column aligned. jobsSheet_() backfills the
// missing header cell instead of inserting or moving a column.
const JOB_HEADERS = ["id", "jobNumber", "customer", "address", "projectManager", "estimator", "status", "customerPhone", "customerEmail", "active", "updatedAt", "contractAmount"];
// Script property recording the JOB_HEADERS.length that was last verified (or
// healed) against the Jobs sheet. It gates the one-time header check, so
// listJobs / bootstrap read only the job rows instead of the header row on every
// call. A future column addition changes the value and re-opens the check.
const JOB_HEADERS_KEY = "JOBS_HEADERS_VERSION";
const JC = { ID: 0, JOB: 1, CUSTOMER: 2, ADDRESS: 3, PM: 4, ESTIMATOR: 5, STATUS: 6, PHONE: 7, EMAIL: 8, ACTIVE: 9, UPDATED: 10, CONTRACT: 11 };
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
  const sheet = ss.getSheetByName("Jobs");
  if (!sheet) { const created = ss.insertSheet("Jobs"); created.appendRow(JOB_HEADERS); markJobHeaders_(); return created; }
  if (jobHeadersVerified_()) return sheet;
  healJobHeaders_(sheet);
  return sheet;
}
function jobHeadersVerified_() {
  // One-time work per deployment: once JOB_HEADERS_KEY holds the current header
  // count, every later listJobs / bootstrap call skips reading the header row.
  // If the property read fails for any reason, fall back to checking the header.
  try { return PropertiesService.getScriptProperties().getProperty(JOB_HEADERS_KEY) === String(JOB_HEADERS.length); }
  catch (error) { return false; }
}
function markJobHeaders_() {
  // Called only after the header row is known good (just created, healed, or
  // already complete). A quota or lock failure here costs one repeated header
  // check on the next call; the heal itself has already happened and listing
  // jobs must never fail because the property could not be written.
  try { PropertiesService.getScriptProperties().setProperty(JOB_HEADERS_KEY, String(JOB_HEADERS.length)); }
  catch (error) {
    // Fall back to re-checking the header on the next call.
  }
}
function healJobHeaders_(sheet) {
  // Self-healing migration for a Jobs sheet that predates contractAmount (or a
  // blank Jobs tab): fill in only the empty header cells with their canonical
  // names, so existing columns keep their position and no header or job row is
  // ever cleared, renamed, reordered, or rewritten. Idempotent: once every
  // header cell is filled this writes nothing. Gated by jobHeadersVerified_(),
  // so it runs at most once per deployment; it is never reached for a sheet that
  // was just created (that path returns above).
  const header = sheet.getRange(1, 1, 1, JOB_HEADERS.length).getValues()[0];
  let stale = false;
  const healed = JOB_HEADERS.map(function (name, index) { const current = String(header[index] || ""); if (!current) stale = true; return current || name; });
  if (stale) sheet.getRange(1, 1, 1, healed.length).setValues([healed]);
  markJobHeaders_();
}
function jobRow_(v) {
  return { id: String(v[0]), jobNumber: String(v[1] || ""), customer: String(v[2] || ""), address: String(v[3] || ""), projectManager: String(v[4] || ""), estimator: String(v[5] || ""), status: String(v[6] || ""), customerPhone: String(v[7] || ""), customerEmail: String(v[8] || ""), active: v[9] === true || String(v[9]).toLowerCase() === "true", updatedAt: String(v[10] || ""), contractAmount: String(v[JC.CONTRACT] || "") };
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
  // The admin uploads the JobSummaryReport CSV; the client parses it into
  // JobEntry rows and posts the whole directory. An import replaces the sheet,
  // so the client must always send the latest full report.
  if (!body || !Array.isArray(body.jobs)) problem_("VALIDATION", "A jobs array is required.");
  if (body.jobs.length > 5000) problem_("VALIDATION", "Too many jobs to import at once.");
  return locked_(function () {
    const sheet = jobsSheet_();
    const now = new Date().toISOString();
    const values = body.jobs.map(function (job) {
      return [String(job.id || ""), String(job.jobNumber || ""), String(job.customer || ""), String(job.address || ""), String(job.projectManager || ""), String(job.estimator || ""), String(job.status || ""), String(job.customerPhone || ""), String(job.customerEmail || ""), Boolean(job.active), String(job.updatedAt || now), String(job.contractAmount || "")];
    });
    const last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, JOB_HEADERS.length).clearContent();
    if (values.length) sheet.getRange(2, 1, values.length, JOB_HEADERS.length).setValues(values);
    SpreadsheetApp.flush();
    return json_({ ok: true, jobs: body.jobs });
  });
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
  // One round-trip loads everything the dashboard and quick request need,
  // instead of two separate Apps Script executions (each with a cold-start
  // delay).
  return json_({ ok: true, requests: requestRows_(), jobs: jobRows_() });
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
function submissionErrors_(request) {
  // A request may be submitted with any data. Estimators review the scope and
  // ask for information instead, so submission blocks on nothing — no required
  // fields, no minimum work areas, and no quote-cost formatting rules.
  return [];
}
function shapeCheck_(request) {
  if (!request || request.schemaVersion !== 2 || !request.id || typeof request.id !== "string" || request.id.length > 100 || !request.job) problem_("VALIDATION", "A valid version-2 request is required.");
  if (request.requestType !== undefined && ["change_order", "insurance_supplement"].indexOf(request.requestType) < 0) problem_("VALIDATION", "Choose a valid request type.");
  if (request.customerCredits !== undefined && typeof request.customerCredits !== "boolean") problem_("VALIDATION", "Customer credits must be a checkbox answer.");
  ["lineNumbers", "knownChangeAmount"].forEach(function(key) { if (request[key] !== undefined && typeof request[key] !== "string") problem_("VALIDATION", key + " must be text."); });
  if (request.lineNumbers && request.lineNumbers.trim() && !/^[+-][1-9]\d*(?:[\s,]+[+-][1-9]\d*)*$/.test(request.lineNumbers.trim())) problem_("VALIDATION", "Enter signed line numbers, such as +12, -34.");
  if (request.knownChangeAmount && request.knownChangeAmount.trim() && !/^[+-]?\d+(?:\.\d{1,2})?$/.test(request.knownChangeAmount.trim())) problem_("VALIDATION", "Enter a valid known change dollar amount.");
  if (request.finalChangeOrder !== undefined) {
    const final = request.finalChangeOrder;
    if (!final || typeof final !== "object" || typeof final.scope !== "string" || typeof final.amount !== "string") problem_("VALIDATION", "Final scope and amount must be text.");
    if (final.amount.trim() && !/^[+-]?\d+(?:\.\d{1,2})?$/.test(final.amount.trim())) problem_("VALIDATION", "Enter a valid final change dollar amount.");
  }
  ["requestedChanges", "attachments"].forEach(function(key) { if (!Array.isArray(request[key])) problem_("VALIDATION", key + " must be a list."); });
  ["estimatorName", "informationQuestion"].forEach(function(key) { if (typeof request[key] !== "string") problem_("VALIDATION", key + " must be text."); });
  const jobKeys = ["customer", "address", "jobNumber", "projectManager", "branchName", "branchAddress", "branchPhone", "branchContact", "carrier", "claim", "orderNumber", "date", "originalContract", "previousChanges", "addedDays"];
  jobKeys.forEach(function(key) { if (typeof request.job[key] !== "string") problem_("VALIDATION", "Job " + key + " must be text."); });
  ["customerPhone", "customerEmail"].forEach(function(key) {
    if (request.job[key] !== undefined && typeof request.job[key] !== "string") problem_("VALIDATION", "Job " + key + " must be text.");
  });
  ["originalContract", "previousChanges"].forEach(function(key) {
    const value = request.job[key].trim();
    if (value && !/^-?\d+(?:\.\d{1,2})?$/.test(value)) problem_("VALIDATION", "Enter " + key + " as a dollar amount with at most two decimal places.");
  });
  const unique = function(rows) { const seen = {}; rows.forEach(function(row) { if (!row || !row.id || typeof row.id !== "string" || seen[row.id]) problem_("VALIDATION", "Item identifiers must be unique."); seen[row.id] = true; }); };
  unique(request.requestedChanges); unique(request.attachments);
  request.requestedChanges.forEach(function(change) {
    ["room", "description", "reason", "measurements", "materials", "scheduleImpact"].forEach(function(key) { if (typeof change[key] !== "string") problem_("VALIDATION", "Requested change " + key + " must be text."); });
    if (["add", "revise", "remove"].indexOf(change.action) < 0) problem_("VALIDATION", "Invalid requested change.");
  });
}
function attachmentFile_(row, attachment) {
  let file, metadata;
  try { file = DriveApp.getFileById(attachment.driveFileId); metadata = JSON.parse(file.getDescription()); } catch (error) { problem_("VALIDATION", "An attachment is unavailable. Upload it again or remove it."); }
  const parents = file.getParents(); let belongs = false;
  while (parents.hasNext()) if (parents.next().getId() === String(row.values[RC.FOLDER])) belongs = true;
  if (!belongs || metadata.requestId !== String(row.values[RC.ID]) || metadata.attachment.id !== attachment.id || metadata.attachment.driveFileId !== attachment.driveFileId) problem_("VALIDATION", "Attachment does not belong to this request.");
  return { file: file, attachment: metadata.attachment };
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
      if (["draft", "submitted", "in_review", "needs_information"].indexOf(previous.status) < 0) problem_("STATE", "Completed requests cannot be edited.");
      if (request.status !== previous.status || request.estimatorName !== previous.estimatorName) problem_("STATE", "Use the claim or status action to change review state.");
      request.submittedAt = previous.submittedAt; request.informationQuestion = previous.informationQuestion;
      request.attachments = request.attachments.map(function(attachment) { return attachmentFile_(row, attachment).attachment; });
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
    } else if (target === "completed" && request.status === "in_review") {
      // Completing is a simple status change: the estimator finishes the change
      // order outside the app and records it here for the queue log.
    } else problem_("STATE", "That status change is not permitted.");
    if (errors.length) problem_("VALIDATION", errors.join("\n"));
    request.status = target === "submitted" && request.estimatorName ? "in_review" : target;
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
    if (["draft", "submitted", "in_review", "needs_information"].indexOf(request.status) < 0) problem_("STATE", "Completed requests cannot receive attachments.");
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
