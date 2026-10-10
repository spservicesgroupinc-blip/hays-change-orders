import { newId, type ChangeRequest } from "../types";
import { saveRequest } from "./storage";

export interface SaveTransaction {
  request: ChangeRequest;
  expectedRevision: number;
  mutationId: string;
  sequence: number;
}
export interface RecoveryRecord {
  request: ChangeRequest;
  sequence: number;
  acknowledged: number;
  transaction: SaveTransaction | null;
}
type Save = typeof saveRequest;
type Persist = (record: RecoveryRecord | null, id: string) => Promise<void>;

// One writer per open form. An uncertain network response keeps the exact retry
// identifier and snapshot, while edits made during a save remain in the form.
export class RequestEditor {
  sequence = 0;
  acknowledged = 0;
  transaction: SaveTransaction | null = null;
  status: "saved" | "saving" | "error" = "saved";
  error = "";
  recoveryError = "";
  private inFlight: Promise<void> | null = null;
  private persistence: Promise<void> = Promise.resolve();
  onUpdate = () => {};
  constructor(
    public current: ChangeRequest,
    private save: Save = saveRequest,
    private persist: Persist = persistRecovery,
    recovered?: RecoveryRecord,
  ) {
    if (recovered) {
      this.current = recovered.request;
      this.sequence = recovered.sequence;
      this.acknowledged = recovered.acknowledged;
      this.transaction = recovered.transaction;
      this.status = "error";
      this.error = "Recovered unsaved changes. Retry saving before submitting.";
    }
  }
  get dirty() {
    return this.sequence !== this.acknowledged || this.transaction !== null;
  }
  private retain() {
    const id = this.current.id;
    const snapshot = this.dirty
      ? structuredClone({
          request: this.current,
          sequence: this.sequence,
          acknowledged: this.acknowledged,
          transaction: this.transaction,
        })
      : null;
    this.persistence = this.persistence
      .then(() => this.persist(snapshot, id))
      .catch(() => {
        this.recoveryError =
          "Browser recovery storage is unavailable. Keep this form open until it saves, or download a recovery copy.";
        this.onUpdate();
      });
  }
  edit(next: ChangeRequest) {
    this.current = {
      ...next,
      revision: this.current.revision,
      updatedAt: new Date().toISOString(),
    };
    this.sequence++;
    this.status = "saving";
    this.retain();
    this.onUpdate();
  }
  commit(server: ChangeRequest) {
    this.current = server;
    this.sequence++;
    this.acknowledged = this.sequence;
    this.transaction = null;
    this.status = "saved";
    this.error = "";
    this.retain();
    this.onUpdate();
  }
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  private async run() {
    try {
      while (this.dirty) {
        this.status = "saving";
        this.error = "";
        const tx = this.transaction ?? {
          request: structuredClone(this.current),
          expectedRevision: this.current.revision,
          mutationId: newId(),
          sequence: this.sequence,
        };
        this.transaction = tx;
        this.retain();
        this.onUpdate();
        const server = await this.save(
          tx.request,
          tx.expectedRevision,
          tx.mutationId,
        );
        this.current =
          this.sequence === tx.sequence
            ? server
            : {
                ...this.current,
                revision: server.revision,
                createdAt: server.createdAt,
                updatedAt: server.updatedAt,
                status: server.status,
                estimatorName: server.estimatorName,
                submittedAt: server.submittedAt,
                informationQuestion: server.informationQuestion,
              };
        this.acknowledged = tx.sequence;
        this.transaction = null;
        this.retain();
      }
      this.status = "saved";
      this.onUpdate();
    } catch (error) {
      this.status = "error";
      this.error =
        error instanceof Error
          ? error.message
          : "The request could not be saved.";
      this.retain();
      this.onUpdate();
      throw error;
    }
  }
}

function recoveryDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("hays-request-recovery", 1);
    open.onupgradeneeded = () =>
      open.result.createObjectStore("requests", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
export async function persistRecovery(
  record: RecoveryRecord | null,
  id: string,
): Promise<void> {
  const db = await recoveryDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("requests", "readwrite");
      const store = tx.objectStore("requests");
      if (record) store.put({ id, ...record });
      else store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function listRecoveries(): Promise<RecoveryRecord[]> {
  const db = await recoveryDB();
  try {
    return await new Promise((resolve, reject) => {
      const read = db.transaction("requests").objectStore("requests").getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
  } finally {
    db.close();
  }
}
