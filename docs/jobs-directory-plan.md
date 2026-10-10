# Job Directory — brainstorm & plan

Goal: an admin imports a list of current jobs once; project managers pick a job
from a searchable dropdown and the request form autofills the job details.

Status: **Phase 1 implemented** (parser, Jobs sheet + endpoints, admin import
view, PM picker, tests). Phases 2–3 not started.

---

## 1. How the flow works today

1. **Home** (`App.tsx` view `home`) lists `RequestSummary` rows from
   `GET ?action=listRequests`. "New request" opens `PMRequestForm`.
2. **PMRequestForm** (`draft` / `needs_information`):
   - Intro copy.
   - **Job details**: 4 always-visible text fields — job number, customer,
     property address, project manager — plus a collapsible
     "Branch & insurance details" block (branch, branch contact, carrier,
     claim number).
   - "What needs to change?" cards (add/revise/remove + reason, measurements,
     materials, schedule impact).
   - Subcontractor quotes (always-visible section, one card per quote).
   - Supporting files (photos + one estimate PDF). Uploading an estimate PDF
     runs `pdfExtract` and back-fills **empty** `job` fields from the parsed
     estimate.
3. Submit → `transitionRequest("submitted")` → `SubmittedReview` (receipt +
   "Claim this request") → estimator workspace.

`JobDetails` has 17 fields; the PM hand-types the same job info on every
request for the same job, and each request on the same job repeats it.

## 2. Simplifications found while reviewing (independent of the jobs list)

- **Job details is the heaviest part of the PM form.** ~8 hand-typed fields
  per request, repeated across requests for one job.
- **Quotes section is always expanded** even though it is optional. Candidate:
  hide behind an "Add a subcontractor quote" reveal button.
- **Branch/insurance block** could be pre-filled entirely by the job directory
  (today only `branchName` has a default).
- **Legacy editor** (`LegacyWorkspace`) is still in the topbar. Once legacy
  drafts are converted, that nav item and the whole legacy stack
  (`Drafts` sheet, `list/open/save/delete/pdf/uploadPdf` endpoints) can be
  retired — big deletion, not just UI.
- **No per-job awareness**: nothing warns that 3 requests already exist for
  the same job, and nothing reuses the previous request's data.

## 3. Feature design: Job Directory

### 3.1 Data model (frontend, `src/types.ts`)

```ts
export interface JobEntry {
  id: string;
  jobNumber: string;      // full number incl. suffix, e.g. "F-26-0366-R"
  customer: string;
  address: string;        // "Job Address, Loss City, Loss State  Loss ZIP"
  projectManager: string; // ForePerson from the report
  estimator: string;      // Estimator from the report (display only)
  status: string;         // raw Dash status, e.g. "Work in Progress"
  customerPhone: string;  // display only, not copied into requests
  customerEmail: string;  // display only, not copied into requests
  active: boolean;        // derived from Status, see 3.6
  updatedAt: string;
}
```

- `ChangeRequest.job` stays exactly as it is. **Copy, don't link**: picking a
  job copies values into `request.job`. Old requests never mutate when the
  directory changes, and the schema stays valid.
- Optionally add `request.jobDirectoryId?: string` for traceability only
  (additive, keep `schemaVersion: 2`). Not required for v1 of the feature.

### 3.2 Backend (`apps-script/Code.gs`)

- `setup()` also creates a **Jobs** sheet (columns: id, jobNumber, customer,
  address, projectManager, estimator, status, customerPhone, customerEmail,
  active, updatedAt).
- `GET  ?action=listJobs` → `{ ok, jobs: JobEntry[] }` (active first).
- `POST {action:"importJobs", jobs: JobEntry[], mutationId}` → **full replace**
  of the Jobs sheet (last-write-wins; the directory is reference data, not a
  revisioned document — acceptable, unlike requests).
- No new auth: same "execute as me, access: Anyone" web app. The import UI is
  soft-admin (anyone with the link can import, same trust model as today's
  claiming). A passcode gate is possible later; not in v1.
- Delivery note: `gws` CLI is not installed on this machine, so the updated
  `Code.gs` must be pasted + redeployed by hand (see
  `docs/google-sheets-setup.md` step 4), and the setup doc must be updated.

### 3.3 Frontend

**New view — Admin jobs** (`src/components/AdminJobs.tsx`, view kind `jobs`):
- Topbar gets a "Jobs" button (visible to everyone, like everything else).
- Body: current job count + last-updated; a textarea ("paste CSV") or
  `input[type=file]` `.csv`; **preview table with column mapping**; Import
  button → `importJobs()` → success summary.
- Import format: the Dash **JobSummaryReport** export (see 3.6 for the exact
  column mapping). Preview the parsed rows + per-row warnings before Import;
  full-replace semantics with an explicit confirm ("Replaces the current N
  jobs").
- Client helpers in `src/services/storage.ts`: `listJobs()`, `importJobs()`.

**PM form — Job picker** (`PMRequestForm.tsx`, replaces the 4-field grid):
- `JobPicker` combobox: searchable dropdown of active jobs
  (label: `jobNumber · customer · address`).
- Show the **responsible PM prominently** (`PM: <ForePerson>`) since the
  change order owner must be clear, and offer a "My jobs" filter (remember
  the last PM name used on this device) so each PM sees their own jobs first.
- Picking a job autofills the four job fields only — `jobNumber, customer,
  address, projectManager` (the report has no branch/carrier/claim data, so
  those stay manual, as today); estimator-only fields (`originalContract`,
  `previousChanges`, `addedDays`, `orderNumber`, `date`, `insuranceRelated`)
  are never touched.
- Picking is authoritative for those four fields (it overwrites manual text —
  that's the point of the dropdown). A "Clear job link" action returns to
  manual entry without wiping values.
- "Can't find your job?" fallback expands the manual fields exactly as today.
- Estimate-upload autofill (`App.tsx` `runUpload`) keeps working: it only
  fills fields that are still empty, so it no-ops on directory-filled values.

### 3.4 Open decisions to confirm

1. **CSV vs paste vs Sheet import** — plan says CSV file or paste; both are
   cheap once the parser exists. Recommendation: paste + file input.
2. **Replace vs merge on import** — recommendation: full replace with
   confirmation (directory is "current jobs", admin maintains the master
   list elsewhere).
3. **Admin gating** — recommendation: none in v1 (consistent with no-auth
   backend). Optional later: a numeric passcode checked server-side.
4. **Active/closed** — the report has ~7 statuses; see 3.6 for the proposed
   active mapping. Confirm which statuses should count as "current jobs" vs
   hidden under a "show all" toggle.
5. **Job identity** — `Job Number` alone is unique per row (and per loss +
   work type). Multiple rows can share an address (`-R` / `-W` / `-P` / `-RM`
   / `-T` suffixes), which is intended — the PM picks the exact one.

### 3.6 Real import format — Dash "JobSummaryReport" CSV

The admin's export has 43 columns. Mapping to `JobEntry`:

| JobEntry field | CSV column | Notes |
|---|---|---|
| `jobNumber` | `Job Number` | keep the full value incl. suffix (`-R`, `-W`, `-P`, `-RM`, `-T`, `-M`, `-WAR`). Unique per row. |
| `customer` | `Customer` | as-is (often "Last First" order) |
| `address` | `Job Address` + `Loss City` + `Loss State` + `Loss ZIP` | assembled into one line, e.g. `530 Home Ave., Fort Wayne, IN 46807` |
| `projectManager` | `ForePerson` | **authoritative** — the PM responsible for this job. Keep verbatim; never fall back to `Supervisor`. |
| `estimator` | `Estimator` | display-only in the picker |
| `status` | `Status` | raw value kept for the badge |
| `customerPhone` | `Customer Main Phone` | display-only |
| `customerEmail` | `Customer Email` | display-only |
| `active` | derived from `Status` | see below |

Skipped entirely: `Notes` (huge HTML email dumps — the parser must never
store it), `Time In Status`, compliance counts, all `Date …` / amount /
budget / GP / invoice columns, `Bill To`, `Supervisor`.

Active mapping (proposal, confirm with admin): active =
`Work in Progress`, `Pre-Production`; inactive but searchable =
`Pending Sales`, `Accounts Receivable`, `Invoice Pending`,
`Waiting for Final Closure`, `Completed without Paperwork`. The picker shows
active jobs by default with a "show all" toggle.

No source in this report for: `branchName`, `branchContact`, `carrier`,
`claim` — those stay manual optional fields exactly as today.

Parser rules:

- RFC-4180 CSV parsing (quoted fields contain commas, newlines, and escaped
  quotes).
- Trim all values; empty string → empty. Keep `ForePerson` **verbatim**
  (`DETERMINED TO BE` is a real value in the export) but warn — the
  responsible PM must be identifiable for the change order.
- ZIP cleanup: keep the first 5 digits when the value is numeric junk
  (e.g. `458912151`, `467379173`).
- Warn (don't block) on: empty/unassigned `ForePerson` (`DETERMINED TO BE`),
  empty customer, missing ZIP, duplicate Job Number.
- Full replace on import; row count and a sample preview shown before
  confirming.

## 4. Test & verification plan

- Unit tests for the RFC-4180 parser + mapping against a scrubbed fixture of
  the real JobSummaryReport export (strip customer emails/phones/Notes before
  committing).
- Playwright mock (`/__api__/`) gains `listJobs` / `importJobs` routes in
  `tests/helpers.ts` + fixtures.
- New workflow spec: import jobs → new request → pick job → assert autofill →
  pick again after manual edit → assert overwrite → submit.
- Existing specs must keep passing (PM form job fields still exist under the
  fallback path).
- Verify: `npm run typecheck`, `npm test`, `npm run test:browser`,
  `npm run build`.

## 5. Suggested phasing

1. **Phase 1 (this feature)**: Jobs sheet + `listJobs`/`importJobs` +
   `AdminJobs` view + `JobPicker` autofill + tests + docs update.
2. **Phase 2 (debt from §2)**: collapse the optional sections (quotes behind
   a reveal), remove `branchAddress`/`branchPhone` manual fields if the
   directory covers them, per-job "3 existing requests" hint on the picker.
3. **Phase 3**: deprecate `LegacyWorkspace` + Drafts endpoints once legacy
   drafts are converted (confirm with the team first).
