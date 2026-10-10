import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, ClipboardCopy, TriangleAlert } from "lucide-react";
import { copyTextToClipboard, formatDashNote } from "../services/dashNote";
import { openRequest } from "../services/storage";
import type { ChangeRequest } from "../types";
import "./DashNoteButton.css";

const LABELS = {
  idle: "Copy Dash note",
  busy: "Building note…",
  copied: "Copied to clipboard",
  error: "Copy failed — try again",
} as const;

const ANNOUNCEMENTS: Record<keyof typeof LABELS, string> = {
  idle: "",
  busy: "Building the Dash note.",
  copied: "Dash note copied to the clipboard.",
  error: "The Dash note could not be copied. Try again.",
};

type CopyState = keyof typeof LABELS;

/**
 * One-click "summary for Dash": builds a plain-text note for the change order
 * and puts it on the clipboard so it can be pasted into another site.
 */
export default function DashNoteButton({
  request,
  requestId,
}: {
  /** Record already open in this window — used when present so local edits win. */
  request?: ChangeRequest | null;
  /** Fallback for lists that only carry summaries; loaded ahead of the click. */
  requestId?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const primed = useRef<ChangeRequest | null>(null);
  const loading = useRef(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const armReset = useCallback(() => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState("idle"), 2400);
  }, []);

  // Fetch before the click so the clipboard call can stay inside the gesture.
  const prime = useCallback(() => {
    if (request || primed.current || loading.current || !requestId) return;
    loading.current = true;
    void openRequest(requestId)
      .then((record) => {
        primed.current = record;
      })
      .catch(() => {})
      .finally(() => {
        loading.current = false;
      });
  }, [request, requestId]);

  const finish = useCallback(
    async (record: ChangeRequest) => {
      try {
        await copyTextToClipboard(formatDashNote(record));
        setState("copied");
      } catch {
        setState("error");
      }
      armReset();
    },
    [armReset],
  );

  const copy = () => {
    if (state === "busy") return;
    const ready = request ?? primed.current;
    if (ready) {
      // Call straight from the tap so Safari keeps the user activation.
      void finish(ready);
      return;
    }
    if (!requestId) return;
    setState("busy");
    void openRequest(requestId)
      .then((record) => {
        primed.current = record;
        return finish(record);
      })
      .catch(() => {
        setState("error");
        armReset();
      });
  };

  const Icon =
    state === "copied"
      ? ClipboardCheck
      : state === "error"
        ? TriangleAlert
        : ClipboardCopy;

  return (
    <span className="dash-note">
      <button
        type="button"
        className={`button small dash-note-button${
          state === "copied" ? " is-copied" : ""
        }${state === "error" ? " is-error" : ""}`}
        onClick={copy}
        onPointerEnter={prime}
        onFocus={prime}
        disabled={state === "busy"}
        title="Copy a change order summary for Dash"
      >
        <Icon size={14} />
        {LABELS[state]}
      </button>
      <span className="visually-hidden" role="status">
        {ANNOUNCEMENTS[state]}
      </span>
    </span>
  );
}
