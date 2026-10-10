import { useEffect, useId, useRef, useState } from "react";
import { Camera, FileText, Mic, MicOff, Pencil, Send, X } from "lucide-react";
import { newId, type ChangeRequest, type JobEntry } from "../types";
import { createRequest, createRequestedChange } from "../services/requests";
import {
  blobToBase64,
  saveRequest,
  transitionRequest,
  uploadAttachment,
} from "../services/storage";
import PhotoAnnotator from "./PhotoAnnotator";
import "./SimpleRequest.css";

export interface SimpleRequestProps {
  /** The admin-managed customer/job directory. */
  jobs: JobEntry[];
  /** Called after the request was sent; the message is shown on the dashboard. */
  onDone: (message: string) => void;
}

/** One photo the PM added, with its annotated replacement once edited. */
interface PhotoEntry {
  id: string;
  file: File;
  /** Annotated JPEG after the editor is used; the original File until then. */
  blob: Blob;
  /** True once the PM saved a markup, so the tile can say so. */
  edited: boolean;
}

/*
 * Minimal Speech Recognition surface. It is declared locally so the browser
 * API's vendor shape never leaks an `any` into this component's exports.
 */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognition(): SpeechRecognitionConstructor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const NO_MICROPHONE =
  "Microphone access is blocked. Allow the microphone for this site, or type the note.";

const VOICE_ERRORS: Record<string, string | undefined> = {
  "not-allowed": NO_MICROPHONE,
  "service-not-allowed": NO_MICROPHONE,
  "audio-capture":
    "No microphone was found on this device — type the note instead.",
  "no-speech": "No speech was heard. Tap the microphone and try again.",
  network: "Voice input lost its network connection — type the note instead.",
};

/**
 * Builds the request body. `base` is the request already saved by a previous
 * attempt, so a retry keeps the same id and contract revision instead of
 * creating a second request.
 */
function buildRequest(
  base: ChangeRequest | null,
  details: { job: JobEntry | null; customer: string; note: string },
): ChangeRequest {
  const request = base ?? createRequest();
  const description = details.note.trim();
  return {
    ...request,
    updatedAt: new Date().toISOString(),
    status: "draft",
    submittedAt: null,
    job: {
      ...request.job,
      customer: details.customer,
      address: details.job?.address ?? "",
      jobNumber: details.job?.jobNumber ?? "",
      projectManager: details.job?.projectManager ?? "",
      // Only copy the directory's contract amount when it carries one, so a
      // blank entry never wipes an amount the request already holds.
      ...(details.job?.contractAmount
        ? { originalContract: details.job.contractAmount }
        : {}),
    },
    requestedChanges: description
      ? [
          {
            ...createRequestedChange(),
            description,
            room: "",
            action: "add",
          },
        ]
      : [],
    ...(details.job ? { jobDirectoryId: details.job.id } : {}),
  };
}

function PhotoTile({
  photo,
  index,
  disabled,
  onEdit,
  onRemove,
}: {
  photo: PhotoEntry;
  index: number;
  disabled: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [url, setUrl] = useState("");
  // The object URL lives and dies with this tile, so removing a photo, saving a
  // markup, or leaving the page always releases it.
  useEffect(() => {
    const next = URL.createObjectURL(photo.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo.blob]);
  return (
    <li className="sr-photo">
      {url ? (
        <img src={url} alt={`Photo ${index + 1}`} />
      ) : (
        <span className="sr-photo-empty" aria-hidden="true" />
      )}
      {photo.edited ? <span className="sr-photo-tag">Marked up</span> : null}
      <span className="sr-photo-actions">
        <button
          type="button"
          className="button sr-photo-action"
          disabled={disabled}
          aria-label={`Edit photo ${index + 1}`}
          onClick={() => onEdit(photo.id)}
        >
          <Pencil size={16} />
          Edit
        </button>
        <button
          type="button"
          className="button sr-photo-action"
          disabled={disabled}
          aria-label={`Remove photo ${index + 1}`}
          onClick={() => onRemove(photo.id)}
        >
          <X size={16} />
          Remove
        </button>
      </span>
    </li>
  );
}

export default function SimpleRequest(
  props: SimpleRequestProps,
): React.ReactElement {
  const { jobs, onDone } = props;
  // Only active directory rows are offered; without any, the page falls back to
  // a typed customer name so it still works.
  const directoryJobs = jobs.filter((job) => job.active);
  const customerId = useId();
  const noteId = useId();
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  // The request + revision from a failed attempt, reused by the retry.
  const savedAttempt = useRef<{
    request: ChangeRequest;
    revision: number;
  } | null>(null);

  const [jobId, setJobId] = useState("");
  const [typedCustomer, setTypedCustomer] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [contentError, setContentError] = useState("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceNote, setVoiceNote] = useState<{
    tone: "error" | "info";
    text: string;
  } | null>(null);
  // Voice is only an accelerator: an unsupported browser hides the microphone
  // and the textarea keeps working.
  const [voiceSupported] = useState(() => speechRecognition() !== null);

  const selectedJob = directoryJobs.find((job) => job.id === jobId) ?? null;
  const editing = photos.find((photo) => photo.id === editingId) ?? null;
  const fallbackCustomer = !directoryJobs.length;

  useEffect(
    () => () => {
      const instance = recognition.current;
      recognition.current = null;
      try {
        instance?.abort();
      } catch {
        // The recognizer was already torn down.
      }
    },
    [],
  );

  const addPhotos = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    setContentError("");
    setPhotos((current) => [
      ...current,
      ...images.map((file) => ({
        id: newId(),
        file,
        blob: file as Blob,
        edited: false,
      })),
    ]);
  };

  const removePhoto = (id: string) => {
    setPhotos((current) => current.filter((photo) => photo.id !== id));
    setEditingId((current) => (current === id ? null : current));
  };

  const saveEdited = (id: string, blob: Blob) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id ? { ...photo, blob, edited: true } : photo,
      ),
    );
    setEditingId(null);
  };

  const stopListening = () => {
    const instance = recognition.current;
    recognition.current = null;
    setListening(false);
    setInterim("");
    try {
      instance?.stop();
    } catch {
      // Already stopped.
    }
  };

  const startListening = () => {
    const Recognition = speechRecognition();
    if (!Recognition) return;
    setVoiceNote(null);
    setInterim("");
    try {
      const instance = new Recognition();
      instance.continuous = true;
      instance.interimResults = true;
      instance.lang = "en-US";
      instance.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += transcript;
          else interimText += transcript;
        }
        const addition = finalText.trim();
        // Final speech is appended to whatever is already typed, never over it.
        if (addition)
          setNote((current) =>
            current.trim() ? `${current.trimEnd()} ${addition}` : addition,
          );
        setInterim(interimText);
      };
      instance.onerror = (event) => {
        const code = event.error || "";
        if (code === "aborted") {
          setVoiceNote({ tone: "info", text: "Voice input stopped." });
        } else {
          setVoiceNote({
            tone: "error",
            text:
              VOICE_ERRORS[code] ??
              "Voice input stopped. Type the note instead.",
          });
        }
        setListening(false);
        setInterim("");
      };
      instance.onend = () => {
        setListening(false);
        setInterim("");
      };
      recognition.current = instance;
      instance.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setVoiceNote({
        tone: "error",
        text: "Voice input could not start on this device — type the note instead.",
      });
    }
  };

  const submit = async () => {
    if (busy) return;
    const customer = (selectedJob?.customer ?? typedCustomer).trim();
    const nextCustomerError = customer
      ? ""
      : fallbackCustomer
        ? "Enter the customer or project owner."
        : "Choose a customer from the list.";
    const nextContentError =
      note.trim() || photos.length
        ? ""
        : "Add a note or at least one photo before sending.";
    setCustomerError(nextCustomerError);
    setContentError(nextContentError);
    setSubmitError("");
    if (nextCustomerError || nextContentError) return;
    if (listening) stopListening();
    setBusy(true);
    setProgress("Saving the request…");
    try {
      const prior = savedAttempt.current;
      const request = buildRequest(prior?.request ?? null, {
        job: selectedJob,
        customer,
        note,
      });
      const saved = await saveRequest(request, prior?.revision ?? 0, newId());
      // Keep the saved request and its revision. A later failure retries against
      // this same request instead of creating a duplicate, and re-sending the
      // whole attachment set is acceptable because uploads are idempotent
      // server-side.
      savedAttempt.current = { request: saved, revision: saved.revision };
      const total = photos.length + (pdf ? 1 : 0);
      let done = 0;
      for (const photo of photos) {
        done += 1;
        setProgress(`Uploading photo ${done} of ${total}…`);
        const blob = photo.blob;
        await uploadAttachment(
          saved.id,
          {
            name: photo.file.name,
            mimeType: blob.type || photo.file.type || "image/jpeg",
            size: blob.size,
            kind: "photo",
            data: await blobToBase64(blob),
          },
          newId(),
          newId(),
        );
      }
      if (pdf) {
        done += 1;
        setProgress(`Uploading ${pdf.name}…`);
        await uploadAttachment(
          saved.id,
          {
            name: pdf.name,
            // A PM attachment is a document, never an "estimate": attaching one
            // must not trigger estimate extraction.
            mimeType: pdf.type || "application/pdf",
            size: pdf.size,
            kind: "document",
            data: await blobToBase64(pdf),
          },
          newId(),
          newId(),
        );
      }
      setProgress("Submitting to estimating…");
      await transitionRequest(
        saved.id,
        saved.revision,
        "submitted",
        "",
        newId(),
      );
      savedAttempt.current = null;
      onDone(
        `Sent to estimating: ${customer}${selectedJob?.jobNumber ? ` · job ${selectedJob.jobNumber}` : ""}.`,
      );
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "The request could not be sent. Check the connection and try again.",
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <>
      <form
        className="simple-request"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header className="sr-head">
          <h1>Quick request</h1>
          <p className="sr-help">
            Send a change to estimating. A note or one photo is enough.
          </p>
        </header>

        <section className="sr-section">
          <h2 className="sr-section-title">Customer</h2>
          {fallbackCustomer ? (
            <>
              <label className="sr-label" htmlFor={customerId}>
                Customer / project owner
              </label>
              <input
                id={customerId}
                className="sr-input"
                type="text"
                value={typedCustomer}
                disabled={busy}
                aria-label="Customer / project owner"
                aria-required="true"
                aria-invalid={Boolean(customerError)}
                onChange={(event) => {
                  setTypedCustomer(event.target.value);
                  setCustomerError("");
                }}
              />
            </>
          ) : (
            <>
              <label className="sr-label" htmlFor={customerId}>
                Customer
              </label>
              <select
                id={customerId}
                className="sr-select"
                value={jobId}
                disabled={busy}
                aria-label="Customer"
                aria-required="true"
                aria-invalid={Boolean(customerError)}
                onChange={(event) => {
                  setJobId(event.target.value);
                  setCustomerError("");
                }}
              >
                <option value="">Select a job…</option>
                {directoryJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {`${job.customer || "No customer name"} — ${job.jobNumber || "no job number"}`}
                  </option>
                ))}
              </select>
              {selectedJob ? (
                <dl className="sr-summary">
                  <div>
                    <dt>Customer</dt>
                    <dd>{selectedJob.customer || "—"}</dd>
                  </div>
                  <div>
                    <dt>Job number</dt>
                    <dd>{selectedJob.jobNumber || "—"}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{selectedJob.address || "—"}</dd>
                  </div>
                  <div>
                    <dt>Project manager</dt>
                    <dd>{selectedJob.projectManager || "—"}</dd>
                  </div>
                </dl>
              ) : null}
            </>
          )}
          {customerError ? (
            <p className="sr-error" role="alert">
              {customerError}
            </p>
          ) : null}
        </section>

        <section className="sr-section">
          <h2 className="sr-section-title">Photos</h2>
          <p className="sr-help">
            Take a photo or pick one from the phone. Mark up a photo to point at
            the work.
          </p>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            aria-label="Add photos"
            disabled={busy}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              addPhotos(files);
            }}
          />
          <button
            type="button"
            className="button primary sr-wide"
            disabled={busy}
            onClick={() => photoInput.current?.click()}
          >
            <Camera size={19} />
            Add photos
          </button>
          {photos.length ? (
            <ul className="sr-photo-grid">
              {photos.map((photo, index) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  index={index}
                  disabled={busy}
                  onEdit={setEditingId}
                  onRemove={removePhoto}
                />
              ))}
            </ul>
          ) : null}
        </section>

        <section className="sr-section">
          <h2 className="sr-section-title">What changed?</h2>
          <label className="sr-label" htmlFor={noteId}>
            What changed?
          </label>
          <textarea
            id={noteId}
            className="sr-textarea"
            rows={5}
            value={note}
            disabled={busy}
            aria-label="What changed?"
            placeholder="e.g. Added insulation to the open kitchen wall"
            onChange={(event) => {
              setNote(event.target.value);
              setContentError("");
            }}
          />
          {voiceSupported ? (
            <button
              type="button"
              className={`button sr-mic${listening ? " is-listening" : ""}`}
              aria-pressed={listening}
              disabled={busy}
              onClick={() => (listening ? stopListening() : startListening())}
            >
              {listening ? <MicOff size={20} /> : <Mic size={20} />}
              {listening ? "Stop listening" : "Speak the note"}
            </button>
          ) : (
            <p className="sr-help">
              Voice input is not available in this browser — type your note
              instead.
            </p>
          )}
          {listening ? (
            <p className="sr-listening" aria-live="polite">
              <span className="sr-listening-dot" aria-hidden="true" />
              Listening…{interim ? <em>{interim}</em> : null}
            </p>
          ) : null}
          {voiceNote ? (
            <p
              className={voiceNote.tone === "error" ? "sr-error" : "sr-help"}
              role={voiceNote.tone === "error" ? "alert" : "status"}
            >
              {voiceNote.text}
            </p>
          ) : null}
          {contentError ? (
            <p className="sr-error" role="alert">
              {contentError}
            </p>
          ) : null}
        </section>

        <section className="sr-section">
          <h2 className="sr-section-title">
            PDF <span className="sr-optional">Optional</span>
          </h2>
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            aria-label="Attach a PDF"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (file) setPdf(file);
            }}
          />
          {pdf ? (
            <span className="sr-file-row">
              <FileText size={18} />
              <span className="sr-file-name">{pdf.name}</span>
              <button
                type="button"
                className="button"
                disabled={busy}
                aria-label={`Remove ${pdf.name}`}
                onClick={() => setPdf(null)}
              >
                <X size={17} />
                Remove
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="button sr-wide"
              disabled={busy}
              onClick={() => pdfInput.current?.click()}
            >
              <FileText size={18} />
              Attach a PDF
            </button>
          )}
        </section>

        <div className="sr-submit">
          {submitError ? (
            <p className="sr-error" role="alert">
              {submitError}
            </p>
          ) : null}
          {progress ? (
            <p className="sr-help" aria-live="polite">
              {progress}
            </p>
          ) : null}
          <button
            type="submit"
            className="button primary sr-submit-button"
            disabled={busy}
          >
            <Send size={19} />
            {busy ? "Sending…" : "Send to estimating"}
          </button>
        </div>
      </form>
      {editing ? (
        <PhotoAnnotator
          file={editing.file}
          onSave={(blob) => saveEdited(editing.id, blob)}
          onCancel={() => setEditingId(null)}
        />
      ) : null}
    </>
  );
}
