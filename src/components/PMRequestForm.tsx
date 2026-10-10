import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  FileText,
  Image,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  AttachmentKind,
  ChangeRequest,
  EstimateItem,
  JobEntry,
  PendingUpload,
  RequestAttachment,
  RequestedChange,
  SubcontractorQuote,
} from "../types";
import { createQuote, createRequestedChange } from "../services/requests";
import { money, cents, validDecimal } from "../services/pricing";
import "./PMRequestForm.css";
import "./JobPicker.css";

export interface PMRequestFormProps {
  request: ChangeRequest;
  jobs?: JobEntry[];
  onChange: (next: ChangeRequest) => void;
  pendingUploads: PendingUpload[];
  onUpload: (
    files: File[],
    kind: AttachmentKind,
    quoteId?: string,
  ) => Promise<void>;
  onRetryUpload: (id: string) => void;
  onRemovePendingUpload: (id: string) => void;
  onRemoveAttachment: (id: string) => void;
  onPreviewAttachment: (attachment: RequestAttachment) => void;
  onSubmit: () => void;
  busy: boolean;
  saveStatus: "saved" | "saving" | "error";
}

const ACTIONS: { value: RequestedChange["action"]; label: string }[] = [
  { value: "add", label: "Add work" },
  { value: "revise", label: "Change work" },
  { value: "remove", label: "Remove work" },
];
const STATUS_LABELS: Record<ChangeRequest["status"], string> = {
  draft: "Draft",
  submitted: "Submitted to estimating",
  in_review: "Estimator reviewing",
  needs_information: "More information needed",
  ready: "Change order ready",
  completed: "Completed",
};

function TextField({
  label,
  value,
  onChange,
  name,
  required = false,
  multiline = false,
  placeholder,
  help,
  error,
  inputMode,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  name: string;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  help?: string;
  error?: string;
  inputMode?: "decimal";
  disabled?: boolean;
}) {
  const id = useId();
  const props = {
    id,
    name,
    value,
    placeholder,
    required,
    disabled,
    "aria-label": label,
    "aria-required": required,
    "aria-invalid": Boolean(error),
    "aria-describedby":
      [help ? `${id}-help` : "", error ? `${id}-error` : ""]
        .filter(Boolean)
        .join(" ") || undefined,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
  };
  return (
    <div className="pm-field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {multiline ? (
        <textarea {...props} rows={3} />
      ) : (
        <input {...props} type="text" inputMode={inputMode} />
      )}
      {help ? <small id={`${id}-help`}>{help}</small> : null}
      {error ? (
        <small id={`${id}-error`} className="pm-field-error">
          {error}
        </small>
      ) : null}
    </div>
  );
}

function UploadButton({
  label,
  accept,
  multiple = true,
  disabled,
  onFiles,
  icon = "file",
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
  icon?: "file" | "photo";
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        aria-label={label}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <button
        type="button"
        className="button pm-upload-button"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {icon === "photo" ? <Image size={17} /> : <Upload size={17} />}
        {label}
      </button>
    </>
  );
}

function FileList({
  attachments,
  editable,
  onPreview,
  onRemove,
}: {
  attachments: RequestAttachment[];
  editable: boolean;
  onPreview: PMRequestFormProps["onPreviewAttachment"];
  onRemove: PMRequestFormProps["onRemoveAttachment"];
}) {
  if (!attachments.length) return null;
  return (
    <ul className="pm-files">
      {attachments.map((file) => (
        <li key={file.id}>
          <button
            className="pm-file-open"
            type="button"
            onClick={() => onPreview(file)}
            aria-label={`Open ${file.name}`}
          >
            {file.kind === "photo" ? (
              <Image size={19} />
            ) : (
              <FileText size={19} />
            )}
            <span>
              <strong>{file.name}</strong>
              <small>
                {file.kind === "quote"
                  ? "Subcontractor quote"
                  : file.kind === "estimate"
                    ? "Reference estimate"
                    : "Photo"}{" "}
                ·{" "}
                {file.size >= 1024 * 1024
                  ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                  : `${Math.max(1, Math.round(file.size / 1024))} KB`}
              </small>
            </span>
          </button>
          {editable ? (
            <button
              type="button"
              className="pm-icon-button"
              onClick={() => onRemove(file.id)}
              aria-label={`Remove ${file.name}`}
            >
              <X size={18} />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function EstimateLinks({
  estimate,
  selectedIds,
  onChange,
  index,
  disabled,
}: {
  estimate: EstimateItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  index: number;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(30);
  const deferredSearch = useDeferredValue(search);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    return estimate.filter((item) =>
      `${item.room} ${item.lineNumber} ${item.description}`
        .toLowerCase()
        .includes(query),
    );
  }, [deferredSearch, estimate]);
  const selectedItems = useMemo(
    () => estimate.filter((item) => selected.has(item.id)),
    [estimate, selected],
  );
  const toggle = (id: string) =>
    onChange(
      selected.has(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id],
    );
  return (
    <details className="pm-estimate-links">
      <summary>
        <FileText size={16} />
        Link estimate items{" "}
        <span>
          {selectedIds.length ? `${selectedIds.length} linked` : "Optional"}
        </span>
      </summary>
      <p>
        Give the estimator a reference. Select any items that relate to this
        change.
      </p>
      {selectedItems.length ? (
        <div
          className="pm-linked-items"
          aria-label={`Linked items for change ${index + 1}`}
        >
          {selectedItems.map((item) => (
            <span key={item.id}>
              #{item.lineNumber} · {item.room}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-label={`Unlink line ${item.lineNumber} from change ${index + 1}`}
                >
                  <X size={14} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      <label className="pm-search">
        <Search size={16} />
        <input
          type="search"
          aria-label={`Search estimate for change ${index + 1}`}
          placeholder="Search room, line number, or description"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setLimit(30);
          }}
        />
      </label>
      <div className="pm-estimate-results">
        {filtered.slice(0, limit).map((item) => (
          <label className="pm-estimate-option" key={item.id}>
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              disabled={disabled}
              onChange={() => toggle(item.id)}
            />
            <span>
              <strong>
                #{item.lineNumber || "—"} · {item.room || "Work area"}
              </strong>
              {item.description}
              <small>
                Source page {item.page || "—"}
                {item.quantity && item.unit
                  ? ` · ${item.quantity} ${item.unit}`
                  : ""}
              </small>
            </span>
          </label>
        ))}
        {!filtered.length ? (
          <p className="pm-empty">
            No matching items. You can still describe the change above.
          </p>
        ) : null}
      </div>
      {filtered.length > limit ? (
        <button
          className="button"
          type="button"
          onClick={() => setLimit((current) => current + 30)}
        >
          Show more items ({filtered.length - limit} remaining)
        </button>
      ) : null}
    </details>
  );
}

function ChangeCard({
  item,
  index,
  estimate,
  onChange,
  onRemove,
  disabled,
}: {
  item: RequestedChange;
  index: number;
  estimate: EstimateItem[];
  onChange: (next: RequestedChange) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const field = (key: keyof RequestedChange, value: string) =>
    onChange({ ...item, [key]: value });
  const prefix = `change-${item.id}`;
  return (
    <section className="pm-change-card" aria-labelledby={`${prefix}-title`}>
      <div className="pm-card-heading">
        <div>
          <span className="pm-card-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 id={`${prefix}-title`}>
            {item.room.trim() || `Work area ${index + 1}`}
          </h3>
        </div>
        <button
          type="button"
          className="pm-icon-button"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Remove change ${index + 1}`}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <div className="pm-grid pm-change-top">
        <TextField
          name={`${prefix}-room`}
          label="Room / work area"
          value={item.room}
          onChange={(value) => field("room", value)}
          placeholder="e.g. Kitchen, roof, exterior"
          disabled={disabled}
        />
        <fieldset className="pm-action-field">
          <legend>Type of change</legend>
          <div className="pm-actions">
            {ACTIONS.map((action) => (
              <label key={action.value}>
                <input
                  type="radio"
                  name={`${prefix}-action`}
                  value={action.value}
                  checked={item.action === action.value}
                  disabled={disabled}
                  onChange={() => field("action", action.value)}
                />
                <span>{action.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <TextField
        name={`${prefix}-description`}
        label="What needs to change?"
        value={item.description}
        onChange={(value) => field("description", value)}
        multiline
        placeholder="Describe the work in your own words. e.g. Add insulation to the exposed exterior kitchen wall before drywall."
        disabled={disabled}
      />
      <TextField
        name={`${prefix}-reason`}
        label="Why is this change needed?"
        value={item.reason}
        onChange={(value) => field("reason", value)}
        multiline
        placeholder="e.g. The existing insulation was missing when the wall was opened."
        disabled={disabled}
      />
      <details className="pm-optional-details" open={undefined}>
        <summary>
          <Plus size={16} />
          Measurements, materials & schedule <span>Optional</span>
          <ChevronDown size={16} />
        </summary>
        <div className="pm-optional-body">
          <TextField
            name={`${prefix}-measurements`}
            label="Measurements / quantity notes"
            value={item.measurements}
            onChange={(value) => field("measurements", value)}
            multiline
            placeholder="e.g. Wall is 12 ft wide × 8 ft high; two window openings"
            disabled={disabled}
          />
          <TextField
            name={`${prefix}-materials`}
            label="Materials / finish requirements"
            value={item.materials}
            onChange={(value) => field("materials", value)}
            multiline
            placeholder="e.g. R-13 insulation; match existing drywall and finish"
            disabled={disabled}
          />
          <TextField
            name={`${prefix}-schedule`}
            label="Schedule impact"
            value={item.scheduleImpact}
            onChange={(value) => field("scheduleImpact", value)}
            placeholder="e.g. About one extra day, or not known yet"
            disabled={disabled}
          />
        </div>
      </details>
      {estimate.length ? (
        <EstimateLinks
          estimate={estimate}
          selectedIds={item.estimateItemIds}
          onChange={(estimateItemIds) => onChange({ ...item, estimateItemIds })}
          index={index}
          disabled={disabled}
        />
      ) : null}
    </section>
  );
}

function QuoteCard({
  quote,
  index,
  changes,
  attachments,
  onChange,
  onRemove,
  onUpload,
  onPreview,
  onRemoveAttachment,
  disabled,
}: {
  quote: SubcontractorQuote;
  index: number;
  changes: RequestedChange[];
  attachments: RequestAttachment[];
  onChange: (next: SubcontractorQuote) => void;
  onRemove: () => void;
  onUpload: (files: File[]) => void;
  onPreview: PMRequestFormProps["onPreviewAttachment"];
  onRemoveAttachment: PMRequestFormProps["onRemoveAttachment"];
  disabled: boolean;
}) {
  const prefix = `quote-${quote.id}`;
  const field = (key: keyof SubcontractorQuote, value: string) =>
    onChange({ ...quote, [key]: value });
  return (
    <section className="pm-quote-card" aria-labelledby={`${prefix}-title`}>
      <div className="pm-card-heading">
        <h3 id={`${prefix}-title`}>
          {quote.subcontractor.trim() || `Quote ${index + 1}`}
        </h3>
        <button
          type="button"
          className="pm-icon-button"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Remove quote ${index + 1}`}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <div className="pm-grid">
        <TextField
          name={`${prefix}-subcontractor`}
          label="Subcontractor / company"
          value={quote.subcontractor}
          onChange={(value) => field("subcontractor", value)}
          placeholder="Company name"
          disabled={disabled}
        />
        <TextField
          name={`${prefix}-trade`}
          label="Trade"
          value={quote.trade}
          onChange={(value) => field("trade", value)}
          placeholder="e.g. Electrical, drywall, flooring"
          disabled={disabled}
        />
        <TextField
          name={`${prefix}-cost`}
          label="Quoted subcontractor cost ($)"
          value={quote.cost}
          onChange={(value) => field("cost", value)}
          inputMode="decimal"
          placeholder="Leave blank if not known"
          help="The estimator reviews this cost before setting the customer price."
          disabled={disabled}
        />
      </div>
      <fieldset className="pm-quote-links">
        <legend>Applies to these changes</legend>
        {changes.length ? (
          <div>
            {changes.map((change, changeIndex) => (
              <label key={change.id}>
                <input
                  type="checkbox"
                  checked={quote.changeIds.includes(change.id)}
                  disabled={disabled}
                  onChange={() =>
                    onChange({
                      ...quote,
                      changeIds: quote.changeIds.includes(change.id)
                        ? quote.changeIds.filter((id) => id !== change.id)
                        : [...quote.changeIds, change.id],
                    })
                  }
                />
                <span>
                  {changeIndex + 1}.{" "}
                  {change.room.trim() || `Work area ${changeIndex + 1}`}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p>Add a work area above to link this quote.</p>
        )}
      </fieldset>
      <TextField
        name={`${prefix}-notes`}
        label="Quote notes"
        value={quote.notes}
        onChange={(value) => field("notes", value)}
        multiline
        placeholder="What is included or excluded? Any allowances or conditions?"
        disabled={disabled}
      />
      <FileList
        attachments={attachments}
        editable={!disabled}
        onPreview={onPreview}
        onRemove={onRemoveAttachment}
      />
      <UploadButton
        label={`Attach quote PDF${index ? ` ${index + 1}` : ""}`}
        accept="application/pdf,.pdf"
        disabled={disabled}
        onFiles={onUpload}
      />
    </section>
  );
}

function JobPicker({
  jobs,
  onPick,
}: {
  jobs: JobEntry[];
  onPick: (job: JobEntry) => void;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const query = deferredSearch.trim().toLowerCase();
  // Only search results are shown — never the full customer list. The query
  // matches the job number, customer, address, or responsible PM.
  const matches = useMemo(() => {
    if (!query) return [];
    return jobs
      .filter((job) =>
        `${job.jobNumber} ${job.customer} ${job.address} ${job.projectManager}`
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 8);
  }, [jobs, query]);
  if (!jobs.length) return null;
  return (
    <div className="pm-job-picker">
      <label className="pm-job-search">
        <span>Find your job</span>
        <span className="pm-job-search-box">
          <Search size={16} />
          <input
            aria-label="Find your job"
            placeholder="Job number, customer, address, or PM…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              className="pm-job-clear"
              aria-label="Clear job search"
              onClick={() => setSearch("")}
            >
              <X size={16} />
            </button>
          ) : null}
        </span>
      </label>
      {query ? (
        <ul className="pm-job-results">
          {matches.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                aria-label={`Use job ${job.jobNumber}`}
                onClick={() => {
                  onPick(job);
                  setSearch("");
                }}
              >
                <strong>{job.jobNumber}</strong>
                <span>
                  {job.customer || "No customer"} · PM:{" "}
                  {job.projectManager || "Unassigned"}
                </span>
                <small>
                  {job.address || "No address"}
                  {job.status ? ` · ${job.status}` : ""}
                </small>
              </button>
            </li>
          ))}
          {!matches.length ? (
            <li className="pm-job-empty">
              No job matches “{search.trim()}”. Enter the details below instead.
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="pm-caption pm-job-hint">
          Start typing to find your job. Pick one and the details below fill in.
        </p>
      )}
    </div>
  );
}

export function IntakeReceipt({
  request,
  onPreview,
}: {
  request: ChangeRequest;
  onPreview: PMRequestFormProps["onPreviewAttachment"];
}) {
  const estimateById = useMemo(
    () => new Map(request.estimate.map((item) => [item.id, item])),
    [request.estimate],
  );
  return (
    <div className="pm-request pm-receipt">
      <div className="pm-receipt-banner">
        <CheckCircle2 size={26} />
        <div>
          <h2>{STATUS_LABELS[request.status]}</h2>
          <p>
            {request.estimatorName
              ? `${request.estimatorName} is handling this request.`
              : "Your request is available to the estimating team."}
          </p>
        </div>
      </div>
      <section className="pm-section">
        <div className="pm-section-heading">
          <div>
            <h2>Project details</h2>
            <p>
              Request from {request.job.projectManager || "the project manager"}
            </p>
          </div>
          {request.submittedAt ? (
            <span className="pm-caption">
              Submitted {new Date(request.submittedAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
        <dl className="pm-receipt-job">
          <div>
            <dt>Job number</dt>
            <dd>{request.job.jobNumber || "—"}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{request.job.customer || "—"}</dd>
          </div>
          <div>
            <dt>Property address</dt>
            <dd>{request.job.address || "—"}</dd>
          </div>
          <div>
            <dt>Project manager</dt>
            <dd>{request.job.projectManager || "—"}</dd>
          </div>
        </dl>
      </section>
      <section className="pm-section">
        <div className="pm-section-heading">
          <div>
            <h2>Requested changes</h2>
            <p>
              {request.requestedChanges.length} work{" "}
              {request.requestedChanges.length === 1 ? "area" : "areas"}
            </p>
          </div>
        </div>
        <div className="pm-card-list">
          {request.requestedChanges.map((change, index) => (
            <article className="pm-change-card" key={change.id}>
              <div className="pm-card-heading">
                <div>
                  <span className="pm-card-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3>{change.room || "Work area"}</h3>
                </div>
                <span className="pm-type-badge">
                  {
                    ACTIONS.find((action) => action.value === change.action)
                      ?.label
                  }
                </span>
              </div>
              <div className="pm-receipt-copy">
                <h4>Requested work</h4>
                <p>{change.description}</p>
                <h4>Reason</h4>
                <p>{change.reason}</p>
                {(
                  [
                    ["Measurements", change.measurements],
                    ["Materials / finishes", change.materials],
                    ["Schedule impact", change.scheduleImpact],
                  ] as const
                ).map(([label, value]) =>
                  value.trim() ? (
                    <div key={label}>
                      <h4>{label}</h4>
                      <p>{value}</p>
                    </div>
                  ) : null,
                )}
                {change.estimateItemIds.length ? (
                  <div>
                    <h4>Estimate references</h4>
                    <p>
                      {change.estimateItemIds
                        .map((id) => estimateById.get(id))
                        .filter((item): item is EstimateItem => Boolean(item))
                        .map(
                          (item) =>
                            `#${item.lineNumber} · ${item.room} · p. ${item.page}`,
                        )
                        .join("; ") || "Linked estimate items"}
                    </p>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
      {request.quotes.length ? (
        <section className="pm-section">
          <div className="pm-section-heading">
            <div>
              <h2>Subcontractor quotes</h2>
              <p>Costs supplied for estimator review.</p>
            </div>
          </div>
          <div className="pm-card-list">
            {request.quotes.map((quote, index) => (
              <article className="pm-quote-card" key={quote.id}>
                <div className="pm-card-heading">
                  <h3>{quote.subcontractor || `Quote ${index + 1}`}</h3>
                  {quote.cost && validDecimal(quote.cost) ? (
                    <span className="pm-quoted-cost">
                      {money(cents(quote.cost))}
                      <small>quoted cost</small>
                    </span>
                  ) : null}
                </div>
                <div className="pm-receipt-copy">
                  {quote.trade ? <p>{quote.trade}</p> : null}
                  {quote.changeIds.length ? (
                    <p>
                      Applies to:{" "}
                      {quote.changeIds
                        .map(
                          (id) =>
                            request.requestedChanges.find(
                              (change) => change.id === id,
                            )?.room,
                        )
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                  {quote.notes ? <p>{quote.notes}</p> : null}
                </div>
                <FileList
                  attachments={request.attachments.filter((file) =>
                    quote.attachmentIds.includes(file.id),
                  )}
                  editable={false}
                  onPreview={onPreview}
                  onRemove={() => {}}
                />
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {request.attachments.length ? (
        <section className="pm-section">
          <div className="pm-section-heading">
            <div>
              <h2>Supporting files</h2>
              <p>Open a file to preview or download it.</p>
            </div>
          </div>
          <FileList
            attachments={request.attachments}
            editable={false}
            onPreview={onPreview}
            onRemove={() => {}}
          />
        </section>
      ) : null}
    </div>
  );
}

export default function PMRequestForm({
  request,
  jobs = [],
  onChange,
  pendingUploads,
  onUpload,
  onRetryUpload,
  onRemovePendingUpload,
  onRemoveAttachment,
  onPreviewAttachment,
  onSubmit,
  busy,
  saveStatus,
}: PMRequestFormProps) {
  const [uploadError, setUploadError] = useState("");
  const editable =
    request.status === "draft" || request.status === "needs_information";
  const change = (next: ChangeRequest) => onChange(next);
  const updateChange = (next: RequestedChange) =>
    change({
      ...request,
      requestedChanges: request.requestedChanges.map((item) =>
        item.id === next.id ? next : item,
      ),
    });
  const updateQuote = (next: SubcontractorQuote) =>
    change({
      ...request,
      quotes: request.quotes.map((quote) =>
        quote.id === next.id ? next : quote,
      ),
    });
  const upload = (files: File[], kind: AttachmentKind, quoteId?: string) => {
    setUploadError("");
    void onUpload(files, kind, quoteId).catch((error: unknown) =>
      setUploadError(
        error instanceof Error
          ? error.message
          : "The files could not be uploaded. Try again.",
      ),
    );
  };
  const quoteAttachmentIds = new Set(
    request.quotes.flatMap((quote) => quote.attachmentIds),
  );
  const otherAttachments = request.attachments.filter(
    (file) => !quoteAttachmentIds.has(file.id),
  );
  const estimateFile = request.attachments.find(
    (file) =>
      file.id === request.estimateAttachmentId || file.kind === "estimate",
  );
  const disabled = busy;
  if (!editable)
    return <IntakeReceipt request={request} onPreview={onPreviewAttachment} />;
  return (
    <form
      className="pm-request"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || pendingUploads.length) return;
        onSubmit();
      }}
    >
      <div className="pm-intro">
        <span className="pm-eyebrow">PROJECT MANAGER REQUEST</span>
        <h1>Tell estimating what changed.</h1>
        <p>
          Describe the work and include what you know. Your estimator will
          review the scope, set pricing, and prepare the change order.
        </p>
        <span className="pm-caption">
          Every field is optional — send whatever you know. Drafts save as you
          type.
        </span>
      </div>
      {request.status === "needs_information" ? (
        <div className="pm-information-notice" role="status">
          <strong>
            {request.estimatorName || "Your estimator"} needs more information
          </strong>
          <blockquote>
            {request.informationQuestion ||
              "Please update the request details."}
          </blockquote>
          <p>Update the details or supporting files below, then resubmit.</p>
        </div>
      ) : null}
      <section className="pm-section" aria-labelledby="pm-project-title">
        <div className="pm-section-heading">
          <div>
            <h2 id="pm-project-title">Job details</h2>
            <p>
              Pick the job so the details fill in, then adjust anything that
              needs it.
            </p>
          </div>
        </div>
        <JobPicker
          jobs={jobs}
          onPick={(job) =>
            change({
              ...request,
              job: {
                ...request.job,
                jobNumber: job.jobNumber,
                customer: job.customer,
                address: job.address,
                projectManager: job.projectManager,
              },
            })
          }
        />
        <div className="pm-grid">
          <TextField
            name="job-jobNumber"
            label="Job number"
            value={request.job.jobNumber}
            disabled={disabled}
            onChange={(jobNumber) =>
              change({ ...request, job: { ...request.job, jobNumber } })
            }
          />
          <TextField
            name="job-customer"
            label="Customer / project owner"
            value={request.job.customer}
            disabled={disabled}
            onChange={(customer) =>
              change({ ...request, job: { ...request.job, customer } })
            }
          />
          <TextField
            name="job-address"
            label="Property address"
            value={request.job.address}
            disabled={disabled}
            onChange={(address) =>
              change({ ...request, job: { ...request.job, address } })
            }
          />
          <TextField
            name="job-projectManager"
            label="Project manager"
            value={request.job.projectManager}
            disabled={disabled}
            onChange={(projectManager) =>
              change({ ...request, job: { ...request.job, projectManager } })
            }
          />
        </div>
        <details className="pm-optional-details">
          <summary>
            <Plus size={16} />
            Branch & insurance details <span>Optional</span>
            <ChevronDown size={16} />
          </summary>
          <div className="pm-optional-body pm-grid">
            <TextField
              name="job-branchName"
              label="Branch"
              value={request.job.branchName}
              disabled={disabled}
              onChange={(branchName) =>
                change({ ...request, job: { ...request.job, branchName } })
              }
            />
            <TextField
              name="job-branchContact"
              label="PM / branch contact information"
              value={request.job.branchContact}
              disabled={disabled}
              placeholder="Email address or phone number"
              onChange={(branchContact) =>
                change({ ...request, job: { ...request.job, branchContact } })
              }
            />
            <TextField
              name="job-carrier"
              label="Insurance carrier"
              value={request.job.carrier}
              disabled={disabled}
              onChange={(carrier) =>
                change({ ...request, job: { ...request.job, carrier } })
              }
            />
            <TextField
              name="job-claim"
              label="Claim number"
              value={request.job.claim}
              disabled={disabled}
              onChange={(claim) =>
                change({ ...request, job: { ...request.job, claim } })
              }
            />
          </div>
        </details>
      </section>
      <section className="pm-section" aria-labelledby="pm-changes-title">
        <div className="pm-section-heading">
          <div>
            <h2 id="pm-changes-title">What needs to change?</h2>
            <p>Add one card per room, work area, or related scope change.</p>
          </div>
          <span className="pm-count">
            {request.requestedChanges.length}{" "}
            {request.requestedChanges.length === 1 ? "change" : "changes"}
          </span>
        </div>
        <div className="pm-card-list">
          {request.requestedChanges.map((item, index) => (
            <ChangeCard
              key={item.id}
              item={item}
              index={index}
              estimate={request.estimate}
              onChange={updateChange}
              onRemove={() =>
                change({
                  ...request,
                  requestedChanges: request.requestedChanges.filter(
                    (value) => value.id !== item.id,
                  ),
                  quotes: request.quotes.map((quote) => ({
                    ...quote,
                    changeIds: quote.changeIds.filter((id) => id !== item.id),
                  })),
                })
              }
              disabled={disabled}
            />
          ))}
        </div>
        <button
          type="button"
          className="button pm-add-change"
          disabled={disabled}
          onClick={() =>
            change({
              ...request,
              requestedChanges: [
                ...request.requestedChanges,
                createRequestedChange(),
              ],
            })
          }
        >
          <Plus size={18} />
          Add another work area / change
        </button>
      </section>
      <section className="pm-section" aria-labelledby="pm-quotes-title">
        <div className="pm-section-heading">
          <div>
            <h2 id="pm-quotes-title">
              Subcontractor costs & quotes{" "}
              <span className="pm-optional-label">Optional</span>
            </h2>
            <p>
              Include available quotes and link them to the relevant changes.
              Leave costs blank when unknown.
            </p>
          </div>
        </div>
        <div className="pm-card-list">
          {request.quotes.map((quote, index) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              index={index}
              changes={request.requestedChanges}
              attachments={request.attachments.filter((file) =>
                quote.attachmentIds.includes(file.id),
              )}
              onChange={updateQuote}
              onRemove={() =>
                change({
                  ...request,
                  quotes: request.quotes.filter(
                    (value) => value.id !== quote.id,
                  ),
                })
              }
              onUpload={(files) => upload(files, "quote", quote.id)}
              onPreview={onPreviewAttachment}
              onRemoveAttachment={onRemoveAttachment}
              disabled={disabled}
            />
          ))}
        </div>
        <button
          type="button"
          className="button"
          disabled={disabled}
          onClick={() => {
            const quote = createQuote();
            if (request.requestedChanges.length === 1)
              quote.changeIds = [request.requestedChanges[0].id];
            change({ ...request, quotes: [...request.quotes, quote] });
          }}
        >
          <Plus size={17} />
          Add subcontractor quote
        </button>
      </section>
      <section className="pm-section" aria-labelledby="pm-files-title">
        <div className="pm-section-heading">
          <div>
            <h2 id="pm-files-title">
              Supporting files{" "}
              <span className="pm-optional-label">Optional</span>
            </h2>
            <p>
              Add photos or a reference estimate to help the estimator
              understand the work.
            </p>
          </div>
          <Paperclip size={21} />
        </div>
        <div className="pm-support-buttons">
          <UploadButton
            label="Add photos"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            icon="photo"
            disabled={disabled}
            onFiles={(files) => upload(files, "photo")}
          />
          {!estimateFile ? (
            <UploadButton
              label="Attach estimate PDF"
              accept="application/pdf,.pdf"
              multiple={false}
              disabled={
                disabled ||
                pendingUploads.some((file) => file.state === "uploading")
              }
              onFiles={(files) => upload(files, "estimate")}
            />
          ) : null}
        </div>
        <FileList
          attachments={otherAttachments}
          editable={!disabled}
          onPreview={onPreviewAttachment}
          onRemove={onRemoveAttachment}
        />
        {request.estimate.length ? (
          <p className="pm-caption pm-extraction-note">
            {request.estimate.length} reference estimate items are available to
            link within your change cards.
          </p>
        ) : null}
        {request.extractionWarnings.length ? (
          <div className="pm-extraction-note">
            <p>
              The estimate is attached for reference. You can describe your
              changes even when items cannot be read automatically.
            </p>
            <details>
              <summary>Estimate reading notes</summary>
              <ul>
                {request.extractionWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
        {pendingUploads.length ? (
          <ul className="pm-pending-files" aria-live="polite">
            {pendingUploads.map((file) => (
              <li key={file.id}>
                <FileText size={18} />
                <div>
                  <strong>{file.name}</strong>
                  <small
                    className={file.state === "failed" ? "pm-field-error" : ""}
                  >
                    {file.state === "uploading"
                      ? "Uploading…"
                      : file.error ||
                        "Upload failed. Retry or remove this file."}
                  </small>
                </div>
                {file.state === "failed" ? (
                  <button
                    className="button"
                    type="button"
                    onClick={() => onRetryUpload(file.id)}
                    disabled={busy}
                  >
                    Retry
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pm-icon-button"
                  onClick={() => onRemovePendingUpload(file.id)}
                  aria-label={`Cancel upload ${file.name}`}
                  disabled={busy}
                >
                  <X size={18} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {uploadError ? (
          <p className="pm-field-error" role="alert">
            {uploadError}
          </p>
        ) : null}
      </section>
      <div className="pm-submit-bar">
        <div>
          <strong>
            {saveStatus === "saved"
              ? "Draft saved"
              : saveStatus === "saving"
                ? "Saving draft…"
                : "Draft has not been saved"}
          </strong>
          <span>
            {pendingUploads.length
              ? "Finish or remove pending uploads before submitting."
              : saveStatus === "error"
                ? "Keep this page open. Submitting will try to save again."
                : "Submitting adds this request to the shared estimator queue."}
          </span>
        </div>
        <button
          className="button primary"
          type="submit"
          disabled={busy || pendingUploads.length > 0}
        >
          <Send size={17} />
          {busy
            ? "Working…"
            : request.status === "needs_information"
              ? "Resubmit to estimating"
              : "Submit to estimating"}
        </button>
      </div>
    </form>
  );
}
