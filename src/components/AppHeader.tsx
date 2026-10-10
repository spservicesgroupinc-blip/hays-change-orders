import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
  FolderOpen,
  Inbox,
  ListChecks,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import type { NavDestination } from "../services/navigation";
import "./AppHeader.css";

const NAV_ITEMS: {
  id: NavDestination;
  label: string;
  icon: ReactNode;
}[] = [
  { id: "home", label: "All requests", icon: <Inbox size={16} /> },
  { id: "orders", label: "Change orders", icon: <Archive size={16} /> },
  { id: "jobs", label: "Jobs", icon: <ListChecks size={16} /> },
  { id: "legacy", label: "Legacy editor", icon: <FolderOpen size={16} /> },
];

export interface AppHeaderProps {
  /** The section on screen, highlighted in the navigation. */
  current: NavDestination | "request";
  onNavigate: (destination: NavDestination) => void;
  /**
   * The way out of this screen. Sub-pages always show one so a phone user is
   * never stranded without a back control.
   */
  back?: { label: string; onClick: () => void };
  /** Breadcrumb text shown next to the back control. */
  subtitle?: ReactNode;
  /** Extra controls for the screen (for example the legacy "My drafts"). */
  actions?: ReactNode;
  /** Small label next to the brand. */
  context?: string;
  /**
   * Drop the "All requests" navigation item when the back control already has
   * that job, so the same action never appears twice.
   */
  hideHomeNav?: boolean;
  /** In-flight work, surfaced as a progress bar under the header. */
  busy?: string;
}

function BrandMark() {
  return (
    <>
      <svg viewBox="0 0 65 42" aria-hidden="true">
        <rect width="14" height="42" fill="#dc2626" />
        <rect x="36" width="14" height="42" fill="#1a1a1a" />
        <rect x="14" y="14" width="51" height="14" fill="#1a1a1a" />
      </svg>
      <div>
        <strong>Hays+Sons</strong>
        <span>CHANGE ORDERS</span>
      </div>
    </>
  );
}

export default function AppHeader({
  current,
  onNavigate,
  back,
  subtitle,
  actions,
  context,
  hideHomeNav,
  busy,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // The legacy editor's sticky rail has to start below the header, whose height
  // changes with the viewport and the breadcrumb row.
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--app-header-height",
        `${node.offsetHeight}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A section change always closes the sheet, and Escape backs out of it.
  useEffect(() => setMenuOpen(false), [current]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const items = hideHomeNav
    ? NAV_ITEMS.filter((item) => item.id !== "home")
    : NAV_ITEMS;

  return (
    <header className="app-header" ref={headerRef}>
      <div className="app-header-row">
        <a
          className="brand"
          href="#/"
          aria-label="Hays + Sons change orders home"
          onClick={(event) => {
            event.preventDefault();
            setMenuOpen(false);
            onNavigate("home");
          }}
        >
          <BrandMark />
        </a>
        <div className="app-header-tools">
          {context ? (
            <span className="local-label">
              <ShieldCheck size={15} />
              {context}
            </span>
          ) : null}
          {actions}
          <nav
            id="app-header-nav"
            className={`app-nav${menuOpen ? " is-open" : ""}`}
            aria-label="Sections"
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`button small app-nav-item${
                  current === item.id ? " is-current" : ""
                }`}
                aria-current={current === item.id ? "page" : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  onNavigate(item.id);
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="button small app-menu-button"
            aria-expanded={menuOpen}
            aria-controls="app-header-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={16} /> : <Menu size={16} />}
            Menu
          </button>
        </div>
      </div>
      {back || subtitle ? (
        <div className="app-header-sub">
          {back ? (
            <button
              type="button"
              className="app-back"
              onClick={() => {
                setMenuOpen(false);
                back.onClick();
              }}
            >
              <ArrowLeft size={16} />
              {back.label}
            </button>
          ) : null}
          {subtitle ? <span className="app-subtitle">{subtitle}</span> : null}
        </div>
      ) : null}
      {busy ? (
        <div
          className="app-progress"
          role="status"
          aria-live="polite"
          aria-label={busy}
        >
          <span />
        </div>
      ) : null}
    </header>
  );
}
