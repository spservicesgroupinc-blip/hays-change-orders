import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  FolderOpen,
  Hourglass,
  Inbox,
  Plus,
  Search,
  Send,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  newId,
  type AttachmentKind,
  type ChangeRequest,
  type DraftSummary,
  type JobDetails,
  type JobEntry,
  type PendingUpload,
  type RequestAttachment,
  type RequestStatus,
  type RequestSummary,
} from "./types";
import { createRequest, requestToDraft } from "./services/requests";
import { applyDirectoryContractAmountForPmRequest } from "./services/jobDirectory";
import {
  blobToBase64,
  claimRequest,
  completeRequest as finalizeRequest,
  convertLegacyRequest,
  fetchAttachment,
  loadDashboard,
  openRequest,
  transitionRequest,
  uploadAttachment,
} from "./services/storage";
import {
  RequestEditor,
  listRecoveries,
  persistRecovery,
} from "./services/requestEditor";
import {
  HOME,
  destinationToView,
  hashToView,
  initialView,
  persistView,
  sameView,
  viewToHash,
  writeHistory,
  type NavDestination,
  type View,
} from "./services/navigation";
import AppHeader from "./components/AppHeader";
import PMRequestForm, { IntakeReceipt } from "./components/PMRequestForm";
import EstimatorWorkspace from "./components/EstimatorWorkspace";
import ChangeOrders from "./components/ChangeOrders";
import DashNoteButton from "./components/DashNoteButton";
import AdminJobs from "./components/AdminJobs";
import LegacyWorkspace from "./LegacyWorkspace";
import PdfViewer from "./components/PdfViewer";
import InstallApp from "./components/InstallApp";
import "./app.css";

const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  submitted: "In queue",
  in_review: "In review",
  needs_information: "Needs info",
  ready: "Ready",
  completed: "Completed",
};
// Home dashboard tiles double as status filters for the request queue.
type StatKey = RequestStatus | "all";
const STAT_TILES: {
  key: StatKey;
  label: string;
  tone: string;
  icon: ReactElement;
}[] = [
  {
    key: "all",
    label: "All requests",
    tone: "all",
    icon: <Inbox size={16} />,
  },
  {
    key: "needs_information",
    label: "Needs info",
    tone: "attention",
    icon: <TriangleAlert size={16} />,
  },
  {
    key: "submitted",
    label: "In queue",
    tone: "queue",
    icon: <Hourglass size={16} />,
  },
  {
    key: "in_review",
    label: "In review",
    tone: "review",
    icon: <ClipboardList size={16} />,
  },
  {
    key: "ready",
    label: "Ready",
    tone: "ready",
    icon: <BadgeCheck size={16} />,
  },
  {
    key: "completed",
    label: "Completed",
    tone: "done",
    icon: <CheckCircle2 size={16} />,
  },
];

function SubmittedReview({
  request,
  claimName,
  onClaimName,
  onClaim,
  onBack,
  onPreview,
  busy,
}: {
  request: ChangeRequest;
  claimName: string;
  onClaimName: (value: string) => void;
  onClaim: () => void;
  onBack: () => void;
  onPreview: (attachment: RequestAttachment) => void;
  busy: boolean;
}) {
  return (
    <div className="shell-claim shell-review">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        Back to requests
      </button>
      <IntakeReceipt request={request} onPreview={onPreview} />
      <div className="shell-claim-card">
        <div className="empty-icon">
          <Send size={26} />
        </div>
        <h2>Estimator? Claim this request to price it.</h2>
        <p>
          <strong>{request.job.customer || "Unnamed project"}</strong>
          {request.job.jobNumber ? ` · ${request.job.jobNumber}` : ""}
          <br />
          {request.requestedChanges.length} requested{" "}
          {request.requestedChanges.length === 1 ? "change" : "changes"} ·{" "}
          {request.attachments.length} attachment
          {request.attachments.length === 1 ? "" : "s"}
        </p>
        <label className="field shell-claim-field">
          <span>Your name</span>
          <input
            aria-label="Estimator name"
            value={claimName}
            placeholder="Enter your name to claim this request"
            onChange={(event) => onClaimName(event.target.value)}
          />
        </label>
        <button
          className="button primary large full"
          disabled={!claimName.trim() || busy}
          onClick={onClaim}
        >
          <CheckCircle2 size={17} />
          {busy ? "Claiming…" : "Claim this request"}
        </button>
      </div>
    </div>
  );
}

function AttachmentPreview({
  preview,
  onClose,
}: {
  preview: { name: string; blob: Blob } | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!preview) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(preview.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [preview]);
  // Escape is the desktop twin of the phone's back gesture, which the shell
  // already routes to onClose.
  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onClose]);
  if (!preview) return null;
  return (
    <div
      className="shell-modal"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="shell-modal-box"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shell-modal-head">
          <strong>{preview.name}</strong>
          <button
            className="icon-button"
            aria-label="Close preview"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="shell-modal-body">
          {preview.blob.type.startsWith("image/") ? (
            <img src={url} alt={preview.name} />
          ) : (
            <PdfViewer blob={preview.blob} label={preview.name} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setViewState] = useState<View>(initialView);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [legacyDrafts, setLegacyDrafts] = useState<DraftSummary[]>([]);
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  // refresh() loads the directory asynchronously, so an editor that opens
  // before the jobs arrive reads the latest list through this ref instead of a
  // stale closure.
  const jobsRef = useRef<JobEntry[]>([]);
  jobsRef.current = jobs;
  const [ready, setReady] = useState(false);
  const [bootSlow, setBootSlow] = useState(false);
  const [listError, setListError] = useState("");
  const [openError, setOpenError] = useState("");
  const [homeSearch, setHomeSearch] = useState("");
  const [homeStatus, setHomeStatus] = useState<StatKey>("all");
  const [legacySearch, setLegacySearch] = useState("");
  const [converting, setConverting] = useState("");

  const [request, setRequest] = useState<ChangeRequest | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [preview, setPreview] = useState<{ name: string; blob: Blob } | null>(
    null,
  );
  const [claimName, setClaimName] = useState("");
  // Requests this window is working on as the estimator. A request waiting on
  // the project manager stays in the estimator workspace here instead of
  // dropping the estimator into the project manager's edit form.
  const [estimatorSession, setEstimatorSession] = useState<
    Record<string, true>
  >({});
  const editorRef = useRef<RequestEditor | null>(null);
  const flushTimer = useRef<number | null>(null);
  const pendingFiles = useRef(
    new Map<string, { file: File; kind: AttachmentKind; quoteId?: string }>(),
  );
  const mainRef = useRef<HTMLElement>(null);
  // A preview is pushed onto the history stack so the phone's back gesture
  // closes it. The two flags keep that bookkeeping off the routing path.
  const previewEntry = useRef(false);
  const suppressPop = useRef(false);

  const viewRef = useRef(view);
  viewRef.current = view;
  const previewRef = useRef(preview);
  previewRef.current = preview;

  /**
   * The single way a view changes: React state, the URL and the stored view
   * move together, so the back gesture, a shared link and a cold start all
   * agree on where the user is.
   */
  const navigateTo = useCallback(
    (next: View, mode: "push" | "replace" = "push") => {
      viewRef.current = next;
      setViewState(next);
      persistView(next);
      writeHistory(next, mode);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const data = await loadDashboard();
      setRequests(data.requests);
      setLegacyDrafts(data.drafts);
      setJobs(data.jobs);
      setListError("");
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    await editorRef.current?.flush();
  }, []);

  /** Drop everything that belonged to the request editor being left behind. */
  const closeEditor = useCallback(() => {
    setRequest(null);
    editorRef.current = null;
    setPendingUploads([]);
    pendingFiles.current.clear();
    setOpenError("");
  }, []);

  /**
   * Leave whatever is on screen for another view. The editor is flushed in the
   * background so a fast tap on Back never waits on the network, but nothing
   * typed is lost either.
   */
  const goTo = useCallback(
    (next: View, mode: "push" | "replace" = "push") => {
      void flush();
      navigateTo(next, mode);
      if (next.kind !== "request") {
        closeEditor();
        setPreview(null);
        previewEntry.current = false;
      }
      if (next.kind === "home") void refresh();
    },
    [closeEditor, flush, navigateTo, refresh],
  );

  const navigate = useCallback(
    (destination: NavDestination) => goTo(destinationToView(destination)),
    [goTo],
  );

  const goHome = useCallback(() => goTo(HOME), [goTo]);

  const closePreview = useCallback(() => {
    if (!previewRef.current) return;
    setPreview(null);
    if (!previewEntry.current) return;
    // Remove the entry the preview pushed so one back gesture leaves the
    // request rather than closing a dialog that is already gone.
    previewEntry.current = false;
    suppressPop.current = true;
    window.history.back();
  }, []);

  useEffect(() => {
    // The current entry becomes the dashboard, so backing out of a restored
    // deep link lands on the request list instead of leaving the app.
    const initial = viewRef.current;
    window.history.replaceState(null, "", viewToHash(HOME));
    if (!sameView(initial, HOME))
      window.history.pushState(null, "", viewToHash(initial));

    void refresh().finally(() => setReady(true));
    if (initial.kind === "request") void openRequestById(initial.id);
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (suppressPop.current) {
        suppressPop.current = false;
        return;
      }
      // An open preview owns the entry it pushed: back closes the file first.
      if (previewRef.current) {
        previewEntry.current = false;
        setPreview(null);
        return;
      }
      const next = hashToView(window.location.hash) ?? HOME;
      if (sameView(next, viewRef.current)) return;
      if (next.kind === "request") {
        void flush();
        setRequest(null);
        navigateTo(next, "replace");
        setOpenError("");
        void openRequestById(next.id);
        return;
      }
      goTo(next, "replace");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [flush, goTo, navigateTo]);

  // A view change is a page change: start at the top and let a screen reader
  // follow the new content instead of silently staying on the old heading.
  const viewKey = view.kind === "request" ? `request:${view.id}` : view.kind;
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [viewKey]);

  // Never leave someone staring at a spinner: offer a retry if boot stalls.
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setBootSlow(true), 6000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  // The directory arrives after the request list, so a request opened from the
  // queue (or restored on boot) may have been opened before its job's "Estimate
  // Amount" was known. Fill it in once the jobs list lands. Idempotent: the
  // helper returns the same request when nothing changed, and only PM-stage
  // requests are considered, so this never edits a completed/locked order.
  useEffect(() => {
    applyDirectoryAmount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  // A PM who types the job number by hand never opens the picker, so the amount
  // has to arrive while the form is open: re-apply whenever the open request or
  // its job number changes. The effect settles after one application — neither
  // the request id nor the job number changes when the amount is patched in, and
  // the jobs list keeps its identity. Blank or partial job numbers match
  // nothing, so a half-typed number never edits the form.
  useEffect(() => {
    applyDirectoryAmount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id, request?.job.jobNumber]);

  function attachEditor(editor: RequestEditor) {
    editorRef.current = editor;
    editor.onUpdate = () => {
      setRequest({ ...editor.current });
      setSaveStatus(editor.status);
      setSaveError(editor.error || editor.recoveryError);
    };
    editor.onUpdate();
  }
  function openEditor(
    data: ChangeRequest,
    recovered?: Awaited<ReturnType<typeof listRecoveries>>[number],
  ) {
    attachEditor(
      new RequestEditor(data, undefined, persistRecovery, recovered),
    );
    setPendingUploads([]);
    pendingFiles.current.clear();
    setSaveError("");
    setBusy("");
    setClaimName("");
    setOpenError("");
    navigateTo({ kind: "request", id: data.id });
    // Every editor open funnels through here — a request loaded from the queue
    // (openRequestById, including the request restored on boot) and a converted
    // legacy draft both pick up the directory's original contract amount here.
    applyDirectoryAmount();
  }
  async function openRequestById(id: string) {
    setBusy("Opening request…");
    setOpenError("");
    try {
      const [data, recoveries] = await Promise.all([
        openRequest(id),
        listRecoveries(),
      ]);
      const recovered = recoveries.find((record) => record.request.id === id);
      openEditor(data, recovered);
    } catch (error) {
      // Shown inside the request view: a failed load must never leave the
      // screen on an endless spinner with no way back to the list.
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }
  function newRequest() {
    openEditor(createRequest());
  }
  function scheduleFlush() {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      void editorRef.current?.flush().catch(() => {});
    }, 500);
  }
  function edit(next: ChangeRequest) {
    editorRef.current?.edit(next);
    scheduleFlush();
  }
  function patch(fn: (current: ChangeRequest) => ChangeRequest) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.edit(fn(editor.current));
    scheduleFlush();
  }
  // The customer's original contract is the directory's "Estimate Amount". A
  // request created without the picker — typed job number, older request,
  // converted legacy draft — gets it from here, through the same editor update
  // path as a keystroke so normal autosave persists it. When the helper returns
  // the request unchanged (already filled, blank directory amount, or a
  // submitted/completed request) nothing is edited and nothing is saved.
  function applyDirectoryAmount() {
    const editor = editorRef.current;
    if (!editor) return;
    const next = applyDirectoryContractAmountForPmRequest(
      editor.current,
      jobsRef.current,
    );
    if (next === editor.current) return;
    patch(() => next);
  }

  async function submitRequest() {
    const editor = editorRef.current;
    if (!editor) return;
    setBusy("Submitting…");
    setSaveError("");
    try {
      await flush();
      const server = await transitionRequest(
        editor.current.id,
        editor.current.revision,
        "submitted",
        "",
        newId(),
      );
      editor.commit(server);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }
  async function claim() {
    const editor = editorRef.current;
    if (!editor || !claimName.trim()) return;
    setBusy("Claiming…");
    setSaveError("");
    try {
      const server = await claimRequest(
        editor.current.id,
        editor.current.revision,
        claimName.trim(),
        newId(),
      );
      editor.commit(server);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }
  async function askInformation(question: string) {
    const editor = editorRef.current;
    if (!editor) return;
    setBusy("Sending request…");
    setSaveError("");
    try {
      await flush();
      const server = await transitionRequest(
        editor.current.id,
        editor.current.revision,
        "needs_information",
        question,
        newId(),
      );
      editor.commit(server);
      setEstimatorSession((map) => ({ ...map, [server.id]: true }));
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }
  async function markReady() {
    const editor = editorRef.current;
    if (!editor) return;
    setBusy("Preparing documents…");
    setSaveError("");
    try {
      await flush();
      const server = await transitionRequest(
        editor.current.id,
        editor.current.revision,
        "ready",
        "",
        newId(),
      );
      editor.commit(server);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }
  async function completeRequest() {
    const editor = editorRef.current;
    if (!editor) return;
    setBusy("Storing final documents…");
    setSaveError("");
    try {
      await flush();
      const request = editor.current;
      const draft = requestToDraft(request);
      const { generateDocuments, documentStem } = await import(
        "./services/pdfGenerate"
      );
      const docs = await generateDocuments(draft);
      const stem = documentStem(draft);
      const documents = await Promise.all(
        (
          [
            ["Combined", docs.combined],
            ["Cover", docs.form],
            ["Attachment_A", docs.attachment],
          ] as const
        ).map(async ([label, blob]) => ({
          name: `${stem}_${label}.pdf`,
          mimeType: "application/pdf",
          size: blob.size,
          data: await blobToBase64(blob),
        })),
      );
      const server = await finalizeRequest(
        request.id,
        request.revision,
        documents,
        newId(),
      );
      editor.commit(server);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  function addPending(file: File, kind: AttachmentKind, quoteId?: string) {
    const id = newId();
    pendingFiles.current.set(id, { file, kind, quoteId });
    setPendingUploads((list) => [
      ...list,
      { id, name: file.name, state: "uploading" },
    ]);
    return id;
  }
  async function runUpload(
    id: string,
    entry: { file: File; kind: AttachmentKind; quoteId?: string },
  ) {
    const editor = editorRef.current;
    if (!editor) return;
    setPendingUploads((list) =>
      list.map((item) =>
        item.id === id
          ? { ...item, state: "uploading", error: undefined }
          : item,
      ),
    );
    try {
      await flush();
      const { file, kind, quoteId } = entry;
      const mimeType =
        file.type || (kind === "photo" ? "image/jpeg" : "application/pdf");
      const base64 = await blobToBase64(file);
      const attachment = await uploadAttachment(
        editor.current.id,
        { name: file.name, mimeType, size: file.size, kind, data: base64 },
        id,
        newId(),
      );
      if (kind === "estimate") {
        setBusy("Reading the estimate…");
        try {
          const { extractEstimate } = await import("./services/pdfExtract");
          const result = await extractEstimate(file, (message) =>
            setBusy(message),
          );
          patch((current) => ({
            ...current,
            attachments: [...current.attachments, attachment],
            estimateAttachmentId: attachment.id,
            estimate: result.items,
            extractionWarnings: result.warnings,
            job: {
              ...current.job,
              ...Object.fromEntries(
                Object.entries(result.job).filter(
                  ([key]) =>
                    !String(current.job[key as keyof JobDetails] ?? "").trim(),
                ),
              ),
            },
          }));
        } finally {
          setBusy("");
        }
      } else if (kind === "quote" && quoteId) {
        patch((current) => ({
          ...current,
          attachments: [...current.attachments, attachment],
          quotes: current.quotes.map((quote) =>
            quote.id === quoteId
              ? {
                  ...quote,
                  attachmentIds: [...quote.attachmentIds, attachment.id],
                }
              : quote,
          ),
        }));
      } else {
        patch((current) => ({
          ...current,
          attachments: [...current.attachments, attachment],
        }));
      }
      pendingFiles.current.delete(id);
      setPendingUploads((list) => list.filter((item) => item.id !== id));
    } catch (error) {
      setPendingUploads((list) =>
        list.map((item) =>
          item.id === id
            ? {
                ...item,
                state: "failed",
                error:
                  error instanceof Error ? error.message : "Upload failed.",
              }
            : item,
        ),
      );
    }
  }
  async function handleUpload(
    files: File[],
    kind: AttachmentKind,
    quoteId?: string,
  ) {
    for (const file of files) {
      const id = addPending(file, kind, quoteId);
      const entry = pendingFiles.current.get(id);
      if (entry) void runUpload(id, entry);
    }
  }
  function retryUpload(id: string) {
    const entry = pendingFiles.current.get(id);
    if (entry) void runUpload(id, entry);
  }
  function removePendingUpload(id: string) {
    pendingFiles.current.delete(id);
    setPendingUploads((list) => list.filter((item) => item.id !== id));
  }
  function removeAttachment(id: string) {
    patch((current) => {
      const isEstimate = current.estimateAttachmentId === id;
      return {
        ...current,
        attachments: current.attachments.filter((item) => item.id !== id),
        quotes: current.quotes.map((quote) => ({
          ...quote,
          attachmentIds: quote.attachmentIds.filter((value) => value !== id),
        })),
        estimate: isEstimate ? [] : current.estimate,
        estimateAttachmentId: isEstimate ? null : current.estimateAttachmentId,
        requestedChanges: isEstimate
          ? current.requestedChanges.map((change) => ({
              ...change,
              estimateItemIds: [],
            }))
          : current.requestedChanges,
      };
    });
  }
  async function previewAttachment(attachment: RequestAttachment) {
    const editor = editorRef.current;
    if (!editor) return;
    setBusy("Opening file…");
    try {
      const result = await fetchAttachment(editor.current.id, attachment.id);
      setPreview({ name: result.name, blob: result.blob });
      // One extra history entry: the back gesture closes the file preview
      // before it leaves the request.
      if (!previewEntry.current) {
        previewEntry.current = true;
        window.history.pushState(null, "", window.location.hash);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }
  async function convert(id: string) {
    setConverting(id);
    setListError("");
    try {
      const converted = await convertLegacyRequest(id, newId());
      openEditor(converted);
      void refresh();
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setConverting("");
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<RequestStatus, number> = {
      draft: 0,
      submitted: 0,
      in_review: 0,
      needs_information: 0,
      ready: 0,
      completed: 0,
    };
    for (const item of requests) counts[item.status] += 1;
    return counts;
  }, [requests]);
  const filteredRequests = requests.filter(
    (item) =>
      (homeStatus === "all" || item.status === homeStatus) &&
      `${item.job.customer} ${item.job.jobNumber} ${item.job.projectManager}`
        .toLowerCase()
        .includes(homeSearch.toLowerCase()),
  );
  const filteredLegacy = legacyDrafts.filter((item) =>
    `${item.job.customer} ${item.job.jobNumber}`
      .toLowerCase()
      .includes(legacySearch.toLowerCase()),
  );

  if (!ready)
    return (
      <div className="boot">
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
        {bootSlow ? (
          <>
            <p>
              The connection to the shared sheet is taking longer than usual.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                onClick={() => void refresh().finally(() => setReady(true))}
              >
                Try again
              </button>
              <button
                className="button"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="spinner" />
            <p>Opening your change orders…</p>
          </>
        )}
      </div>
    );

  // The legacy workspace owns its own header because it owns the draft state
  // behind the extra "My drafts" control.
  if (view.kind === "legacy")
    return (
      <>
        <InstallApp />
        <LegacyWorkspace
          startNew={view.startNew}
          converting={Boolean(converting)}
          onNavigate={navigate}
          onConvert={convert}
        />
      </>
    );

  const back =
    view.kind === "home"
      ? undefined
      : view.kind === "request"
        ? { label: "All requests", onClick: goHome }
        : { label: "Back to requests", onClick: goHome };
  const subtitle =
    view.kind === "request"
      ? request
        ? `${request.job.customer || "Untitled request"}${
            request.job.jobNumber ? ` · ${request.job.jobNumber}` : ""
          } · ${STATUS_LABELS[request.status]}`
        : "Loading request…"
      : undefined;

  return (
    <div className="app-shell">
      <AppHeader
        current={view.kind}
        onNavigate={navigate}
        back={back}
        subtitle={subtitle}
        hideHomeNav={view.kind === "request"}
        busy={busy}
      />
      <InstallApp />
      {listError ? (
        <div className="storage-error" role="alert">
          <X size={18} />
          <span>
            <strong>Could not load requests.</strong> {listError}
          </span>
          <button className="button small" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}
      {view.kind === "orders" ? (
        <main className="shell-page" ref={mainRef} tabIndex={-1}>
          <ChangeOrders
            requests={requests}
            onOpen={(id) => void openRequestById(id)}
          />
        </main>
      ) : view.kind === "jobs" ? (
        <main className="shell-page" ref={mainRef} tabIndex={-1}>
          <AdminJobs jobs={jobs} onImported={setJobs} />
        </main>
      ) : view.kind === "request" ? (
        <main className="shell-request" ref={mainRef} tabIndex={-1}>
          {saveError ? (
            <div className="storage-error" role="alert">
              <X size={18} />
              <span>
                <strong>The request could not be saved.</strong> {saveError}{" "}
                Your work remains in this window.
              </span>
              <button className="button small" onClick={() => void flush()}>
                Retry
              </button>
            </div>
          ) : null}
          {request ? (
            <div className="request-note-bar">
              <DashNoteButton request={request} />
            </div>
          ) : null}
          {request ? (
            request.status === "submitted" ? (
              <SubmittedReview
                request={request}
                claimName={claimName}
                onClaimName={setClaimName}
                onClaim={() => void claim()}
                onBack={goHome}
                onPreview={(attachment) => void previewAttachment(attachment)}
                busy={busy === "Claiming…"}
              />
            ) : request.status === "draft" ||
              (request.status === "needs_information" &&
                !estimatorSession[request.id]) ? (
              <PMRequestForm
                request={request}
                jobs={jobs}
                onChange={edit}
                pendingUploads={pendingUploads}
                onUpload={handleUpload}
                onRetryUpload={retryUpload}
                onRemovePendingUpload={removePendingUpload}
                onRemoveAttachment={removeAttachment}
                onPreviewAttachment={(attachment) =>
                  void previewAttachment(attachment)
                }
                onSubmit={() => void submitRequest()}
                busy={Boolean(busy)}
                saveStatus={saveStatus}
              />
            ) : (
              <EstimatorWorkspace
                request={request}
                onChange={edit}
                onAskInformation={(question) => void askInformation(question)}
                onReady={() => void markReady()}
                onComplete={() => void completeRequest()}
                onPreviewAttachment={(attachment) =>
                  void previewAttachment(attachment)
                }
                busy={Boolean(busy)}
              />
            )
          ) : openError ? (
            <div className="empty">
              <div className="empty-icon">
                <TriangleAlert size={28} />
              </div>
              <h3>This change order could not be opened.</h3>
              <p>{openError}</p>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => void openRequestById(view.id)}
                >
                  Try again
                </button>
                <button className="button" onClick={goHome}>
                  Back to requests
                </button>
              </div>
            </div>
          ) : (
            <div className="empty">
              <div className="spinner" />
              <p>Loading request…</p>
            </div>
          )}
        </main>
      ) : (
        <main className="home shell-home" ref={mainRef} tabIndex={-1}>
          <header className="ops-head">
            <div className="ops-head-text">
              <span className="eyebrow">Operations dashboard</span>
              <h1>Change orders</h1>
              <p>
                Project managers log what changed on the job. Estimating
                confirms pricing and prepares the customer documents.
              </p>
            </div>
            <div className="ops-head-actions">
              <button className="button primary large" onClick={newRequest}>
                <Plus size={20} />
                New request
              </button>
            </div>
          </header>

          <section className="stat-grid" aria-label="Request status overview">
            {STAT_TILES.map(({ key, label, tone, icon }) => {
              const count = key === "all" ? requests.length : statusCounts[key];
              const active = homeStatus === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`stat-tile tone-${tone}${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setHomeStatus(active ? "all" : key)}
                >
                  <span className="stat-icon">{icon}</span>
                  <span className="stat-value">{count}</span>
                  <span className="stat-label">{label}</span>
                </button>
              );
            })}
          </section>

          {statusCounts.needs_information > 0 &&
          homeStatus !== "needs_information" ? (
            <section className="attention-banner">
              <span className="attention-icon">
                <TriangleAlert size={18} />
              </span>
              <div>
                <strong>
                  {statusCounts.needs_information === 1
                    ? "1 request needs more information."
                    : `${statusCounts.needs_information} requests need more information.`}
                </strong>
                <span>
                  Estimating is waiting on details from the project manager.
                </span>
              </div>
              <button
                className="button small"
                onClick={() => setHomeStatus("needs_information")}
              >
                Review
              </button>
            </section>
          ) : null}

          <section className="draft-section">
            <div className="section-heading">
              <div>
                <h2>
                  Requests{" "}
                  <span className="count">{filteredRequests.length}</span>
                </h2>
                <p>
                  {homeStatus === "all"
                    ? "Live status for every request, from intake to the customer-ready packet."
                    : `Showing ${STATUS_LABELS[homeStatus].toLowerCase()} requests only.`}
                </p>
              </div>
              <div className="section-tools">
                {homeStatus === "all" ? null : (
                  <button
                    className="text-button"
                    onClick={() => setHomeStatus("all")}
                  >
                    <X size={13} />
                    Clear filter
                  </button>
                )}
                {requests.length ? (
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search requests"
                      placeholder="Customer, job, or PM…"
                      value={homeSearch}
                      onChange={(event) => setHomeSearch(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>
            </div>
            {!requests.length ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <FileText size={30} />
                </div>
                <h3>No change requests yet.</h3>
                <p>
                  Requests submitted by project managers land here with live
                  pricing status from estimating.
                </p>
                <button className="button" onClick={newRequest}>
                  <Plus size={16} />
                  Create your first request
                </button>
              </div>
            ) : (
              <div className="request-list">
                {filteredRequests.map((item) => (
                  <button
                    className="request-row"
                    key={item.id}
                    onClick={() => void openRequestById(item.id)}
                  >
                    <span className={`request-status status-${item.status}`}>
                      {STATUS_LABELS[item.status]}
                    </span>
                    <span className="request-row-main">
                      <strong>{item.job.customer || "Untitled request"}</strong>
                      <small>
                        {item.job.jobNumber || "Job pending"} ·{" "}
                        {item.changesCount}{" "}
                        {item.changesCount === 1 ? "change" : "changes"}
                        {item.estimatorName ? ` · ${item.estimatorName}` : ""}
                      </small>
                      {item.status === "needs_information" ? (
                        <span className="request-row-action">
                          Add the requested information
                          <ArrowRight size={13} />
                        </span>
                      ) : null}
                    </span>
                    <span className="request-row-meta">
                      {item.attachmentsCount > 0 ? (
                        <small>
                          {item.attachmentsCount} file
                          {item.attachmentsCount === 1 ? "" : "s"}
                        </small>
                      ) : null}
                      <small>
                        <Clock3 size={12} />
                        {new Date(item.updatedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </small>
                      <ArrowRight size={16} />
                    </span>
                  </button>
                ))}
                {!filteredRequests.length ? (
                  <p className="shell-empty-filter">
                    No requests match this view.
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section className="draft-section shell-legacy">
            <div className="section-heading">
              <div>
                <h2>
                  Legacy change orders{" "}
                  <span className="count">{legacyDrafts.length}</span>
                </h2>
                <p>
                  Drafts from the previous four-step editor. Open to finish, or
                  convert into a shared request.
                </p>
              </div>
            </div>
            <div className="shell-legacy-bar">
              <button
                className="button primary"
                onClick={() =>
                  goTo({ kind: "legacy", startNew: true })
                }
              >
                <Plus size={17} />
                New change order
              </button>
              <button
                className="button"
                onClick={() => goTo({ kind: "legacy", startNew: false })}
              >
                <FolderOpen size={16} />
                Open legacy drafts
              </button>
              {legacyDrafts.length ? (
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search legacy drafts"
                    placeholder="Customer or job…"
                    value={legacySearch}
                    onChange={(event) => setLegacySearch(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            {legacyDrafts.length ? (
              <div className="legacy-row-list">
                {filteredLegacy.map((item) => (
                  <div className="legacy-row" key={item.id}>
                    <span className="legacy-row-main">
                      <strong>{item.job.customer || "Untitled draft"}</strong>
                      <small>
                        {item.job.jobNumber || "Job pending"} ·{" "}
                        {item.changesCount} changed items
                      </small>
                    </span>
                    <button
                      className="button small"
                      onClick={() =>
                        goTo({ kind: "legacy", startNew: false })
                      }
                    >
                      Open
                    </button>
                    <button
                      className="button small primary"
                      disabled={converting === item.id}
                      onClick={() => void convert(item.id)}
                    >
                      {converting === item.id ? "Converting…" : "Convert"}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <footer className="home-footer">
            <ShieldCheck size={15} />
            <span>
              Documents are prepared in your browser and synced through Google
              Sheets and Drive.
            </span>
          </footer>
        </main>
      )}
      <AttachmentPreview preview={preview} onClose={closePreview} />
    </div>
  );
}
