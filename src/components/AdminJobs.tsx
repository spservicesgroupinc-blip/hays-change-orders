import { useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  ListChecks,
  Upload,
  X,
} from "lucide-react";
import type { JobEntry } from "../types";
import { parseJobReport, type JobImportResult } from "../services/jobImport";
import { importJobs } from "../services/storage";
import "./AdminJobs.css";

export interface AdminJobsProps {
  jobs: JobEntry[];
  onBack: () => void;
  onImported: (jobs: JobEntry[]) => void;
}

export default function AdminJobs({
  jobs,
  onBack,
  onImported,
}: AdminJobsProps) {
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<JobImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const activeCount = jobs.filter((job) => job.active).length;

  const readFile = async (file: File) => {
    setError("");
    setDone("");
    try {
      const text = await file.text();
      setRaw(text);
      setFileName(file.name);
      setPreview(parseJobReport(text));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The file could not be read.",
      );
    }
  };

  const runPreview = () => {
    setError("");
    setDone("");
    if (!raw.trim()) {
      setPreview(null);
      setError("Paste the job report or choose a CSV file first.");
      return;
    }
    setPreview(parseJobReport(raw));
  };

  const confirmImport = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const saved = await importJobs(preview.jobs);
      onImported(saved);
      setDone(
        `${saved.length} ${saved.length === 1 ? "job" : "jobs"} imported. Project managers can now pick them from the dropdown.`,
      );
      setPreview(null);
      setRaw("");
      setFileName("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The jobs could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell-request admin-jobs">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        Back to requests
      </button>
      <div className="admin-jobs-head">
        <div>
          <span className="pm-eyebrow">ADMIN / JOB DIRECTORY</span>
          <h1>Manage the job list</h1>
          <p>
            Import the current jobs from the Dash JobSummaryReport. Project
            managers pick a job from the dropdown and the request fills in
            automatically.
          </p>
        </div>
        <div className="admin-jobs-count">
          <ListChecks size={20} />
          <strong>{jobs.length}</strong>
          <span>
            {jobs.length === 1 ? "job loaded" : "jobs loaded"}
            {jobs.length ? ` · ${activeCount} active` : ""}
          </span>
        </div>
      </div>

      {error ? (
        <div className="storage-error" role="alert">
          <X size={18} />
          <span>{error}</span>
        </div>
      ) : null}
      {done ? (
        <div className="admin-jobs-done" role="status">
          <CheckCircle2 size={18} />
          <span>{done}</span>
        </div>
      ) : null}

      <section className="pm-section">
        <div className="pm-section-heading">
          <div>
            <h2>Import a job report</h2>
            <p>
              Choose the CSV export or paste its contents. Importing replaces
              the current list, so upload the latest full report.
            </p>
          </div>
        </div>
        <div className="admin-import-bar">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            aria-label="Job report CSV file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }}
          />
          <button
            type="button"
            className="button"
            onClick={() => fileInput.current?.click()}
          >
            <FileUp size={17} />
            Choose CSV file
          </button>
          <span className="pm-caption">
            {fileName ? `Loaded ${fileName}` : "No file selected"}
          </span>
        </div>
        <textarea
          className="admin-paste"
          aria-label="Paste job report CSV"
          placeholder="…or paste the JobSummaryReport contents here"
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value);
            setPreview(null);
            setDone("");
          }}
        />
        <div className="admin-actions">
          <button type="button" className="button" onClick={runPreview}>
            Preview jobs
          </button>
        </div>
      </section>

      {preview ? (
        <section className="pm-section">
          <div className="pm-section-heading">
            <div>
              <h2>
                {preview.total} {preview.total === 1 ? "job" : "jobs"} ready to
                import
              </h2>
              <p>
                Importing replaces the current list
                {jobs.length ? ` of ${jobs.length}` : ""}.
                {preview.skipped
                  ? ` ${preview.skipped} row${preview.skipped === 1 ? "" : "s"} skipped.`
                  : ""}
              </p>
            </div>
          </div>
          {preview.warnings.length ? (
            <details className="admin-warnings">
              <summary>
                {preview.warnings.length} warning
                {preview.warnings.length === 1 ? "" : "s"} — review before
                importing
              </summary>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="pm-caption">No problems found in this file.</p>
          )}
          <div className="admin-sample">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Property</th>
                  <th>Project manager</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.jobs.slice(0, 8).map((job) => (
                  <tr key={job.id}>
                    <td>{job.jobNumber}</td>
                    <td>{job.customer || "—"}</td>
                    <td>{job.address || "—"}</td>
                    <td>{job.projectManager || "—"}</td>
                    <td>{job.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.total > 8 ? (
              <p className="pm-caption">
                Showing the first 8 of {preview.total} jobs.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="button primary large"
            disabled={busy || !preview.total}
            onClick={() => void confirmImport()}
          >
            <Upload size={17} />
            {busy
              ? "Importing…"
              : `Import ${preview.total} ${preview.total === 1 ? "job" : "jobs"}`}
          </button>
        </section>
      ) : null}
    </div>
  );
}
