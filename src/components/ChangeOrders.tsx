import { useMemo, useState } from "react";
import { ArrowRight, Clock3, FileText, Search } from "lucide-react";
import type { RequestStatus, RequestSummary } from "../types";
import DashNoteButton from "./DashNoteButton";
import "./ChangeOrders.css";

const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  submitted: "In queue",
  in_review: "In review",
  needs_information: "Needs info",
  ready: "Ready",
  completed: "Completed",
};

const FILTERS: { id: RequestStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "submitted", label: "In queue" },
  { id: "in_review", label: "In review" },
  { id: "needs_information", label: "Needs info" },
  { id: "ready", label: "Ready" },
  { id: "completed", label: "Completed" },
];

interface Props {
  requests: RequestSummary[];
  onOpen: (id: string) => void;
}

export default function ChangeOrders({ requests, onOpen }: Props) {
  const [filter, setFilter] = useState<RequestStatus | "all">("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const map = new Map<RequestStatus | "all", number>();
    map.set("all", requests.length);
    for (const request of requests)
      map.set(request.status, (map.get(request.status) ?? 0) + 1);
    return map;
  }, [requests]);

  const filtered = requests.filter((item) => {
    if (filter !== "all" && item.status !== filter) return false;
    const haystack =
      `${item.job.customer} ${item.job.jobNumber} ${item.job.projectManager} ${item.job.orderNumber}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  return (
    <div className="orders-page">
      <header className="orders-head">
        <div className="orders-title">
          <h1>Stored change orders</h1>
        </div>
      </header>

      <div className="orders-toolbar">
        <div
          className="orders-filters"
          role="tablist"
          aria-label="Filter by status"
        >
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={`orders-filter${filter === item.id ? " active" : ""}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span className="orders-filter-count">
                {counts.get(item.id) ?? 0}
              </span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search change orders"
            placeholder="Customer, job, or PM…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {!filtered.length ? (
        <div className="empty-state">
          <div className="empty-icon">
            <FileText size={30} />
          </div>
          <h3>No change orders here.</h3>
          <p>Nothing matches the current filter or search.</p>
        </div>
      ) : (
        <div className="orders-grid">
          {filtered.map((item) => (
            <article className="order-card" key={item.id}>
              <button
                className="order-card-body"
                onClick={() => onOpen(item.id)}
              >
                <div className="order-card-top">
                  <span className={`request-status status-${item.status}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                  <span className="order-card-date">
                    <Clock3 size={12} />
                    {new Date(item.updatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <h3>{item.job.customer || "Untitled request"}</h3>
                <p className="order-card-job">
                  {item.job.jobNumber || "Job pending"}
                  {item.job.orderNumber ? ` · ${item.job.orderNumber}` : ""}
                </p>
                <dl className="order-card-meta">
                  <div>
                    <dt>Changes</dt>
                    <dd>{item.changesCount}</dd>
                  </div>
                  <div>
                    <dt>Files</dt>
                    <dd>{item.attachmentsCount}</dd>
                  </div>
                  <div>
                    <dt>Estimator</dt>
                    <dd>{item.estimatorName || "Unassigned"}</dd>
                  </div>
                </dl>
                <span className="order-card-open">
                  Review <ArrowRight size={14} />
                </span>
              </button>
              <div className="order-card-actions">
                <DashNoteButton requestId={item.id} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
