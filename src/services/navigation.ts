/**
 * Hash routing for the change-order shell.
 *
 * The app is installed as a standalone PWA, so on a phone the operating
 * system's back gesture is the only "back" the user has. Every view therefore
 * owns a real history entry: back steps through the app instead of closing it,
 * and any view can be linked to or bookmarked.
 */
export type View =
  | { kind: "home" }
  | { kind: "request"; id: string }
  | { kind: "simple" };

/** The sections the app header can jump between. */
export type NavDestination = "home" | "simple";

export const HOME: View = { kind: "home" };

const VIEW_KEY = "hays-active-view";

export function destinationToView(destination: NavDestination): View {
  return destination === "simple" ? { kind: "simple" } : HOME;
}

export function viewToHash(view: View): string {
  switch (view.kind) {
    case "request":
      return `#/requests/${encodeURIComponent(view.id)}`;
    case "simple":
      return "#/simple";
    default:
      return "#/";
  }
}

/** Unknown or partial paths fall back to null so the caller can decide. */
export function hashToView(hash: string): View | null {
  const raw = (hash || "").replace(/^#/, "").split("?")[0];
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return HOME;
  switch (parts[0]) {
    case "simple":
      return { kind: "simple" };
    case "requests":
      return parts[1] ? { kind: "request", id: parts[1] } : null;
    default:
      return null;
  }
}

export function sameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "request" && b.kind === "request") return a.id === b.id;
  return true;
}

export function viewLabel(view: View): string {
  switch (view.kind) {
    case "request":
      return "Change order";
    case "simple":
      return "Quick request";
    default:
      return "All requests";
  }
}

/**
 * The view to show on a cold start: an explicit link in the URL wins, then the
 * view the user was last on, then the dashboard.
 */
export function initialView(): View {
  const hash = window.location.hash;
  if (hash.length > 1) {
    const fromHash = hashToView(hash);
    if (fromHash) return fromHash;
  }
  return readStoredView();
}

export function readStoredView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return HOME;
    const parsed = JSON.parse(raw) as Partial<View> & { id?: string };
    switch (parsed.kind) {
      case "request":
        return parsed.id ? { kind: "request", id: String(parsed.id) } : HOME;
      case "simple":
        return { kind: "simple" };
      default:
        return HOME;
    }
  } catch {
    return HOME;
  }
}

/** Forget the remembered view, so the next load starts at the dashboard. */
export function clearStoredView(): void {
  try {
    localStorage.removeItem(VIEW_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function persistView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // Storage is unavailable (private mode); routing still works for this tab.
  }
}

/** Push or replace a history entry without triggering a full navigation. */
export function writeHistory(view: View, mode: "push" | "replace"): void {
  const url = viewToHash(view);
  // Re-navigating to the current view must not stack a duplicate entry, or the
  // back gesture would appear to do nothing.
  if (window.location.hash === url) return;
  if (mode === "replace") window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}
