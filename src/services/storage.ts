import type { AttachmentKind, ChangeOrderDraft, ChangeRequest, DraftSummary, RequestAttachment, RequestStatus, RequestSummary } from "../types";

export class ApiError extends Error {
  constructor(message: string, public code = "SERVICE_ERROR", public currentRevision?: number) { super(message); this.name = "ApiError"; }
}
function apiFailure(payload: {error?: string; code?: string; currentRevision?: number} | null): never {
  throw new ApiError(payload?.error || "The sync service is unavailable.", payload?.code, payload?.currentRevision);
}

export interface SerializedSource {
  name: string;
  pages: number;
  driveFileId: string | null;
}
export type SerializedDraft = Omit<ChangeOrderDraft, "source"> & {
  source: SerializedSource | null;
};
interface ServerSummary {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  step: number;
  customer: string;
  jobNumber: string;
  orderNumber: string;
  changesCount: number;
  sourceName: string;
  hasSource: boolean;
}
function env(name: string): string | undefined {
  const value = (import.meta as unknown as {
    env?: Record<string, string | undefined>;
  }).env;
  return value?.[name];
}
const API_URL = env("VITE_APPS_SCRIPT_URL") || "/__api__";
const API_KEY = env("VITE_APPS_SCRIPT_KEY") || "";
function query(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}
async function get<T>(
  params: Record<string, string | undefined>,
): Promise<T> {
  const separator = API_URL.includes("?") ? "&" : "?";
  const response = await fetch(`${API_URL}${separator}${query(params)}`);
  const payload = await response.json();
  if (!payload || payload.ok === false)
    apiFailure(payload);
  return payload as T;
}
async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload || payload.ok === false)
    apiFailure(payload);
  return payload as T;
}
export function serializeDraft(draft: ChangeOrderDraft): SerializedDraft {
  const { source, ...rest } = draft;
  return {
    ...rest,
    source: source
      ? {
          name: source.name,
          pages: source.pages,
          driveFileId: source.driveFileId,
        }
      : null,
  };
}
export function deserializeDraft(data: SerializedDraft): ChangeOrderDraft {
  return {
    ...data,
    source: data.source
      ? {
          name: data.source.name,
          pages: data.source.pages,
          blob: null,
          driveFileId: data.source.driveFileId,
        }
      : null,
  };
}
function toSummary(row: ServerSummary): DraftSummary {
  return {
    id: row.id,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    step: row.step,
    changesCount: row.changesCount,
    sourceName: row.sourceName,
    hasSource: row.hasSource,
    job: {
      customer: row.customer,
      jobNumber: row.jobNumber,
      orderNumber: row.orderNumber,
    },
  };
}
export async function listDrafts(): Promise<DraftSummary[]> {
  const data = await get<{ drafts: ServerSummary[] }>({
    action: "list",
    key: API_KEY,
  });
  return data.drafts.map(toSummary);
}
export async function openDraft(id: string): Promise<ChangeOrderDraft> {
  const data = await get<{ draft: SerializedDraft }>({
    action: "open",
    key: API_KEY,
    id,
  });
  return deserializeDraft(data.draft);
}
export async function saveDraft(draft: ChangeOrderDraft): Promise<void> {
  await post<{ ok: true }>({
    action: "save",
    key: API_KEY,
    draft: serializeDraft(draft),
  });
}
export async function deleteDraft(id: string): Promise<void> {
  await post<{ ok: true }>({ action: "delete", key: API_KEY, id });
}
export async function uploadPdf(
  name: string,
  mimeType: string,
  base64: string,
  replaceFileId: string | null,
): Promise<string> {
  const data = await post<{ ok: true; fileId: string }>({
    action: "uploadPdf",
    key: API_KEY,
    name,
    mimeType,
    data: base64,
    replaceFileId,
  });
  return data.fileId;
}
export async function fetchSourcePdf(
  driveFileId: string,
): Promise<{ name: string; blob: Blob }> {
  const data = await get<{
    ok: true;
    name: string;
    mimeType: string;
    data: string;
  }>({ action: "pdf", key: API_KEY, id: driveFileId });
  return {
    name: data.name,
    blob: base64ToBlob(data.data, data.mimeType),
  };
}
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/pdf" });
}

export async function listRequests(): Promise<RequestSummary[]> {
  const data = await get<{ requests: RequestSummary[] }>({ action: "listRequests", key: API_KEY });
  return data.requests;
}
export async function openRequest(id: string): Promise<ChangeRequest> {
  const data = await get<{ request: ChangeRequest }>({ action: "openRequest", id, key: API_KEY });
  return data.request;
}
export async function saveRequest(request: ChangeRequest, expectedRevision: number, mutationId: string): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({ action: "saveRequest", request, expectedRevision, mutationId, key: API_KEY });
  return data.request;
}
export async function claimRequest(id: string, expectedRevision: number, estimatorName: string, mutationId: string): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({ action: "claimRequest", id, expectedRevision, estimatorName, mutationId, key: API_KEY });
  return data.request;
}
export async function transitionRequest(id: string, expectedRevision: number, status: RequestStatus, question: string, mutationId: string): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({ action: "transitionRequest", id, expectedRevision, status, question, mutationId, key: API_KEY });
  return data.request;
}
export interface AttachmentUpload { name: string; mimeType: string; size: number; kind: AttachmentKind; data: string }
export async function uploadAttachment(requestId: string, file: AttachmentUpload, attachmentId: string, mutationId: string): Promise<RequestAttachment> {
  const data = await post<{ attachment: RequestAttachment }>({ action: "uploadAttachment", requestId, attachmentId, mutationId, file, key: API_KEY });
  return data.attachment;
}
export async function fetchAttachment(requestId: string, attachmentId: string): Promise<{ name: string; blob: Blob }> {
  const data = await get<{ name: string; mimeType: string; data: string }>({ action: "fetchAttachment", requestId, attachmentId, key: API_KEY });
  return { name: data.name, blob: base64ToBlob(data.data, data.mimeType) };
}
export async function convertLegacyRequest(id: string, mutationId: string): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({ action: "convertLegacyRequest", id, mutationId, key: API_KEY });
  return data.request;
}
