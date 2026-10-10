import type { ChangeRequest, RequestStatus, RequestedChange } from "../types";

const STATUS_WORDS: Record<RequestStatus, string> = {
  draft: "Created",
  submitted: "Submitted",
  in_review: "In review",
  needs_information: "Needs information",
  ready: "Ready for customer",
  completed: "Completed",
};

const ACTION_WORDS: Record<RequestedChange["action"], string> = {
  add: "add",
  revise: "revise",
  remove: "remove",
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function formatDate(value: string | null | undefined): string {
  const text = clean(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US");
}

/**
 * Plain-text summary of a change order, written to be pasted into Dash (or any
 * other job site) after {@link copyTextToClipboard}. Every change order can
 * produce one, whatever its status.
 */
export function formatDashNote(request: ChangeRequest): string {
  const customer = clean(request.job.customer) || "Untitled job";
  const jobNumber = clean(request.job.jobNumber);
  const lines: string[] = [
    `Change order requested — ${customer}${jobNumber ? ` (${jobNumber})` : ""}`,
  ];
  const projectManager = clean(request.job.projectManager);
  if (projectManager) lines.push(`PM: ${projectManager}`);
  const address = clean(request.job.address);
  if (address) lines.push(`Address: ${address}`);
  const orderNumber = clean(request.job.orderNumber);
  if (orderNumber) lines.push(`Change order #: ${orderNumber}`);

  lines.push("");
  const changes = request.requestedChanges;
  if (changes.length) {
    for (const change of changes) {
      const room = clean(change.room);
      const action = ACTION_WORDS[change.action] ?? "change";
      const description = clean(change.description);
      lines.push(
        `- ${room ? `${room} — ${action}` : action}${description ? `: ${description}` : ""}`,
      );
    }
  } else {
    lines.push("- No changes described yet.");
  }
  lines.push("");

  const when = formatDate(request.submittedAt ?? request.createdAt);
  const status = `${STATUS_WORDS[request.status] ?? "Change order"}${
    when ? ` ${when}` : ""
  }`;
  lines.push(
    `${changes.length} ${changes.length === 1 ? "change" : "changes"} · ${status} · Estimator: ${
      clean(request.estimatorName) || "unassigned"
    }`,
  );
  return lines.join("\n");
}

function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/**
 * Copy text to the clipboard. The modern call is issued synchronously so it
 * still counts as a user gesture in Safari; the legacy selection copy covers
 * browsers that block the async clipboard API.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the selection-based copy.
    }
  }
  if (!legacyCopy(text)) throw new Error("The clipboard is unavailable.");
}
