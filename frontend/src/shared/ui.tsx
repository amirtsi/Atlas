import { Maximize2 } from "lucide-react";

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
