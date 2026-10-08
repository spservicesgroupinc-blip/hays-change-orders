import { useEffect, useState } from "react";
import { Download, Printer, FileCheck2 } from "lucide-react";
import type { ChangeOrderDraft } from "../types";
import {
  generateDocuments,
  type GeneratedDocuments,
} from "../services/pdfGenerate";
import {
  money,
  signedMoney,
  totals,
  validationErrors,
} from "../services/pricing";
import PdfViewer from "./PdfViewer";
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export default function Preview({ draft }: { draft: ChangeOrderDraft }) {
  const [documents, setDocuments] = useState<GeneratedDocuments | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"combined" | "form" | "attachment">(
    "combined",
  );
  const [url, setUrl] = useState("");
  const errors = validationErrors(draft);
  useEffect(() => {
    let active = true;
    setDocuments(null);
    setError("");
    if (!errors.length)
      void generateDocuments(draft)
        .then((docs) => {
          if (active) setDocuments(docs);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [draft]);
  useEffect(() => {
    if (!documents) return;
    const next = URL.createObjectURL(documents[tab]);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [documents, tab]);
  if (errors.length)
    return (
      <div className="notice danger" role="alert">
        <strong>Finish the review before generating documents</strong>
        <ul>
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  const summary = totals(draft);
  const stem = `${draft.job.jobNumber}_${draft.job.orderNumber}`.replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  return (
    <>
      <div className="export-heading">
        <div className="success-icon">
          <FileCheck2 size={25} />
        </div>
        <div>
          <h2>Ready for the next signature.</h2>
          <p>
            Your change order and itemized attachment, together in one packet.
          </p>
        </div>
      </div>
      <div className="summary-grid">
        <div>
          <small>THIS CHANGE ORDER</small>
          <strong className={summary.net < 0 ? "credit" : "accent"}>
            {signedMoney(summary.net)}
          </strong>
        </div>
        <div>
          <small>REVISED CONTRACT</small>
          <strong>{money(summary.revised)}</strong>
        </div>
        <div>
          <small>WORKING DAYS ADDED</small>
          <strong>
            {draft.job.addedDays} <span>days</span>
          </strong>
        </div>
      </div>
      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}
      {!documents && !error ? (
        <div className="empty">
          <div className="spinner" />
          <h3>Preparing your documents…</h3>
        </div>
      ) : null}
      {documents ? (
        <>
          <div className="export-bar">
            <div className="segmented">
              {(["combined", "form", "attachment"] as const).map((t) => (
                <button
                  key={t}
                  aria-pressed={t === tab}
                  onClick={() => setTab(t)}
                >
                  {t === "combined"
                    ? "Full packet"
                    : t === "form"
                      ? "Change order"
                      : "Attachment A"}
                </button>
              ))}
            </div>
            <div className="button-row">
              <button
                className="button"
                onClick={() => {
                  const frame = document.createElement("iframe");
                  frame.style.position = "fixed";
                  frame.style.width = "0";
                  frame.style.height = "0";
                  frame.style.border = "0";
                  frame.src = url;
                  frame.onload = () => {
                    setTimeout(() => {
                      try {
                        frame.contentWindow?.focus();
                        frame.contentWindow?.print();
                      } catch {
                        window.open(url, "_blank", "noopener");
                      }
                    }, 500);
                  };
                  document.body.append(frame);
                  setTimeout(() => frame.remove(), 120_000);
                }}
              >
                <Printer size={16} />
                Print
              </button>
              <button
                className="button primary"
                onClick={() =>
                  download(
                    documents[tab],
                    `${stem}_${tab === "combined" ? "Change_Order_Packet" : tab === "form" ? "Change_Order" : "Attachment_A"}.pdf`,
                  )
                }
              >
                <Download size={17} />
                Download {tab === "combined" ? "packet" : "PDF"}
              </button>
            </div>
          </div>
          <PdfViewer
            blob={documents[tab]}
            label={
              tab === "combined"
                ? "Change order packet"
                : tab === "form"
                  ? "Change order"
                  : "Attachment A"
            }
          />
        </>
      ) : null}
    </>
  );
}
