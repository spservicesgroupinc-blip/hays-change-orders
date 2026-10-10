import {
  createDraft,
  newId,
  type ChangeRequest,
  type RequestedChange,
  type SubcontractorQuote,
  type ChangeOrderDraft,
  type ChangeItem,
  type EstimateItem,
  type JobDetails,
} from "../types";
import { validationErrors } from "./pricing";

export function createRequest(): ChangeRequest {
  const legacy = createDraft();
  return {
    schemaVersion: 2,
    id: legacy.id,
    revision: 0,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    status: "draft",
    estimatorName: "",
    submittedAt: null,
    informationQuestion: "",
    job: legacy.job,
    requestedChanges: [],
    quotes: [],
    attachments: [],
    estimate: [],
    estimateAttachmentId: null,
    extractionWarnings: [],
    pricedItems: [],
    exclusions: {},
    customerScope: "",
    customerScopeEdited: false,
    customerScopeConfirmed: false,
    contractConfirmed: false,
  };
}
export function createRequestedChange(): RequestedChange {
  return {
    id: newId(),
    room: "",
    action: "add",
    description: "",
    reason: "",
    measurements: "",
    materials: "",
    scheduleImpact: "",
    estimateItemIds: [],
  };
}
export function createQuote(): SubcontractorQuote {
  return {
    id: newId(),
    subcontractor: "",
    trade: "",
    cost: "",
    notes: "",
    changeIds: [],
    attachmentIds: [],
  };
}
// A request can be submitted at any time, even before every detail is known.
// Estimators review the scope and ask for information when something is missing,
// so submission intentionally blocks on nothing — no required fields, no minimum
// number of work areas, and no quote-cost formatting rules.
export function submissionErrors(_request: ChangeRequest): string[] {
  return [];
}
const jobKeys: (keyof JobDetails)[] = [
  "customer",
  "address",
  "jobNumber",
  "projectManager",
  "branchName",
  "branchAddress",
  "branchPhone",
  "branchContact",
  "carrier",
  "claim",
  "orderNumber",
  "date",
  "insuranceRelated",
  "originalContract",
  "previousChanges",
  "addedDays",
];
function customerOriginal(row: EstimateItem): EstimateItem {
  return {
    id: row.id,
    room: row.room,
    lineNumber: row.lineNumber,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    rate: row.rate,
    tax: row.tax,
    op: row.op,
    rcv: row.rcv,
    page: row.page,
    reviewed: row.reviewed,
    rawText: "",
    warnings: [],
  };
}
function customerItem(row: ChangeItem): ChangeItem {
  return {
    id: row.id,
    action: row.action,
    original: row.original ? customerOriginal(row.original) : null,
    room: row.room,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    rate: row.rate,
    tax: row.tax,
    op: row.op,
    reason: row.reason,
    pricingConfirmed: row.pricingConfirmed,
    ...(row.customerPrice
      ? {
          customerPrice: {
            total: row.customerPrice.total,
            tax: row.customerPrice.tax,
            op: row.customerPrice.op,
          },
        }
      : {}),
    ...(row.manualCredit !== undefined
      ? { manualCredit: row.manualCredit }
      : {}),
  };
}
// Customer output is explicitly assembled. Quote costs, vendor notes, PM notes,
// exclusions, queue state, and unknown future request fields cannot leak into it.
export function requestToDraft(request: ChangeRequest): ChangeOrderDraft {
  const job = Object.fromEntries(
    jobKeys.map((key) => [key, request.job[key]]),
  ) as unknown as JobDetails;
  return {
    schemaVersion: 1,
    id: request.id,
    revision: request.revision,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    step: 3,
    job,
    estimate: [],
    changes: request.pricedItems.map(customerItem),
    source: null,
    extractionWarnings: [],
    scope: request.customerScope,
    scopeEdited: request.customerScopeEdited,
  };
}
export function readyErrors(request: ChangeRequest): string[] {
  const errors = submissionErrors(request);
  if (!request.estimatorName.trim())
    errors.push("An estimator must claim this request.");
  if (!request.contractConfirmed)
    errors.push("Confirm the contract amounts and working days.");
  if (!request.customerScopeConfirmed)
    errors.push("Confirm the customer-facing scope summary.");
  const ids = new Set(request.requestedChanges.map((change) => change.id));
  const originals = new Set<string>();
  for (const row of request.pricedItems) {
    if (!row.requestChangeId || !ids.has(row.requestChangeId))
      errors.push("Link every priced item to an existing requested change.");
    if (row.original) {
      if (originals.has(row.original.id))
        errors.push("Each original estimate item can only be priced once.");
      originals.add(row.original.id);
    }
  }
  request.requestedChanges.forEach((change, i) => {
    if (
      !request.pricedItems.some((row) => row.requestChangeId === change.id) &&
      !request.exclusions[change.id]?.trim()
    )
      errors.push(`Change ${i + 1}: add pricing or an exclusion reason.`);
  });
  errors.push(...validationErrors(requestToDraft(request)));
  return [...new Set(errors)];
}
export function invalidateIntakeChanges(
  old: ChangeRequest,
  next: ChangeRequest,
): ChangeRequest {
  if (old.status === "ready") return old;
  const affected = new Set<string>();
  const all = () =>
    next.requestedChanges.forEach((change) => affected.add(change.id));
  const shared = (request: ChangeRequest) =>
    JSON.stringify([
      request.estimate,
      request.estimateAttachmentId,
      ...[
        "customer",
        "address",
        "jobNumber",
        "projectManager",
        "carrier",
        "claim",
        "insuranceRelated",
      ].map((key) => request.job[key as keyof JobDetails]),
    ]);
  let changed = shared(old) !== shared(next);
  if (changed) all();
  const ids = new Set(
    [...old.requestedChanges, ...next.requestedChanges].map(
      (change) => change.id,
    ),
  );
  ids.forEach((id) => {
    if (
      JSON.stringify(
        old.requestedChanges.find((change) => change.id === id),
      ) !==
      JSON.stringify(next.requestedChanges.find((change) => change.id === id))
    ) {
      changed = true;
      affected.add(id);
    }
  });
  const quoteIds = new Set(
    [...old.quotes, ...next.quotes].map((quote) => quote.id),
  );
  quoteIds.forEach((id) => {
    const previous = old.quotes.find((quote) => quote.id === id),
      current = next.quotes.find((quote) => quote.id === id);
    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      changed = true;
      const links = [
        ...(previous?.changeIds ?? []),
        ...(current?.changeIds ?? []),
      ];
      if (!links.length) all();
      else links.forEach((link) => affected.add(link));
    }
  });
  const attachmentIds = new Set(
    [...old.attachments, ...next.attachments].map(
      (attachment) => attachment.id,
    ),
  );
  attachmentIds.forEach((id) => {
    if (
      JSON.stringify(
        old.attachments.find((attachment) => attachment.id === id),
      ) !==
      JSON.stringify(
        next.attachments.find((attachment) => attachment.id === id),
      )
    ) {
      changed = true;
      const quotes = [...old.quotes, ...next.quotes].filter((quote) =>
        quote.attachmentIds.includes(id),
      );
      const links = quotes.flatMap((quote) => quote.changeIds);
      if (!links.length) all();
      else links.forEach((link) => affected.add(link));
    }
  });
  const contractChanged = [
    "originalContract",
    "previousChanges",
    "addedDays",
  ].some(
    (key) =>
      old.job[key as keyof JobDetails] !== next.job[key as keyof JobDetails],
  );
  if (!changed && !contractChanged) return next;
  return {
    ...next,
    contractConfirmed: false,
    ...(changed
      ? {
          customerScopeConfirmed: false,
          pricedItems: next.pricedItems.map((row) =>
            affected.has(row.requestChangeId ?? "")
              ? { ...row, pricingConfirmed: false }
              : row,
          ),
        }
      : {}),
  };
}
export function convertLegacyDraft(legacy: ChangeOrderDraft): ChangeRequest {
  const request = createRequest();
  request.legacyDraftId = legacy.id;
  request.job = structuredClone(legacy.job);
  request.estimate = structuredClone(legacy.estimate);
  request.extractionWarnings = [...legacy.extractionWarnings];
  request.requestedChanges = legacy.changes.map((row) => ({
    ...createRequestedChange(),
    room: row.room,
    action: row.action,
    description: row.description,
    reason: row.reason,
    estimateItemIds: row.original ? [row.original.id] : [],
  }));
  request.pricedItems = legacy.changes.map((row, index) => ({
    ...structuredClone(row),
    requestChangeId: request.requestedChanges[index].id,
    pricingConfirmed: false,
  }));
  request.customerScope = legacy.scope;
  request.customerScopeEdited = legacy.scopeEdited;
  if (legacy.source?.driveFileId) {
    const id = newId();
    request.attachments.push({
      id,
      kind: "estimate",
      name: legacy.source.name,
      mimeType: "application/pdf",
      size: 0,
      driveFileId: legacy.source.driveFileId,
    });
    request.estimateAttachmentId = id;
  }
  return request;
}
