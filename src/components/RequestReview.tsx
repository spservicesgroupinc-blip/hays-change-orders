import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Pencil,
  Send,
  TriangleAlert,
} from "lucide-react";
import type { ChangeRequest, RequestAttachment } from "../types";
import IntakeReceipt from "./IntakeReceipt";
import RequestEditor from "./RequestEditor";
import "./RequestReview.css";

export default function RequestReview({
  request,
  busy,
  onBack,
  onPreview,
  onDownload,
  onClaim,
  onComplete,
  onRequestInfo,
  onSendResponse,
  onDownloadSummary,
  onSaved,
  onReload,
  onBusy,
  onLeaveGuard,
}: {
  request: ChangeRequest;
  busy: string;
  onBack: () => void;
  onPreview: (attachment: RequestAttachment) => void;
  onDownload: (attachment: RequestAttachment) => void;
  onClaim: (name: string) => void;
  onComplete: () => void;
  onRequestInfo: (question: string) => void;
  onSendResponse: (response: string) => void;
  onDownloadSummary: () => void;
  onSaved: (request: ChangeRequest) => void;
  onReload: () => Promise<ChangeRequest>;
  onBusy: (message: string) => void;
  onLeaveGuard: (guard: (() => boolean) | null) => void;
}) {
  const [claimName, setClaimName] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [response, setResponse] = useState("");
  const [editing, setEditing] = useState(false);

  return (
    <div className="review">
      <button className="back-link" onClick={onBack} disabled={Boolean(busy)}>
        <ArrowLeft size={15} />
        Back to requests
      </button>

      <div className="review-actions">
        {!editing && request.status !== "completed" ? (
          <button
            className="button"
            disabled={Boolean(busy)}
            onClick={() => setEditing(true)}
          >
            <Pencil size={16} />
            Edit request
          </button>
        ) : null}
        <button
          className="button"
          disabled={editing || Boolean(busy)}
          onClick={onDownloadSummary}
        >
          <Download size={16} />
          Download summary PDF
        </button>
      </div>
      {busy ? (
        <p className="receipt-caption" role="status">
          {busy}
        </p>
      ) : null}
      {editing ? (
        <RequestEditor
          request={request}
          onSaved={(saved) => {
            setEditing(false);
            onSaved(saved);
          }}
          onCancel={() => setEditing(false)}
          onReload={onReload}
          onBusy={onBusy}
          onLeaveGuard={onLeaveGuard}
        />
      ) : (
        <IntakeReceipt
          request={request}
          busy={busy}
          onPreview={onPreview}
          onDownload={onDownload}
        />
      )}

      <fieldset className="review-workflow" disabled={editing || Boolean(busy)}>
        {request.status === "submitted" ? (
          <div className="review-card">
            <div className="review-card-icon">
              <Send size={26} />
            </div>
            <h2>Estimator? Start work on this request.</h2>
            <p>
              <strong>{request.job.customer || "Unnamed project"}</strong>
              {request.job.jobNumber ? ` · ${request.job.jobNumber}` : ""}
              <br />
              {request.requestedChanges.length} requested{" "}
              {request.requestedChanges.length === 1 ? "change" : "changes"} ·{" "}
              {request.attachments.length} attachment
              {request.attachments.length === 1 ? "" : "s"}
            </p>
            <label className="field review-field">
              <span>Estimator name</span>
              <input
                aria-label="Estimator name"
                value={claimName}
                placeholder="Enter your name to start work"
                onChange={(event) => setClaimName(event.target.value)}
              />
            </label>
            <button
              className="button primary large full"
              disabled={!claimName.trim() || Boolean(busy)}
              onClick={() => onClaim(claimName)}
            >
              <CheckCircle2 size={17} />
              {busy ? "Starting…" : "Start work"}
            </button>
          </div>
        ) : request.status === "in_review" ? (
          <div className="review-card">
            <h2>Estimator review</h2>
            <p>
              {request.estimatorName || "The estimator"} is working this
              request. Download the files, complete the change order outside the
              app, then mark it complete.
            </p>
            {asking ? (
              <div className="review-ask">
                <label className="field">
                  <span>What information do you need?</span>
                  <textarea
                    aria-label="Information request"
                    value={question}
                    rows={3}
                    onChange={(event) => setQuestion(event.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button
                    className="button"
                    disabled={!question.trim() || Boolean(busy)}
                    onClick={() => onRequestInfo(question)}
                  >
                    {busy ? "Sending…" : "Send request"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setAsking(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="button-row">
                <button
                  className="button primary large"
                  disabled={Boolean(busy)}
                  onClick={onComplete}
                >
                  <CheckCircle2 size={17} />
                  {busy ? "Completing…" : "Mark complete"}
                </button>
                <button className="button" onClick={() => setAsking(true)}>
                  Request more information
                </button>
              </div>
            )}
          </div>
        ) : request.status === "needs_information" ? (
          <div className="review-card">
            <div className="review-card-icon">
              <TriangleAlert size={26} />
            </div>
            <h2>More information needed</h2>
            <blockquote className="review-question">
              {request.informationQuestion ||
                "The estimator needs more details."}
            </blockquote>
            <label className="field review-field">
              <span>Your response</span>
              <textarea
                aria-label="Response"
                value={response}
                rows={3}
                placeholder="Add the information the estimator asked for."
                onChange={(event) => setResponse(event.target.value)}
              />
            </label>
            <button
              className="button primary large full"
              disabled={!response.trim() || Boolean(busy)}
              onClick={() => onSendResponse(response)}
            >
              <Send size={17} />
              {busy ? "Sending…" : "Send response"}
            </button>
          </div>
        ) : (
          <div className="review-card review-done">
            <div className="review-card-icon">
              <CheckCircle2 size={26} />
            </div>
            <h2>
              {request.status === "completed" ? "Completed" : "Read only"}
            </h2>
            <p>
              {request.status === "completed"
                ? "This change order is finished and kept in the log for reference."
                : "This request is not editable."}
            </p>
          </div>
        )}
      </fieldset>
    </div>
  );
}
