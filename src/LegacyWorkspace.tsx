import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  UploadCloud,
  FileText,
  Check,
  CheckCheck,
  FolderOpen,
  Search,
  Trash2,
  Pencil,
  Minus,
  CircleAlert,
  Save,
  ShieldCheck,
  X,
  ChevronRight,
  Clock3,
} from "lucide-react";
import {
  createDraft,
  createChange,
  blankEstimate,
  type ChangeOrderDraft,
  type EstimateItem,
  type ChangeItem,
  type JobDetails,
  type SourceFile,
  type DraftSummary,
} from "./types";
import {
  listDrafts,
  saveDraft,
  deleteDraft,
  openDraft,
  fetchSourcePdf,
  uploadPdf,
  blobToBase64,
} from "./services/storage";
import {
  baselineProblems,
  calculateChange,
  cents,
  money,
  signedMoney,
  scopeText,
  validDecimal,
  validationErrors,
} from "./services/pricing";
import AppHeader from "./components/AppHeader";
import type { NavDestination } from "./services/navigation";
const PdfViewer = lazy(() => import("./components/PdfViewer"));
const Preview = lazy(() => import("./components/Preview"));
const STEPS = [
  "Upload estimate",
  "Enter changes",
  "Confirm job details",
  "Preview & download",
];
const numericFields = [
  ["quantity", "Quantity"],
  ["rate", "Unit price ($)"],
  ["tax", "Tax ($)"],
  ["op", "O&P ($)"],
  ["rcv", "Original RCV ($)"],
] as const;
function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  help,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  help?: string;
  disabled?: boolean;
}) {
  const helpId = useId();
  return (
    <label className="field">
      <span>
        {label}
        {required ? <b aria-hidden="true"> *</b> : null}
      </span>
      <input
        aria-label={label}
        aria-describedby={help ? helpId : undefined}
        type={type}
        inputMode={
          type === "text" && /\$|quantity|days/i.test(label)
            ? "decimal"
            : undefined
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-required={required}
      />
      {help ? <small id={helpId}>{help}</small> : null}
    </label>
  );
}
function Amount({ item }: { item: ChangeItem }) {
  try {
    const amount = calculateChange(item);
    return (
      <strong
        className={
          amount.delta < 0 ? "credit" : amount.delta > 0 ? "accent" : ""
        }
      >
        {signedMoney(amount.delta)}
      </strong>
    );
  } catch {
    return <span className="muted">Complete pricing</span>;
  }
}
function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 65 42" aria-hidden="true">
        <rect width="14" height="42" fill="#dc2626" />
        <rect x="36" width="14" height="42" fill="#1a1a1a" />
        <rect x="14" y="14" width="51" height="14" fill="#1a1a1a" />
      </svg>
      <div>
        <strong>Hays+Sons</strong>
        <span>CHANGE ORDERS</span>
      </div>
    </div>
  );
}
function SourcePanel({ source, page }: { source: SourceFile; page: number }) {
  const [blob, setBlob] = useState<Blob | null>(source.blob);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (blob || !source.driveFileId) return;
    let active = true;
    void fetchSourcePdf(source.driveFileId)
      .then((result) => {
        if (active) setBlob(result.blob);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [blob, source.driveFileId]);
  if (failed)
    return (
      <div className="empty">
        <FileText size={24} />
        <p>The source PDF could not be loaded from the cloud.</p>
      </div>
    );
  if (!blob) return <div className="empty">Loading source PDF…</div>;
  return (
    <Suspense fallback={<div className="empty">Loading source PDF…</div>}>
      <PdfViewer blob={blob} page={page} label="Source estimate" />
    </Suspense>
  );
}
export interface LegacyWorkspaceProps {
  /** Section navigation, provided by the shell so every screen agrees on it. */
  onNavigate: (destination: NavDestination) => void;
  onConvert: (id: string) => Promise<void>;
  startNew?: boolean;
  converting?: boolean;
}
export default function LegacyWorkspace({
  onNavigate,
  onConvert,
  startNew = false,
  converting = false,
}: LegacyWorkspaceProps) {
  const [draft, setDraft] = useState<ChangeOrderDraft | null>(null);
  const [saved, setSaved] = useState<DraftSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">(
    "saved",
  );
  const [storageError, setStorageError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [sourcePage, setSourcePage] = useState(1);
  const [editItem, setEditItem] = useState<string | null>(null);
  const [homeSearch, setHomeSearch] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadToken = useRef(0);
  const dirty = useRef(false);
  const latestSave = useRef(0);
  const started = useRef(false);
  useEffect(() => {
    if (startNew && !started.current) {
      started.current = true;
      newDraft();
    }
  }, [startNew]);
  useEffect(() => {
    let active = true;
    void listDrafts()
      .then(async (records) => {
        if (!active) return;
        setSaved(records);
        if (startNew) return;
        let selected: string | null = null;
        try {
          selected = localStorage.getItem("hays-active-draft");
        } catch {}
        if (selected) {
          try {
            const recovered = await openDraft(selected);
            if (active) setDraft(recovered);
          } catch {
            if (active)
              setStorageError("Your last draft could not be reopened.");
          }
        }
      })
      .catch((e) => {
        if (active) {
          setStorageError(e.message);
          setSaveStatus("error");
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const persist = async (value: ChangeOrderDraft) => {
    const request = ++latestSave.current;
    setSaveStatus("saving");
    try {
      await saveDraft(value);
      if (
        request === latestSave.current &&
        draftRef.current?.id === value.id &&
        draftRef.current.revision === value.revision
      ) {
        setSaveStatus("saved");
        setStorageError("");
        dirty.current = false;
      }
    } catch (e) {
      if (request === latestSave.current) {
        setSaveStatus("error");
        setStorageError(
          e instanceof Error ? e.message : "Device storage is unavailable.",
        );
        dirty.current = true;
      }
      throw e;
    }
  };
  useEffect(() => {
    if (!ready || !draft) return;
    dirty.current = true;
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      void persist(draft).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, ready]);
  useEffect(() => {
    // Navigating away (the header's back button, a menu jump) unmounts this
    // workspace, so the last keystrokes still inside the autosave debounce are
    // written on the way out instead of being lost.
    return () => {
      if (draftRef.current && dirty.current)
        void persist(draftRef.current).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const hide = () => {
      if (
        document.visibilityState === "hidden" &&
        draftRef.current &&
        dirty.current
      )
        void persist(draftRef.current).catch(() => {});
    };
    const before = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", before);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", before);
    };
  }, []);
  const remember = (id: string | null) => {
    try {
      if (id) localStorage.setItem("hays-active-draft", id);
      else localStorage.removeItem("hays-active-draft");
    } catch {}
  };
  const update = (fn: (value: ChangeOrderDraft) => ChangeOrderDraft) =>
    setDraft((current) =>
      current
        ? {
            ...fn(current),
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
          }
        : current,
    );
  const go = (step: number) => {
    setError("");
    update((d) => ({ ...d, step }));
    // A step is a page: landing halfway down the next one reads as a dead end.
    window.scrollTo({ top: 0, left: 0 });
  };
  const backHome = async () => {
    let current = draftRef.current;
    while (current) {
      try {
        await persist(current);
      } catch {
        setError(
          "Your draft is still in this window. Retry saving before returning to drafts.",
        );
        return;
      }
      if (
        draftRef.current?.revision === current.revision &&
        draftRef.current.id === current.id
      )
        break;
      current = draftRef.current;
    }
    uploadToken.current++;
    setDraft(null);
    remember(null);
    setError("");
    setSearch("");
    setEditItem(null);
    try {
      setSaved(await listDrafts());
    } catch (e) {
      setStorageError(String(e));
    }
  };
  const newDraft = () => {
    const next = createDraft();
    setDraft(next);
    remember(next.id);
    setError("");
    setSearch("");
  };
  const jobChange = (key: keyof JobDetails, value: string | boolean) =>
    update((d) => ({ ...d, job: { ...d.job, [key]: value } }));
  const baselineChange = (
    id: string,
    field: keyof EstimateItem,
    value: unknown,
  ) =>
    update((d) => {
      const estimate = d.estimate.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
              reviewed: field === "reviewed" ? Boolean(value) : false,
            }
          : row,
      );
      const original = estimate.find((row) => row.id === id)!;
      return {
        ...d,
        estimate,
        changes: d.changes.map((row) =>
          row.original?.id === id
            ? {
                ...row,
                original: structuredClone(original),
                pricingConfirmed: false,
              }
            : row,
        ),
      };
    });
  const changeChange = (id: string, field: keyof ChangeItem, value: unknown) =>
    update((d) => ({
      ...d,
      changes: d.changes.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
              pricingConfirmed:
                field === "pricingConfirmed" ? Boolean(value) : false,
            }
          : row,
      ),
    }));
  const choose = (original: EstimateItem, action: "revise" | "remove") =>
    update((d) => ({
      ...d,
      changes: d.changes.some((row) => row.original?.id === original.id)
        ? d.changes.map((row) =>
            row.original?.id === original.id
              ? { ...row, action, pricingConfirmed: false }
              : row,
          )
        : [...d.changes, createChange(original, action)],
    }));
  const upload = async (file: File) => {
    if (!draft || busy) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Upload a PDF estimate.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Choose a PDF smaller than 15 MB.");
      return;
    }
    if (
      draft.source &&
      !window.confirm(
        "Replacing the estimate will clear the existing item changes. Job details and the scope summary will be kept.",
      )
    )
      return;
    const token = ++uploadToken.current;
    setBusy("Opening your estimate…");
    setError("");
    try {
      const { extractEstimate } = await import("./services/pdfExtract");
      const result = await extractEstimate(file, (message) => {
        if (token === uploadToken.current) setBusy(message);
      });
      if (token !== uploadToken.current) return;
      const warnings = [...result.warnings];
      let driveFileId: string | null = null;
      try {
        if (token === uploadToken.current) setBusy("Saving your estimate…");
        const base64 = await blobToBase64(file);
        driveFileId = await uploadPdf(
          file.name,
          file.type || "application/pdf",
          base64,
          draftRef.current?.source?.driveFileId ?? null,
        );
      } catch {
        if (token === uploadToken.current)
          warnings.push(
            "The source PDF could not be saved to the cloud; it will only be available on this device.",
          );
      }
      if (token !== uploadToken.current) return;
      update((d) => ({
        ...d,
        source: {
          name: file.name,
          blob: file,
          pages: result.pages,
          driveFileId,
        },
        estimate: result.items,
        changes: [],
        extractionWarnings: warnings,
        job: {
          ...d.job,
          ...Object.fromEntries(
            Object.entries(result.job).filter(
              ([key]) => !String(d.job[key as keyof JobDetails] ?? "").trim(),
            ),
          ),
        },
      }));
      setSourcePage(1);
      setEditItem(null);
    } catch (e) {
      if (token === uploadToken.current)
        setError(
          `The PDF could not be read. ${e instanceof Error ? e.message : ""} Try a text-based Final Draft PDF or enter items manually.`,
        );
    } finally {
      if (token === uploadToken.current) setBusy("");
    }
  };
  const addBaseline = () => {
    const row = blankEstimate();
    update((d) => ({ ...d, estimate: [...d.estimate, row] }));
    setEditItem(row.id);
  };
  const filtered =
    draft?.estimate.filter((row) =>
      `${row.room} ${row.lineNumber} ${row.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const originalTable = (
    <table className="estimate-table">
      <thead>
        <tr>
          <th scope="col">Line</th>
          <th scope="col">Room / item</th>
          <th scope="col">Quantity</th>
          <th scope="col">RCV</th>
          <th scope="col">Review</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((row) => (
          <tr key={row.id}>
            <td>{row.lineNumber || "+"}</td>
            <td>
              <small>{row.room || "Unassigned room"}</small>
              <span>{row.description || "Untitled item"}</span>
            </td>
            <td>
              {row.quantity || "—"}
              <small>{row.unit}</small>
            </td>
            <td>{validDecimal(row.rcv, true) ? money(cents(row.rcv)) : "—"}</td>
            <td>
              <button
                className={`icon-button ${row.reviewed ? "credit" : ""}`}
                aria-label={`Review original line ${row.lineNumber || "manual item"}`}
                onClick={() => {
                  setEditItem(editItem === row.id ? null : row.id);
                  if (row.page) setSourcePage(row.page);
                }}
              >
                {row.reviewed ? <Check size={15} /> : <Pencil size={14} />}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  let net: number | null = 0;
  if (draft)
    try {
      net = draft.changes.reduce(
        (sum, row) => sum + calculateChange(row).delta,
        0,
      );
    } catch {
      net = null;
    }
  if (!ready)
    return (
      <div className="boot">
        <Brand />
        <div className="spinner" />
        <p>Opening your saved drafts…</p>
      </div>
    );
  return (
    <div className="app-shell">
      <AppHeader
        current="legacy"
        onNavigate={onNavigate}
        context="Legacy change orders"
        back={{
          label: "Back to requests",
          onClick: () => onNavigate("home"),
        }}
        actions={
          draft ? (
            <button
              className="button small"
              disabled={!!busy}
              onClick={() => void backHome()}
            >
              <FolderOpen size={16} />
              My drafts
            </button>
          ) : null
        }
      />
      {storageError ? (
        <div className="storage-error" role="alert">
          <CircleAlert size={18} />
          <span>
            <strong>Draft could not be saved.</strong> {storageError} Your
            current work remains in this window.
          </span>
          <button
            className="button small"
            onClick={() => {
              if (draft) void persist(draft).catch(() => {});
              else
                void listDrafts()
                  .then(setSaved)
                  .then(() => setStorageError(""))
                  .catch((e) => setStorageError(String(e)));
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {!draft ? (
        <main className="home">
          <div className="home-title">
            <div>
              <h1>Legacy change orders</h1>
            </div>
            <button className="button primary large" onClick={newDraft}>
              <Plus size={20} />
              New change order
            </button>
          </div>
          <div className="home-workflow">
            {STEPS.map((step, i) => (
              <div key={step}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <p>{step}</p>
                {i < 3 ? <ChevronRight size={17} /> : <CheckCheck size={18} />}
              </div>
            ))}
          </div>
          <section className="draft-section">
            <div className="section-heading">
              <div>
                <h2>
                  Your drafts <span className="count">{saved.length}</span>
                </h2>
                <p>
                  Pick up where you left off. Drafts sync automatically across
                  your team.
                </p>
              </div>
              {saved.length ? (
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search drafts"
                    placeholder="Search customer or job…"
                    value={homeSearch}
                    onChange={(e) => setHomeSearch(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
            {!saved.length ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <FileText size={30} />
                </div>
                <h3>Your next change order starts here.</h3>
                <p>
                  Upload a Xactimate estimate, select what’s changing,
                  <br />
                  and we’ll put the paperwork together.
                </p>
                <button className="button" onClick={newDraft}>
                  <Plus size={16} />
                  Create your first change order
                </button>
              </div>
            ) : (
              <div className="draft-grid">
                {saved
                  .filter((d) =>
                    `${d.job.customer} ${d.job.jobNumber} ${d.job.orderNumber}`
                      .toLowerCase()
                      .includes(homeSearch.toLowerCase()),
                  )
                  .map((d) => (
                    <article className="draft-card" key={d.id}>
                      <div className="draft-card-top">
                        <span className="badge">{d.job.orderNumber}</span>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${d.job.orderNumber} ${d.job.customer || "untitled draft"}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Delete this draft and its estimate for the whole team?",
                              )
                            )
                              void deleteDraft(d.id)
                                .then(() => listDrafts())
                                .then(setSaved)
                                .catch((e) => setStorageError(String(e)));
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <h3>{d.job.customer || "Untitled change order"}</h3>
                      <p>
                        {d.job.jobNumber || "Job number pending"} ·{" "}
                        {d.changesCount} changed items
                      </p>
                      <div className="draft-card-bottom">
                        <small>
                          <Clock3 size={12} />
                          {new Date(d.updatedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </small>
                        <button
                          className="text-button"
                          onClick={() => {
                            if (busy) return;
                            setBusy("Opening draft…");
                            void openDraft(d.id)
                              .then((full) => {
                                setDraft(full);
                                remember(full.id);
                                setSearch("");
                                setEditItem(null);
                                setBusy("");
                              })
                              .catch((e) => {
                                setBusy("");
                                setStorageError(
                                  e instanceof Error ? e.message : String(e),
                                );
                              });
                          }}
                        >
                          Open draft <ArrowRight size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </section>
          <footer className="home-footer">
            <ShieldCheck size={15} />
            <span>
              Documents are processed in your browser and synced to your team's
              Google Sheets.
            </span>
          </footer>
        </main>
      ) : (
        <div className="workspace">
          <aside className="rail">
            <button
              className="back-link"
              disabled={!!busy}
              onClick={() => void backHome()}
            >
              <ArrowLeft size={15} />
              All drafts
            </button>
            <div className="rail-job">
              <span className="eyebrow">CHANGE ORDER</span>
              <h2>{draft.job.orderNumber || "CO-01"}</h2>
              <p>{draft.job.customer || "New project"}</p>
              <small>{draft.job.jobNumber || "Job details to follow"}</small>
            </div>
            <nav aria-label="Change order steps">
              {STEPS.map((step, i) => (
                <button
                  key={step}
                  className={`step-button ${draft.step === i ? "active" : ""}`}
                  aria-current={draft.step === i ? "step" : undefined}
                  disabled={!!busy}
                  onClick={() => go(i)}
                >
                  <span>{draft.step > i ? <Check size={15} /> : i + 1}</span>
                  <div>
                    {step}
                    <small>
                      {
                        [
                          "Bring in the original scope",
                          "Add, revise, or remove work",
                          "Review the project information",
                          "Prepare the paperwork",
                        ][i]
                      }
                    </small>
                  </div>
                </button>
              ))}
            </nav>
            <div className="rail-total">
              <small>NET CHANGE</small>
              <strong className={net !== null && net < 0 ? "credit" : "accent"}>
                {net === null ? "—" : signedMoney(net)}
              </strong>
              <span>
                {draft.changes.length} changed{" "}
                {draft.changes.length === 1 ? "item" : "items"}
              </span>
            </div>
            <div className={`save-label ${saveStatus}`}>
              <Save size={14} />
              {saveStatus === "saving"
                ? "Saving draft…"
                : saveStatus === "error"
                  ? "Draft needs saving"
                  : "All changes saved"}
            </div>
            <button
              className="button full legacy-convert"
              disabled={!!busy || converting}
              onClick={() => void onConvert(draft.id)}
            >
              <ArrowRight size={16} />
              {converting ? "Converting…" : "Convert to request"}
            </button>
          </aside>
          <main className="workspace-main">
            <div className="page-heading">
              <div className="eyebrow">
                STEP {String(draft.step + 1).padStart(2, "0")} OF 04
              </div>
              <h1>{STEPS[draft.step]}</h1>
              <p>
                {
                  [
                    "Upload the original scope, then review the items you’ll use.",
                    "Select original items or add new work. We’ll calculate the difference.",
                    "Confirm the project details and describe the change in your own words.",
                    "Review the form and itemized attachment before downloading.",
                  ][draft.step]
                }
              </p>
            </div>
            {error ? (
              <div className="notice danger" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <X size={16} />
                </button>
              </div>
            ) : null}
            {draft.step === 0 ? (
              <>
                <input
                  ref={fileInput}
                  className="visually-hidden"
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label="Upload estimate PDF"
                  onChange={(e) => {
                    if (e.target.files?.[0]) void upload(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
                <div
                  className={`upload-zone ${busy ? "processing" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files[0])
                      void upload(e.dataTransfer.files[0]);
                  }}
                >
                  <div className="upload-icon">
                    {busy ? (
                      <div className="spinner" />
                    ) : (
                      <UploadCloud size={30} />
                    )}
                  </div>
                  <h3>
                    {busy ||
                      (draft.source
                        ? "Your estimate is attached."
                        : "Drop your estimate here.")}
                  </h3>
                  <p>
                    {draft.source
                      ? draft.source.name
                      : "Xactimate Final Draft PDF · Selectable text · Up to 40 MB"}
                  </p>
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <UploadCloud size={16} />
                    {draft.source ? "Replace estimate" : "Choose PDF"}
                  </button>
                  {!draft.source ? (
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() => go(1)}
                    >
                      Enter changes manually <ArrowRight size={14} />
                    </button>
                  ) : null}
                </div>
                {draft.extractionWarnings.map((w) => (
                  <div key={w} className="notice warning">
                    <CircleAlert size={18} />
                    <span>{w}</span>
                  </div>
                ))}
                {draft.estimate.length || draft.source ? (
                  <div
                    className={`estimate-layout ${draft.source ? "with-source" : ""}`}
                  >
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Original estimate{" "}
                            <span className="count">
                              {draft.estimate.length}
                            </span>
                          </h2>
                          <p>
                            Correct extracted values, then mark each affected
                            item reviewed.
                          </p>
                        </div>
                        <button className="button small" onClick={addBaseline}>
                          <Plus size={15} />
                          Item
                        </button>
                      </div>
                      <label className="search full">
                        <Search size={17} />
                        <input
                          aria-label="Search estimate"
                          placeholder="Search room, line, or description…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      {originalTable}
                      <div className="baseline-list">
                        {filtered.map((row) => (
                          <div
                            className={`baseline-row ${editItem === row.id ? "expanded" : ""}`}
                            key={row.id}
                          >
                            <button
                              className="baseline-toggle"
                              onClick={() => {
                                setEditItem(
                                  editItem === row.id ? null : row.id,
                                );
                                if (row.page) setSourcePage(row.page);
                              }}
                            >
                              <div className="line-number">
                                {row.lineNumber || "+"}
                              </div>
                              <div>
                                <small>
                                  {row.room || "Unassigned room"}
                                  {row.page
                                    ? ` · Page ${row.page}`
                                    : " · Manual item"}
                                </small>
                                <strong>
                                  {row.description || "Describe this item"}
                                </strong>
                              </div>
                              <span
                                className={`review-dot ${row.reviewed ? "reviewed" : ""}`}
                                title={
                                  row.reviewed ? "Reviewed" : "Needs review"
                                }
                              >
                                {row.reviewed ? (
                                  <Check size={14} />
                                ) : (
                                  <Pencil size={13} />
                                )}
                              </span>
                            </button>
                            {editItem === row.id ? (
                              <div className="baseline-editor">
                                <div className="fields two">
                                  <Field
                                    label="Room"
                                    value={row.room}
                                    onChange={(v) =>
                                      baselineChange(row.id, "room", v)
                                    }
                                  />
                                  <Field
                                    label="Line number"
                                    value={row.lineNumber}
                                    onChange={(v) =>
                                      baselineChange(row.id, "lineNumber", v)
                                    }
                                  />
                                </div>
                                <Field
                                  label="Original description"
                                  value={row.description}
                                  onChange={(v) =>
                                    baselineChange(row.id, "description", v)
                                  }
                                  required
                                />
                                <div className="fields two">
                                  <Field
                                    label="Unit"
                                    value={row.unit}
                                    onChange={(v) =>
                                      baselineChange(row.id, "unit", v)
                                    }
                                    required
                                  />
                                  {numericFields.map(([key, label]) => (
                                    <Field
                                      key={key}
                                      label={label}
                                      value={row[key]}
                                      onChange={(v) =>
                                        baselineChange(row.id, key, v)
                                      }
                                      required
                                    />
                                  ))}
                                </div>
                                {row.priceComponents ? (
                                  <p className="credit">
                                    The extracted unit price combines reset (
                                    {row.priceComponents.reset || "0"}), removal
                                    ({row.priceComponents.remove || "0"}), and
                                    replacement (
                                    {row.priceComponents.replace || "0"}) prices
                                    from the estimate.
                                  </p>
                                ) : null}
                                {row.warnings.length ? (
                                  <div className="inline-warning">
                                    {row.warnings.join(" ")}
                                  </div>
                                ) : null}
                                <label className="check-label">
                                  <input
                                    type="checkbox"
                                    checked={row.reviewed}
                                    disabled={baselineProblems(row).length > 0}
                                    onChange={(e) =>
                                      baselineChange(
                                        row.id,
                                        "reviewed",
                                        e.target.checked,
                                      )
                                    }
                                  />
                                  I verified these original values against the
                                  estimate.
                                </label>
                                {baselineProblems(row).length ? (
                                  <small className="credit">
                                    Complete the original description, unit, and
                                    all pricing fields to confirm.
                                  </small>
                                ) : null}
                                <details>
                                  <summary>Extracted source text</summary>
                                  <pre>
                                    {row.rawText || "Manually entered item"}
                                  </pre>
                                </details>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <button
                        className="button full"
                        onClick={() =>
                          update((d) => {
                            const estimate = d.estimate.map((row) => ({
                              ...row,
                              reviewed: baselineProblems(row).length === 0,
                            }));
                            return {
                              ...d,
                              estimate,
                              changes: d.changes.map((change) =>
                                change.original
                                  ? {
                                      ...change,
                                      original: structuredClone(
                                        estimate.find(
                                          (row) =>
                                            row.id === change.original!.id,
                                        )!,
                                      ),
                                      pricingConfirmed: false,
                                    }
                                  : change,
                              ),
                            };
                          })
                        }
                      >
                        <CheckCheck size={16} />
                        Confirm all complete original items
                      </button>
                    </section>
                    {draft.source ? (
                      <aside className="source-panel">
                        <SourcePanel
                          key={draft.source.driveFileId ?? draft.source.name}
                          source={draft.source}
                          page={sourcePage}
                        />
                      </aside>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            {draft.step === 1 ? (
              <>
                <div className="changes-layout">
                  <section>
                    <div className="section-heading">
                      <div>
                        <h2>
                          Changed items{" "}
                          <span className="count">{draft.changes.length}</span>
                        </h2>
                        <p>
                          Amounts show the difference from the original
                          estimate.
                        </p>
                      </div>
                      <button
                        className="button primary"
                        onClick={() =>
                          update((d) => ({
                            ...d,
                            changes: [...d.changes, createChange(null)],
                          }))
                        }
                      >
                        <Plus size={17} />
                        Add new work
                      </button>
                    </div>
                    {!draft.changes.length ? (
                      <div className="empty-state compact">
                        <Pencil size={28} />
                        <h3>Every change starts with an item.</h3>
                        <p>
                          Select an item from your estimate,
                          <br />
                          or add work that wasn’t in the original scope.
                        </p>
                      </div>
                    ) : null}
                    {draft.changes.map((row, i) => (
                      <article className="change-card" key={row.id}>
                        <div className="change-heading">
                          <span className={`action-badge ${row.action}`}>
                            {row.action === "remove" ? (
                              <Minus size={13} />
                            ) : row.action === "add" ? (
                              <Plus size={13} />
                            ) : (
                              <Pencil size={12} />
                            )}
                            {row.action === "remove"
                              ? "Credit / remove"
                              : row.action === "add"
                                ? "New work"
                                : "Revision"}
                          </span>
                          <Amount item={row} />
                          <button
                            className="icon-button"
                            aria-label={`Discard changed item ${i + 1}`}
                            onClick={() =>
                              update((d) => ({
                                ...d,
                                changes: d.changes.filter(
                                  (item) => item.id !== row.id,
                                ),
                              }))
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        {row.original ? (
                          <>
                            <div className="original-reference">
                              <span>
                                ORIGINAL · {row.original.room || "Unassigned"} ·
                                Line {row.original.lineNumber || "—"}
                                {row.original.page
                                  ? ` · Page ${row.original.page}`
                                  : ""}
                              </span>
                              <p>{row.original.description}</p>
                              <small>
                                {row.original.quantity} {row.original.unit} × $
                                {row.original.rate} · Tax $
                                {row.original.tax || "—"} · O&P $
                                {row.original.op || "—"} · RCV $
                                {row.original.rcv || "—"}
                              </small>
                              {!row.original.reviewed ? (
                                <button
                                  className="text-button credit"
                                  onClick={() => {
                                    setEditItem(row.original!.id);
                                    setSourcePage(row.original!.page || 1);
                                    go(0);
                                  }}
                                >
                                  Review original values{" "}
                                  <ArrowRight size={14} />
                                </button>
                              ) : null}
                            </div>
                            <div className="segmented slim">
                              <button
                                aria-pressed={row.action === "revise"}
                                onClick={() =>
                                  changeChange(row.id, "action", "revise")
                                }
                              >
                                Revise item
                              </button>
                              <button
                                aria-pressed={row.action === "remove"}
                                onClick={() =>
                                  changeChange(row.id, "action", "remove")
                                }
                              >
                                Remove / credit
                              </button>
                            </div>
                          </>
                        ) : null}
                        <div className="fields two">
                          <Field
                            label="Room / area"
                            value={row.room}
                            onChange={(v) => changeChange(row.id, "room", v)}
                          />
                          <Field
                            label="Description"
                            value={row.description}
                            onChange={(v) =>
                              changeChange(row.id, "description", v)
                            }
                            required
                          />
                        </div>
                        {row.action !== "remove" ? (
                          <>
                            <div className="fields four">
                              <Field
                                label="Revised quantity"
                                value={row.quantity}
                                onChange={(v) =>
                                  changeChange(row.id, "quantity", v)
                                }
                                required
                              />
                              <Field
                                label="Unit"
                                value={row.unit}
                                onChange={(v) =>
                                  changeChange(row.id, "unit", v)
                                }
                                required
                              />
                              <Field
                                label="Unit price ($)"
                                value={row.rate}
                                onChange={(v) =>
                                  changeChange(row.id, "rate", v)
                                }
                                required
                              />
                              <div className="calculated-field">
                                <span>Revised item total</span>
                                <strong>
                                  {(() => {
                                    try {
                                      return money(
                                        calculateChange(row).revised,
                                      );
                                    } catch {
                                      return "—";
                                    }
                                  })()}
                                </strong>
                              </div>
                            </div>
                            <div className="tax-review">
                              <div>
                                <strong>Tax & overhead/profit</strong>
                                <p>
                                  Enter revised dollar amounts. Rates are not
                                  inferred.
                                </p>
                              </div>
                              <div className="fields two">
                                <Field
                                  label="Revised tax ($)"
                                  value={row.tax}
                                  onChange={(v) =>
                                    changeChange(row.id, "tax", v)
                                  }
                                  required
                                />
                                <Field
                                  label="Revised O&P ($)"
                                  value={row.op}
                                  onChange={(v) =>
                                    changeChange(row.id, "op", v)
                                  }
                                  required
                                />
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="notice neutral">
                            This item’s full original RCV, including its tax and
                            O&P, will be credited.
                          </div>
                        )}
                        <label className="field">
                          <span>
                            Reason for this change <b>*</b>
                          </span>
                          <textarea
                            rows={2}
                            placeholder="What changed, and why?"
                            value={row.reason}
                            onChange={(e) =>
                              changeChange(row.id, "reason", e.target.value)
                            }
                          />
                        </label>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={row.pricingConfirmed}
                            onChange={(e) =>
                              changeChange(
                                row.id,
                                "pricingConfirmed",
                                e.target.checked,
                              )
                            }
                          />
                          I confirm{" "}
                          {row.action === "remove"
                            ? "the full credit and original tax/O&P."
                            : "the revised pricing, tax, and O&P amounts."}
                        </label>
                      </article>
                    ))}
                  </section>
                  <aside
                    className={`select-items panel ${!draft.estimate.length ? "no-items" : ""}`}
                  >
                    <div className="panel-heading">
                      <div>
                        <h2>From the estimate</h2>
                        <p>Select the work that’s changing.</p>
                      </div>
                    </div>
                    <label className="search full">
                      <Search size={16} />
                      <input
                        aria-label="Search items to change"
                        placeholder="Room, item, or line number…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    {!draft.estimate.length ? (
                      <div className="empty compact">
                        <FileText size={26} />
                        <p>No estimate items yet.</p>
                        <button className="text-button" onClick={() => go(0)}>
                          Upload or enter original items{" "}
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    ) : null}
                    <div className="select-list">
                      {filtered.map((row) => (
                        <div className="select-item" key={row.id}>
                          <small>
                            {row.room || "Unassigned"} · #
                            {row.lineNumber || "—"}
                            {row.reviewed ? "" : " · Review needed"}
                          </small>
                          <strong>{row.description || "Untitled item"}</strong>
                          <div>
                            <span>
                              {row.quantity || "—"} {row.unit} · $
                              {row.rcv || "—"}
                            </span>
                            {draft.changes.some(
                              (c) => c.original?.id === row.id,
                            ) ? (
                              <span className="selected-label">
                                <Check size={12} />
                                Selected
                              </span>
                            ) : (
                              <div className="button-row">
                                <button
                                  className="button small"
                                  onClick={() => choose(row, "revise")}
                                >
                                  Revise
                                </button>
                                <button
                                  className="button small"
                                  onClick={() => choose(row, "remove")}
                                >
                                  Credit
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </aside>
                </div>
              </>
            ) : null}
            {draft.step === 2 ? (
              <>
                <section className="panel details-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Project & customer</h2>
                      <p>These details appear on your change-order form.</p>
                    </div>
                    <span className="badge">{draft.job.orderNumber}</span>
                  </div>
                  <div className="fields two">
                    <Field
                      label="Customer / project owner"
                      required
                      value={draft.job.customer}
                      onChange={(v) => jobChange("customer", v)}
                    />
                    <Field
                      label="Job number"
                      required
                      value={draft.job.jobNumber}
                      onChange={(v) => jobChange("jobNumber", v)}
                    />
                    <Field
                      label="Property address"
                      required
                      value={draft.job.address}
                      onChange={(v) => jobChange("address", v)}
                    />
                    <Field
                      label="Project manager"
                      required
                      value={draft.job.projectManager}
                      onChange={(v) => jobChange("projectManager", v)}
                    />
                    <Field
                      label="Change-order number"
                      required
                      value={draft.job.orderNumber}
                      onChange={(v) => jobChange("orderNumber", v)}
                    />
                    <Field
                      label="Change-order date"
                      type="date"
                      required
                      value={draft.job.date}
                      onChange={(v) => jobChange("date", v)}
                    />
                  </div>
                  <div className="subsection">
                    <h3>Insurance classification</h3>
                    <div className="segmented">
                      <button
                        aria-pressed={draft.job.insuranceRelated}
                        onClick={() => jobChange("insuranceRelated", true)}
                      >
                        Insurance related
                      </button>
                      <button
                        aria-pressed={!draft.job.insuranceRelated}
                        onClick={() => jobChange("insuranceRelated", false)}
                      >
                        Non-insurance
                      </button>
                    </div>
                    {!draft.job.insuranceRelated ? (
                      <p className="inline-warning">
                        Non-insurance changes require 100% payment before work
                        starts.
                      </p>
                    ) : null}
                    <div className="fields two">
                      <Field
                        label="Insurance carrier"
                        required={draft.job.insuranceRelated}
                        value={draft.job.carrier}
                        onChange={(v) => jobChange("carrier", v)}
                      />
                      <Field
                        label="Claim number"
                        required={draft.job.insuranceRelated}
                        value={draft.job.claim}
                        onChange={(v) => jobChange("claim", v)}
                      />
                    </div>
                  </div>
                </section>
                <section className="panel details-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Contract & schedule</h2>
                      <p>
                        Confirm the signed contract amount; the estimate is a
                        starting point.
                      </p>
                    </div>
                  </div>
                  <div className="fields three">
                    <Field
                      label="Original contract ($)"
                      required
                      value={draft.job.originalContract}
                      onChange={(v) => jobChange("originalContract", v)}
                    />
                    <Field
                      label="Previous authorized changes ($)"
                      required
                      help="Use a negative amount for previous credits."
                      value={draft.job.previousChanges}
                      onChange={(v) => jobChange("previousChanges", v)}
                    />
                    <Field
                      label="Added working days"
                      required
                      value={draft.job.addedDays}
                      onChange={(v) => jobChange("addedDays", v)}
                    />
                  </div>
                  <div className="contract-summary">
                    <span>
                      This change order{" "}
                      <strong
                        className={
                          net !== null && net < 0 ? "credit" : "accent"
                        }
                      >
                        {net === null ? "—" : signedMoney(net)}
                      </strong>
                    </span>
                    <span>
                      Revised contract{" "}
                      <strong>
                        {net !== null &&
                        validDecimal(draft.job.originalContract) &&
                        validDecimal(draft.job.previousChanges, true)
                          ? money(
                              (() => {
                                return (
                                  cents(draft.job.originalContract) +
                                  cents(draft.job.previousChanges) +
                                  net
                                );
                              })(),
                            )
                          : "—"}
                      </strong>
                    </span>
                  </div>
                  <label className="field">
                    <span>
                      Scope summary <b>*</b>
                    </span>
                    <textarea
                      rows={5}
                      value={scopeText(draft)}
                      onChange={(e) =>
                        update((d) => ({
                          ...d,
                          scope: e.target.value,
                          scopeEdited: true,
                        }))
                      }
                    />
                    <small>
                      The summary appears on the form. Longer text continues in
                      Attachment A.
                    </small>
                  </label>
                  <button
                    className="text-button"
                    onClick={() =>
                      update((d) => ({ ...d, scopeEdited: false, scope: "" }))
                    }
                  >
                    Rebuild summary from changed items
                  </button>
                </section>
                <section className="panel details-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Branch information</h2>
                      <p>Confirm the contact details used on the document.</p>
                    </div>
                  </div>
                  <div className="fields two">
                    <Field
                      label="Branch name"
                      required
                      value={draft.job.branchName}
                      onChange={(v) => jobChange("branchName", v)}
                    />
                    <Field
                      label="Branch contact / contractor"
                      required
                      value={draft.job.branchContact}
                      onChange={(v) => jobChange("branchContact", v)}
                    />
                    <Field
                      label="Branch address"
                      required
                      value={draft.job.branchAddress}
                      onChange={(v) => jobChange("branchAddress", v)}
                    />
                    <Field
                      label="Branch phone"
                      required
                      value={draft.job.branchPhone}
                      onChange={(v) => jobChange("branchPhone", v)}
                    />
                  </div>
                </section>
              </>
            ) : null}
            {draft.step === 3 ? (
              <Suspense
                fallback={
                  <div className="empty">Loading document generator…</div>
                }
              >
                <Preview draft={draft} />
              </Suspense>
            ) : null}
            <div className="step-footer">
              <span className="muted">
                {draft.step === 0
                  ? "Review source values before using them."
                  : draft.step === 1
                    ? "Credits are negative. Additions are positive."
                    : draft.step === 2
                      ? "Required fields are marked with *."
                      : "Prepared for owner and contractor signatures."}
              </span>
              <div className="button-row">
                {draft.step > 0 ? (
                  <button className="button" onClick={() => go(draft.step - 1)}>
                    <ArrowLeft size={16} />
                    Back
                  </button>
                ) : null}
                {draft.step < 3 ? (
                  <button
                    className="button primary"
                    disabled={!!busy}
                    onClick={() => {
                      if (draft.step === 2) {
                        const errors = validationErrors(draft);
                        if (errors.length) {
                          setError(errors.join(" "));
                          return;
                        }
                      }
                      go(draft.step + 1);
                    }}
                  >
                    Continue <ArrowRight size={17} />
                  </button>
                ) : (
                  <button className="button" onClick={() => void backHome()}>
                    <FolderOpen size={16} />
                    Back to drafts
                  </button>
                )}
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
