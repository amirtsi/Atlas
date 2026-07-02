import { useEffect, useRef } from "react";
import { Maximize2, X } from "lucide-react";

import type { Accent } from "../api/atlas";

// Presentational UI primitives shared across features.

export function Chip({ children, accent = "neutral" }: { children: React.ReactNode; accent?: Accent }) {
  return <span className={`chip chip-${accent}`}>{children}</span>;
}

export function ProgressBar({ value, accent = "blue" }: { value: number; accent?: Accent }) {
  return (
    <div className="progress-track">
      <div className={`progress-fill progress-${accent}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function Panel({
  title,
  eyebrow,
  icon,
  className = "",
  onOpen,
  children
}: {
  title: string;
  eyebrow?: string;
  icon?: React.ReactNode;
  className?: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  const interactive = Boolean(onOpen);
  const interactiveProps = interactive
    ? {
        role: "button",
        tabIndex: 0,
        "aria-haspopup": "dialog" as const,
        "aria-label": `${title} — הצג פירוט`,
        onClick: onOpen,
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen?.();
          }
        }
      }
    : {};

  return (
    <section className={`panel ${interactive ? "panel-interactive" : ""} ${className}`} {...interactiveProps}>
      <div className="panel-content">
        <header className="panel-header">
          <div>
            {eyebrow ? <span className="panel-eyebrow">{eyebrow}</span> : null}
            <h2>{title}</h2>
          </div>
          {interactive ? (
            <div className="panel-expand" aria-hidden="true">
              <Maximize2 size={15} />
            </div>
          ) : icon ? (
            <div className="panel-icon">{icon}</div>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}

export function Modal({
  eyebrow,
  title,
  onClose,
  children,
  size = "default"
}: {
  eyebrow?: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "default" | "wide";
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className={`modal-sheet ${size === "wide" ? "modal-sheet-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={sheetRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h2 dir="auto">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="סגור">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
