export interface EstimateItem {
  id: string;
  room: string;
  lineNumber: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  // Printed per-unit components in split-price Xactimate reports. The editable
  // rate is their sum; these retain the source values for PM verification.
  priceComponents?: Partial<Record<"reset" | "remove" | "replace", string>>;
  tax: string;
  op: string;
  rcv: string;
  page: number;
  rawText: string;
  warnings: string[];
  reviewed: boolean;
}
export interface ChangeItem {
  id: string;
  action: "revise" | "remove" | "add";
  original: EstimateItem | null;
  room: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  tax: string;
  op: string;
  reason: string;
  pricingConfirmed: boolean;
}
export interface JobDetails {
  customer: string;
  address: string;
  jobNumber: string;
  projectManager: string;
  branchName: string;
  branchAddress: string;
  branchPhone: string;
  branchContact: string;
  carrier: string;
  claim: string;
  orderNumber: string;
  date: string;
  insuranceRelated: boolean;
  originalContract: string;
  previousChanges: string;
  addedDays: string;
}
export interface SourceFile {
  name: string;
  pages: number;
  blob: Blob | null;
  driveFileId: string | null;
}
export interface DraftSummary {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  step: number;
  changesCount: number;
  sourceName: string;
  hasSource: boolean;
  job: {
    customer: string;
    jobNumber: string;
    orderNumber: string;
  };
}
export interface ChangeOrderDraft {
  schemaVersion: 1;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  step: number;
  job: JobDetails;
  estimate: EstimateItem[];
  changes: ChangeItem[];
  source: SourceFile | null;
  extractionWarnings: string[];
  scope: string;
  scopeEdited: boolean;
}
export const newId = () => crypto.randomUUID();
export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function createDraft(): ChangeOrderDraft {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: newId(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    step: 0,
    job: {
      customer: "",
      address: "",
      jobNumber: "",
      projectManager: "",
      branchName: "Hays + Sons Complete Restoration",
      branchAddress: "909 Production Road, Fort Wayne, IN 46808",
      branchPhone: "1-260-471-9110",
      branchContact: "",
      carrier: "",
      claim: "",
      orderNumber: "CO-01",
      date: today(),
      insuranceRelated: true,
      originalContract: "",
      previousChanges: "0.00",
      addedDays: "0",
    },
    estimate: [],
    changes: [],
    source: null,
    extractionWarnings: [],
    scope: "",
    scopeEdited: false,
  };
}
export function blankEstimate(): EstimateItem {
  return {
    id: newId(),
    room: "",
    lineNumber: "",
    description: "",
    quantity: "",
    unit: "",
    rate: "",
    tax: "",
    op: "",
    rcv: "",
    page: 0,
    rawText: "",
    warnings: [],
    reviewed: false,
  };
}
export function createChange(
  original: EstimateItem | null,
  action: ChangeItem["action"] = "add",
): ChangeItem {
  return {
    id: newId(),
    action,
    original: original ? structuredClone(original) : null,
    room: original?.room ?? "",
    description: original?.description ?? "",
    quantity: original?.quantity ?? "1",
    unit: original?.unit ?? "EA",
    rate: original?.rate ?? "",
    tax: original?.tax ?? "0.00",
    op: original?.op ?? "0.00",
    reason: "",
    pricingConfirmed: false,
  };
}
