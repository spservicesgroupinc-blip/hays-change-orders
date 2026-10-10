import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  FileCheck2,
  FileText,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  ChangeItem,
  ChangeRequest,
  EstimateItem,
  JobDetails,
  RequestAttachment,
  RequestedChange,
} from "../types";
import { createChange } from "../types";
import {
  baselineProblems,
  calculateChange,
  cents,
  generatedScope,
  money,
  safeTotals,
  signedMoney,
  validDecimal,
} from "../services/pricing";
import { requestToDraft } from "../services/requests";
import "./EstimatorWorkspace.css";

const Preview = lazy(() => import("./Preview"));
interface Props {
  request: ChangeRequest;
  onChange: (next: ChangeRequest) => void;
  onAskInformation: (question: string) => void;
  onReady: () => void;
  onComplete: () => void;
  onPreviewAttachment: (attachment: RequestAttachment) => void;
  busy: boolean;
}
type PriceMode = "all-in" | "itemized" | "credit" | "remove";
function mode(row: ChangeItem): PriceMode {
  return row.manualCredit !== undefined
    ? "credit"
    : row.action === "remove"
      ? "remove"
      : row.customerPrice
        ? "all-in"
        : "itemized";
}
function Field({
  label,
  value,
  onChange,
  multiline = false,
  hint,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  hint?: ReactNode;
  type?: string;
}) {
  return (
    <label className="ew-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
        />
      ) : (
        <input
          aria-label={label}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
function amount(value: string, signed = false) {
  return validDecimal(value, signed) ? money(cents(value)) : "Not entered";
}
function originalLabel(item: EstimateItem) {
  return `${item.room || "Unassigned"} · line ${item.lineNumber || "manual"} · ${item.description} · ${amount(item.rcv, true)}`;
}
function PriceResult({ row }: { row: ChangeItem }) {
  try {
    const values = calculateChange(row);
    return (
      <div className="ew-price-result">
        <span>
          Original <strong>{money(values.original)}</strong>
        </span>
        <span>
          {row.manualCredit !== undefined
            ? "Customer credit"
            : "Revised customer total"}{" "}
          <strong>{money(values.revised)}</strong>
        </span>
        <span>
          Net change <strong>{signedMoney(values.delta)}</strong>
        </span>
      </div>
    );
  } catch {
    return (
      <p className="ew-inline-warning">
        Complete the pricing to calculate this item's net change.
      </p>
    );
  }
}

export default function EstimatorWorkspace({
  request,
  onChange,
  onAskInformation,
  onReady,
  onComplete,
  onPreviewAttachment,
  busy,
}: Props) {
  const editable = request.status === "in_review" && !busy;
  const [question, setQuestion] = useState("");
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [searches, setSearches] = useState<Record<string, string>>({});
  // The contract amount is prefilled from the job directory the admin imported
  // (see the request form's job picker). Remember which request the estimator
  // overrode, so the "from the import" hint is never claimed for a hand-entered
  // amount and is restored when a different request is opened.
  const [overriddenContractRequestId, setOverriddenContractRequestId] = useState<
    string | null
  >(null);
  const estimateMap = useMemo(
    () => new Map(request.estimate.map((item) => [item.id, item])),
    [request.estimate],
  );
  const draft = useMemo(() => requestToDraft(request), [request]);
  const documentAttachments = request.attachments.filter(
    (attachment) => attachment.kind === "document",
  );
  const customerScope = request.customerScopeEdited
    ? request.customerScope
    : generatedScope(request.pricedItems);
  // The PM's picked job carries the amount in the report's Estimate Amount
  // column, which is the customer's original contract amount. Say where it came
  // from until it is overridden, and flag a blank amount because the customer
  // document prints it as $0.00.
  const importedContractAmount = request.job.originalContract.trim();
  const contractAmountHint: ReactNode = !importedContractAmount
    ? "A blank amount prints as $0.00 on the customer document. Enter the signed contract amount."
    : overriddenContractRequestId === request.id
      ? undefined
      : "From the job directory import (Estimate Amount column)";
  // The packet shows missing or unparseable amounts as $0.00, so the sidebar
  // mirrors that instead of hiding the totals until every value is valid.
  const summary = safeTotals(draft);
  const apply = (next: ChangeRequest) => {
    if (editable) onChange(next);
  };
  const updateRow = (id: string, patch: Partial<ChangeItem>) =>
    apply({
      ...request,
      customerScopeConfirmed: false,
      pricedItems: request.pricedItems.map((row) =>
        row.id === id ? { ...row, ...patch, pricingConfirmed: false } : row,
      ),
    });
  const updateJob = (key: keyof JobDetails, value: string | boolean) =>
    apply({
      ...request,
      contractConfirmed: false,
      job: { ...request.job, [key]: value },
    });
  const addPrice = (change: RequestedChange) => {
    const row = createChange(null);
    Object.assign(row, {
      requestChangeId: change.id,
      room: change.room,
      quantity: "1",
      unit: "LS",
      customerPrice: { total: "", tax: null, op: null },
    });
    const exclusions = { ...request.exclusions };
    delete exclusions[change.id];
    apply({
      ...request,
      exclusions,
      customerScopeConfirmed: false,
      pricedItems: [...request.pricedItems, row],
    });
  };
  const switchMode = (row: ChangeItem, next: PriceMode) => {
    if (next === "credit")
      updateRow(row.id, {
        action: "remove",
        original: null,
        customerPrice: undefined,
        manualCredit: "",
      });
    else if (next === "remove")
      updateRow(row.id, {
        action: "remove",
        customerPrice: undefined,
        manualCredit: undefined,
      });
    else
      updateRow(row.id, {
        action: row.original ? "revise" : "add",
        manualCredit: undefined,
        customerPrice:
          next === "all-in"
            ? (row.customerPrice ?? { total: "", tax: null, op: null })
            : undefined,
      });
  };
  const selectOriginal = (row: ChangeItem, id: string) => {
    if (
      id &&
      request.pricedItems.some(
        (other) => other.id !== row.id && other.original?.id === id,
      )
    )
      return;
    const original = id ? (estimateMap.get(id) ?? null) : null;
    const snapshot = original
      ? { ...structuredClone(original), reviewed: false }
      : null;
    const base = createChange(
      snapshot,
      original ? (row.action === "remove" ? "remove" : "revise") : "add",
    );
    updateRow(row.id, {
      ...base,
      id: row.id,
      requestChangeId: row.requestChangeId,
      description: row.description || original?.description || "",
      reason: row.reason,
      room: row.room || original?.room || "",
      customerPrice: row.customerPrice,
      manualCredit: undefined,
    });
  };
  const replaceGroup = (change: RequestedChange) => {
    const chosen = selections[change.id] ?? change.estimateItemIds;
    const used = new Set(
      request.pricedItems.flatMap((row) =>
        row.original ? [row.original.id] : [],
      ),
    );
    const originals = chosen
      .map((id) => estimateMap.get(id))
      .filter((item): item is EstimateItem =>
        Boolean(item && !used.has(item.id)),
      );
    if (!originals.length) return;
    const removals = originals.map((original) => ({
      ...createChange(
        { ...structuredClone(original), reviewed: false },
        "remove",
      ),
      requestChangeId: change.id,
      reason: "",
    }));
    const replacement = {
      ...createChange(null),
      requestChangeId: change.id,
      room: change.room,
      quantity: "1",
      unit: "LS",
      customerPrice: { total: "", tax: null, op: null },
    };
    const exclusions = { ...request.exclusions };
    delete exclusions[change.id];
    apply({
      ...request,
      exclusions,
      customerScopeConfirmed: false,
      pricedItems: [...request.pricedItems, ...removals, replacement],
    });
    setSelections((previous) => ({ ...previous, [change.id]: [] }));
  };

  return (
    <div className="estimator-workspace">
      <div className="ew-intro">
        <div>
          <h2>Estimator workspace</h2>
        </div>
        <span className="ew-status">
          {request.status === "completed"
            ? "Completed"
            : request.status === "ready"
              ? "Ready for customer"
              : request.status === "in_review"
                ? `In review · ${request.estimatorName || "Estimator"}`
                : "Read-only request"}
        </span>
      </div>
      {request.status === "ready" || request.status === "completed" ? (
        <section className="ew-panel">
          <Suspense fallback={<p>Preparing customer documents…</p>}>
            <Preview draft={draft} />
          </Suspense>
        </section>
      ) : null}
      {request.status === "ready" ? (
        <section className="ew-panel ew-complete-panel">
          <div>
            <h3>Complete the change order</h3>
            <p>
              Store the final customer packet on this record and mark it
              completed. Completed orders become read-only.
            </p>
          </div>
          <button
            className="button primary large"
            disabled={busy}
            onClick={onComplete}
          >
            <FileCheck2 size={17} />
            Store documents &amp; complete
          </button>
        </section>
      ) : null}
      {request.status === "completed" ? (
        <>
          <div className="notice">
            <strong>This change order is complete.</strong> Final customer
            documents are stored below and this record is read-only.
          </div>
          {documentAttachments.length ? (
            <section className="ew-panel">
              <h3>Final documents</h3>
              <p>The stored customer packet for this change order.</p>
              <div className="ew-attachment-list">
                {documentAttachments.map((attachment) => (
                  <button
                    className="button small"
                    key={attachment.id}
                    onClick={() => onPreviewAttachment(attachment)}
                  >
                    <FileText size={14} />
                    {attachment.name}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      {request.status === "needs_information" ? (
        <div className="notice warning" role="status">
          <span>
            <strong>Waiting on the project manager.</strong> You asked{" "}
            {request.job.projectManager || "the project manager"} for more
            information
            {request.informationQuestion
              ? `: “${request.informationQuestion}”`
              : "."}{" "}
            It stays paused and read-only here until they update the details and
            resubmit.
          </span>
        </div>
      ) : !editable &&
        request.status !== "ready" &&
        request.status !== "completed" ? (
        <div className="notice">
          Claim this request to edit scope and pricing.
        </div>
      ) : null}

      <div className="ew-layout">
        <div className="ew-main">
          {request.requestedChanges.map((change, index) => {
            const rows = request.pricedItems.filter(
              (row) => row.requestChangeId === change.id,
            );
            const excluded = Object.prototype.hasOwnProperty.call(
              request.exclusions,
              change.id,
            );
            const quotes = request.quotes.filter((quote) =>
              quote.changeIds.includes(change.id),
            );
            const selected = selections[change.id] ?? change.estimateItemIds;
            const used = new Set(
              request.pricedItems.flatMap((row) =>
                row.original ? [row.original.id] : [],
              ),
            );
            const query = (searches[change.id] ?? "").toLowerCase();
            const matching = request.estimate.filter(
              (item) =>
                !query ||
                `${item.room} ${item.lineNumber} ${item.description}`
                  .toLowerCase()
                  .includes(query),
            );
            const hasReplacement = selected.some(
              (id) => estimateMap.has(id) && !used.has(id),
            );
            return (
              <section className="ew-panel ew-work-area" key={change.id}>
                <div className="ew-area-heading">
                  <div>
                    <span className="ew-eyebrow">
                      WORK AREA {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3>{change.room}</h3>
                  </div>
                  <span
                    className={`ew-coverage ${excluded ? "excluded" : rows.length ? "covered" : ""}`}
                  >
                    {excluded
                      ? "Excluded"
                      : rows.length
                        ? `${rows.length} customer item${rows.length === 1 ? "" : "s"}`
                        : "Needs pricing"}
                  </span>
                </div>
                <div className="ew-pm-reference">
                  <span className="ew-eyebrow">
                    PM FIELD REQUEST · INTERNAL REFERENCE
                  </span>
                  <p className="ew-reference-scope">{change.description}</p>
                  <dl>
                    <div>
                      <dt>Reason</dt>
                      <dd>{change.reason || "Not supplied"}</dd>
                    </div>
                    <div>
                      <dt>Measurements</dt>
                      <dd>{change.measurements || "Not supplied"}</dd>
                    </div>
                    <div>
                      <dt>Materials / finish</dt>
                      <dd>{change.materials || "Not supplied"}</dd>
                    </div>
                    <div>
                      <dt>Schedule impact</dt>
                      <dd>{change.scheduleImpact || "Not supplied"}</dd>
                    </div>
                  </dl>
                  {change.estimateItemIds.length ? (
                    <p className="ew-source-references">
                      Estimate references:{" "}
                      {change.estimateItemIds
                        .map((id) => {
                          const item = estimateMap.get(id);
                          return item
                            ? `${item.room}, line ${item.lineNumber}${item.page ? ` (page ${item.page})` : ""}`
                            : "Unavailable reference";
                        })
                        .join("; ")}
                    </p>
                  ) : null}
                  {quotes.length ? (
                    <div className="ew-quote-list">
                      {quotes.map((quote) => (
                        <article key={quote.id}>
                          <strong>
                            {quote.subcontractor || "Subcontractor"} ·{" "}
                            {quote.trade}
                          </strong>
                          <span>
                            Quoted subcontractor cost:{" "}
                            <b>{amount(quote.cost)}</b>
                          </span>
                          {quote.notes ? <p>{quote.notes}</p> : null}
                          <div className="ew-attachment-list">
                            {quote.attachmentIds
                              .map((id) =>
                                request.attachments.find(
                                  (attachment) => attachment.id === id,
                                ),
                              )
                              .filter(
                                (attachment): attachment is RequestAttachment =>
                                  Boolean(attachment),
                              )
                              .map((attachment) => (
                                <button
                                  className="button small"
                                  key={attachment.id}
                                  onClick={() =>
                                    onPreviewAttachment(attachment)
                                  }
                                >
                                  <FileText size={14} />
                                  {attachment.name}
                                </button>
                              ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="ew-reference-note">
                      No subcontractor quote linked to this work area.
                    </p>
                  )}
                </div>
                <fieldset disabled={!editable} className="ew-fieldset">
                  <label className="ew-check">
                    <input
                      type="checkbox"
                      checked={excluded}
                      onChange={(event) => {
                        const exclusions = { ...request.exclusions };
                        if (event.target.checked) exclusions[change.id] = "";
                        else delete exclusions[change.id];
                        apply({
                          ...request,
                          exclusions,
                          customerScopeConfirmed: false,
                          pricedItems: event.target.checked
                            ? request.pricedItems.filter(
                                (row) => row.requestChangeId !== change.id,
                              )
                            : request.pricedItems,
                        });
                      }}
                    />
                    Exclude this request from the customer order
                  </label>
                  {excluded ? (
                    <Field
                      label="Internal exclusion reason"
                      value={request.exclusions[change.id]}
                      onChange={(value) =>
                        apply({
                          ...request,
                          exclusions: {
                            ...request.exclusions,
                            [change.id]: value,
                          },
                          customerScopeConfirmed: false,
                        })
                      }
                      multiline
                      hint="An excluded request has no customer pricing. This explanation stays internal."
                    />
                  ) : (
                    <>
                      {rows.map((row, rowIndex) => (
                        <article className="ew-priced-item" key={row.id}>
                          <div className="ew-row-heading">
                            <h4>Customer item {rowIndex + 1}</h4>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Delete customer item ${rowIndex + 1} in ${change.room}`}
                              onClick={() =>
                                apply({
                                  ...request,
                                  customerScopeConfirmed: false,
                                  pricedItems: request.pricedItems.filter(
                                    (item) => item.id !== row.id,
                                  ),
                                })
                              }
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                          <div className="ew-grid">
                            <label className="ew-field">
                              <span>Pricing method</span>
                              <select
                                value={mode(row)}
                                onChange={(event) =>
                                  switchMode(
                                    row,
                                    event.target.value as PriceMode,
                                  )
                                }
                              >
                                <option value="all-in">
                                  All-in customer price
                                </option>
                                <option value="itemized">
                                  Quantity and unit price
                                </option>
                                <option value="remove">
                                  Remove original item / full credit
                                </option>
                                <option value="credit">
                                  Manual customer credit
                                </option>
                              </select>
                            </label>
                            <Field
                              label="Customer work area"
                              value={row.room}
                              onChange={(value) =>
                                updateRow(row.id, { room: value })
                              }
                            />
                          </div>
                          {row.manualCredit === undefined ? (
                            <label className="ew-field">
                              <span>Original estimate item</span>
                              <select
                                value={row.original?.id ?? ""}
                                onChange={(event) =>
                                  selectOriginal(row, event.target.value)
                                }
                              >
                                <option value="">
                                  New work — no original item
                                </option>
                                {request.estimate.map((item) => (
                                  <option
                                    key={item.id}
                                    value={item.id}
                                    disabled={request.pricedItems.some(
                                      (other) =>
                                        other.id !== row.id &&
                                        other.original?.id === item.id,
                                    )}
                                  >
                                    {originalLabel(item)}
                                  </option>
                                ))}
                              </select>
                              <small>
                                Each original item can be priced once.
                                Referencing an item here changes its printed RCV
                                baseline.
                              </small>
                            </label>
                          ) : null}
                          <Field
                            label="Customer-facing description"
                            value={row.description}
                            onChange={(value) =>
                              updateRow(row.id, { description: value })
                            }
                            multiline
                            hint="Write the approved work description for the customer document."
                          />
                          <Field
                            label="Customer-facing reason"
                            value={row.reason}
                            onChange={(value) =>
                              updateRow(row.id, { reason: value })
                            }
                            multiline
                            hint="Keep vendor costs and internal notes in the reference section above."
                          />
                          {row.original ? (
                            <details className="ew-original">
                              <summary>
                                Verify original baseline · line{" "}
                                {row.original.lineNumber || "manual"}
                                {row.original.page
                                  ? `, page ${row.original.page}`
                                  : ""}{" "}
                                · {amount(row.original.rcv, true)}
                              </summary>
                              <p>
                                Correct only the affected original item against
                                the source estimate. Other extracted rows do not
                                need review.
                              </p>
                              <div className="ew-grid three">
                                {(
                                  [
                                    ["quantity", "Original quantity"],
                                    ["unit", "Original unit"],
                                    ["rate", "Original unit price"],
                                    ["tax", "Original tax"],
                                    ["op", "Original O&P"],
                                    ["rcv", "Original printed RCV"],
                                  ] as const
                                ).map(([key, label]) => (
                                  <Field
                                    key={key}
                                    label={label}
                                    value={row.original![key]}
                                    onChange={(value) =>
                                      updateRow(row.id, {
                                        original: {
                                          ...row.original!,
                                          [key]: value,
                                          reviewed: false,
                                        },
                                      })
                                    }
                                  />
                                ))}
                              </div>
                              {row.original.warnings.length ? (
                                <p className="ew-inline-warning">
                                  Source review notes:{" "}
                                  {row.original.warnings.join(" ")}
                                </p>
                              ) : null}
                              <label className="ew-check">
                                <input
                                  type="checkbox"
                                  checked={row.original.reviewed}
                                  disabled={
                                    !editable ||
                                    baselineProblems(row.original).length > 0
                                  }
                                  onChange={(event) =>
                                    updateRow(row.id, {
                                      original: {
                                        ...row.original!,
                                        reviewed: event.target.checked,
                                      },
                                    })
                                  }
                                />
                                I verified the original values against the
                                estimate
                              </label>
                            </details>
                          ) : null}
                          {row.manualCredit !== undefined ? (
                            <Field
                              label="Customer credit amount (positive dollars)"
                              value={row.manualCredit}
                              onChange={(value) =>
                                updateRow(row.id, { manualCredit: value })
                              }
                              hint="This all-in amount reduces the contract. Use this when no original estimate item is available."
                            />
                          ) : row.customerPrice ? (
                            <>
                              <div className="ew-grid">
                                <Field
                                  label="Customer quantity (scope reference)"
                                  value={row.quantity}
                                  onChange={(value) =>
                                    updateRow(row.id, { quantity: value })
                                  }
                                  hint="This quantity describes the approved work; the all-in price is entered below."
                                />
                                <Field
                                  label="Customer unit"
                                  value={row.unit}
                                  onChange={(value) =>
                                    updateRow(row.id, { unit: value })
                                  }
                                  hint="Use LS for a lump sum, or the unit applicable to the approved scope."
                                />
                              </div>
                              <Field
                                label="Final customer price (includes tax and O&P)"
                                value={row.customerPrice.total}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    customerPrice: {
                                      ...row.customerPrice!,
                                      total: value,
                                    },
                                  })
                                }
                                hint={
                                  row.original
                                    ? "Enter the full revised item total, not just the increase. The original printed RCV is subtracted automatically."
                                    : "Enter the final customer amount directly. Quoted subcontractor cost is for internal reference."
                                }
                              />
                              <details className="ew-breakdown">
                                <summary>
                                  Optional included tax / O&P breakdown
                                </summary>
                                <p>
                                  Leave a value blank when the breakdown is
                                  unknown; the customer attachment will say
                                  Included.
                                </p>
                                <div className="ew-grid">
                                  <Field
                                    label="Included tax dollars"
                                    value={row.customerPrice.tax ?? ""}
                                    onChange={(value) =>
                                      updateRow(row.id, {
                                        customerPrice: {
                                          ...row.customerPrice!,
                                          tax: value.trim() ? value : null,
                                        },
                                      })
                                    }
                                  />
                                  <Field
                                    label="Included O&P dollars"
                                    value={row.customerPrice.op ?? ""}
                                    onChange={(value) =>
                                      updateRow(row.id, {
                                        customerPrice: {
                                          ...row.customerPrice!,
                                          op: value.trim() ? value : null,
                                        },
                                      })
                                    }
                                  />
                                </div>
                              </details>
                            </>
                          ) : row.action !== "remove" ? (
                            <div className="ew-grid three">
                              {(
                                [
                                  ["quantity", "Revised quantity"],
                                  ["unit", "Unit"],
                                  ["rate", "Unit price"],
                                  ["tax", "Revised tax dollars"],
                                  ["op", "Revised O&P dollars"],
                                ] as const
                              ).map(([key, label]) => (
                                <Field
                                  key={key}
                                  label={label}
                                  value={row[key]}
                                  onChange={(value) =>
                                    updateRow(row.id, { [key]: value })
                                  }
                                />
                              ))}
                            </div>
                          ) : (
                            <p>
                              Removing this item credits its complete original
                              printed RCV, including original tax and O&P.
                            </p>
                          )}
                          <PriceResult row={row} />
                          <label className="ew-check">
                            <input
                              type="checkbox"
                              checked={row.pricingConfirmed}
                              onChange={(event) =>
                                apply({
                                  ...request,
                                  pricedItems: request.pricedItems.map(
                                    (item) =>
                                      item.id === row.id
                                        ? {
                                            ...item,
                                            pricingConfirmed:
                                              event.target.checked,
                                          }
                                        : item,
                                  ),
                                })
                              }
                            />
                            I approve this customer description, reason, and
                            final pricing
                          </label>
                        </article>
                      ))}
                      <button
                        type="button"
                        className="button"
                        onClick={() => addPrice(change)}
                      >
                        <Plus size={16} />
                        Add customer priced item
                      </button>
                      {request.estimate.length ? (
                        <details className="ew-replacement">
                          <summary>
                            Replace original item(s) with a lump sum
                          </summary>
                          <p>
                            Select the original work to credit, then enter one
                            final all-in customer price for the replacement.
                            Each original is credited exactly once.
                          </p>
                          <Field
                            label="Find original items by room, line, or description"
                            value={searches[change.id] ?? ""}
                            onChange={(value) =>
                              setSearches((previous) => ({
                                ...previous,
                                [change.id]: value,
                              }))
                            }
                          />
                          <label className="ew-field">
                            <span>Original items to replace</span>
                            <select
                              multiple
                              size={Math.min(6, Math.max(2, matching.length))}
                              value={selected}
                              onChange={(event) =>
                                setSelections((previous) => ({
                                  ...previous,
                                  [change.id]: [
                                    ...event.target.selectedOptions,
                                  ].map((option) => option.value),
                                }))
                              }
                            >
                              {matching.map((item) => (
                                <option
                                  key={item.id}
                                  value={item.id}
                                  disabled={used.has(item.id)}
                                >
                                  {originalLabel(item)}
                                </option>
                              ))}
                            </select>
                            <small>
                              Use Ctrl or Command to select multiple items.
                            </small>
                          </label>
                          <button
                            type="button"
                            className="button"
                            disabled={!hasReplacement}
                            onClick={() => replaceGroup(change)}
                          >
                            Create original credits + replacement item
                          </button>
                        </details>
                      ) : null}
                    </>
                  )}
                </fieldset>
              </section>
            );
          })}

          <section className="ew-panel">
            <h3>Customer scope summary</h3>
            <p>
              Approve the wording that appears on the signed customer change
              order.
            </p>
            <fieldset disabled={!editable} className="ew-fieldset">
              <Field
                label="Approved customer scope"
                value={customerScope}
                onChange={(value) =>
                  apply({
                    ...request,
                    customerScope: value,
                    customerScopeEdited: true,
                    customerScopeConfirmed: false,
                  })
                }
                multiline
                hint="The customer packet includes only this scope and approved customer item text."
              />
              <label className="ew-check">
                <input
                  type="checkbox"
                  checked={request.customerScopeConfirmed}
                  onChange={(event) =>
                    apply({
                      ...request,
                      customerScopeConfirmed: event.target.checked,
                    })
                  }
                />
                I reviewed and approved the customer scope wording
              </label>
            </fieldset>
          </section>

          <section className="ew-panel">
            <h3>Contract and document details</h3>
            <fieldset disabled={!editable} className="ew-fieldset">
              <div className="ew-grid three">
                {(
                  [
                    ["originalContract", "Original contract amount"],
                    ["previousChanges", "Previous authorized changes"],
                    ["addedDays", "Added working days"],
                    ["customer", "Customer"],
                    ["address", "Property address"],
                    ["jobNumber", "Job number"],
                    ["projectManager", "Project manager"],
                    ["branchContact", "Contractor contact"],
                    ["orderNumber", "Change-order number"],
                    ["date", "Change-order date"],
                    ["carrier", "Insurance carrier"],
                    ["claim", "Claim number"],
                    ["branchName", "Branch name"],
                    ["branchAddress", "Branch address"],
                    ["branchPhone", "Branch phone"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    value={request.job[key]}
                    onChange={(value) => {
                      if (key === "originalContract")
                        setOverriddenContractRequestId(request.id);
                      updateJob(key, value);
                    }}
                    type={key === "date" ? "date" : "text"}
                    hint={
                      key === "originalContract"
                        ? contractAmountHint
                        : undefined
                    }
                  />
                ))}
              </div>
              <label className="ew-check">
                <input
                  type="checkbox"
                  checked={request.job.insuranceRelated}
                  onChange={(event) =>
                    updateJob("insuranceRelated", event.target.checked)
                  }
                />
                Insurance-related change order
              </label>
              <label className="ew-check">
                <input
                  type="checkbox"
                  checked={request.contractConfirmed}
                  onChange={(event) =>
                    apply({
                      ...request,
                      contractConfirmed: event.target.checked,
                    })
                  }
                />
                I verified the contract amounts and customer document details
              </label>
            </fieldset>
          </section>
        </div>
        <aside className="ew-sidebar">
          <section className="ew-panel">
            <h3>Customer pricing summary</h3>
            <dl className="ew-total-list">
              <div>
                <dt>This change order</dt>
                <dd>{signedMoney(summary.net)}</dd>
              </div>
              <div>
                <dt>Revised contract</dt>
                <dd>{money(summary.revised)}</dd>
              </div>
              <div>
                <dt>Added working days</dt>
                <dd>{request.job.addedDays || "0"}</dd>
              </div>
            </dl>
            <p>
              Subcontractor quote costs are internal and are never added to
              customer pricing automatically.
            </p>
          </section>
          {request.quotes.some((quote) => !quote.changeIds.length) ? (
            <section className="ew-panel">
              <h3>Other quoted costs</h3>
              <p>Internal quotes that have not been linked to a work area.</p>
              <div className="ew-quote-list">
                {request.quotes
                  .filter((quote) => !quote.changeIds.length)
                  .map((quote) => (
                    <article key={quote.id}>
                      <strong>
                        {quote.subcontractor || "Subcontractor"} · {quote.trade}
                      </strong>
                      <span>
                        Quoted subcontractor cost: <b>{amount(quote.cost)}</b>
                      </span>
                      {quote.notes ? <p>{quote.notes}</p> : null}
                    </article>
                  ))}
              </div>
            </section>
          ) : null}
          <section className="ew-panel">
            <h3>Request files</h3>
            <p>
              Internal reference only. Quote PDFs and photos stay out of the
              customer packet.
            </p>
            <div className="ew-attachment-list">
              {request.attachments.map((attachment) => (
                <button
                  className="button small"
                  key={attachment.id}
                  onClick={() => onPreviewAttachment(attachment)}
                >
                  <FileText size={14} />
                  {attachment.name}
                </button>
              ))}
            </div>
            {!request.attachments.length ? <p>No files attached.</p> : null}
          </section>
          {request.status !== "ready" && request.status !== "completed" ? (
            <>
              <section className="ew-panel">
                <h3>Ask the PM for information</h3>
                <fieldset disabled={!editable} className="ew-fieldset">
                  <Field
                    label="Question for the project manager"
                    value={question}
                    onChange={setQuestion}
                    multiline
                  />
                  <button
                    className="button full"
                    disabled={!question.trim()}
                    onClick={() => onAskInformation(question.trim())}
                  >
                    <MessageSquare size={15} />
                    Request information
                  </button>
                </fieldset>
              </section>
              <section className="ew-panel ew-ready-panel">
                <h3>Finish estimator review</h3>
                <p>
                  Mark this order ready whenever you have entered as much as you
                  know. Blank details print blank and amounts that cannot be
                  read print as $0.00, and you can keep correcting the review
                  until the order is completed.
                </p>
                <button
                  className="button primary full"
                  disabled={!editable}
                  onClick={onReady}
                >
                  <CheckCircle2 size={16} />
                  Mark ready for customer
                </button>
              </section>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
