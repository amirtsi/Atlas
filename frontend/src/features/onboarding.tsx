import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Compass, X } from "lucide-react";

import { advance, computeTooltipPosition, type Rect } from "./onboarding-logic";

type TourStep = { selector?: string; title: string; body: string };

// Anchors to existing class hooks — no changes to the tiles themselves.
const TOUR_STEPS: TourStep[] = [
  {
    title: "ברוך הבא ל-Atlas",
    body: "Atlas הוא ה-Life OS שלך — הכול מבוסס על נתונים אמיתיים בלבד. סיור קצר יעבור על כל היכולות."
  },
  {
    selector: ".tile-hero",
    title: "מרכז הפיקוד",
    body: "הדבר הכי נכון לעשות עכשיו, לצד התוכנית הפעילה והצעות המאמן. לחיצה פותחת את מרכז הפיקוד המלא."
  },
  {
    selector: ".life-pulse-panel",
    title: "מאזן שבועי",
    body: "Life Pulse מראה את האיזון בין תחומי החיים מתוך הפעילות שנרשמה השבוע."
  },
  {
    selector: ".mission-panel",
    title: "Mission Center",
    body: "המודולים הפעילים שלך וההתקדמות האמיתית בכל אחד מהם."
  },
  {
    selector: ".timeline-panel",
    title: "ציר הזמן",
    body: "כל הפעולות האמיתיות שרשמת היום, לפי שעה."
  },
  {
    selector: ".dashboard-calendar-panel",
    title: "לוח שנה",
    body: "מבט חודשי על הפעילות; לחיצה על יום פותחת פירוט מלא."
  },
  {
    selector: ".news-panel",
    title: "חדשות וציטוט",
    body: "Hacker News וציטוט יומי — ההקשר סביב היום שלך."
  },
  {
    selector: ".rail-log",
    title: "רישום מהיר",
    body: "כאן נותנים ל-Atlas signal: מתעדים פעילות אמיתית בכמה שניות."
  },
  {
    selector: ".rail-nav",
    title: "ניווט",
    body: "מכאן מגיעים ליומן, מודולים, Audit ותקשורת (WhatsApp)."
  },
  {
    title: "סיימת את הסיור",
    body: "אפשר להריץ אותו שוב בכל עת מכפתור הסיור בסרגל הצד. עכשיו — נסה לרשום פעולה אחת אמיתית."
  }
];

export function OnboardingTour({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  const total = TOUR_STEPS.length;
  const step = TOUR_STEPS[index];
  const isLast = index === total - 1;

  const measure = useCallback(() => {
    const el = step.selector ? document.querySelector(step.selector) : null;
    const r = el?.getBoundingClientRect();
    const nextRect: Rect | null = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
    setRect(nextRect);
    const tip = tooltipRef.current;
    const size = tip ? { width: tip.offsetWidth, height: tip.offsetHeight } : { width: 340, height: 190 };
    setPos(computeTooltipPosition(nextRect, size, { width: window.innerWidth, height: window.innerHeight }));
  }, [step.selector]);

  useLayoutEffect(() => {
    measure();
  }, [measure, index]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    tooltipRef.current?.focus();
  }, [index]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        setIndex((i) => (i === total - 1 ? (onClose(), i) : advance(i, total, 1)));
      } else if (event.key === "ArrowLeft") {
        setIndex((i) => advance(i, total, -1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, onClose]);

  const pad = 6;

  return (
    <div className="tour-overlay" role="presentation">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      ) : (
        <div className="tour-scrim-full" />
      )}

      <div
        className="tour-tooltip"
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        tabIndex={-1}
        style={{ top: pos.top, left: pos.left }}
      >
        <div className="tour-tooltip-head">
          <span className="tour-eyebrow">
            <Compass size={14} />
            סיור Atlas · {index + 1}/{total}
          </span>
          <button className="icon-button small" type="button" aria-label="דלג על הסיור" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <h3 dir="auto">{step.title}</h3>
        <p dir="auto">{step.body}</p>

        <div className="tour-foot">
          <div className="tour-dots" aria-hidden="true">
            {TOUR_STEPS.map((_, i) => (
              <span key={i} className={`tour-dot ${i === index ? "active" : ""}`} />
            ))}
          </div>
          <div className="tour-actions">
            <button className="btn-ghost tour-btn" type="button" onClick={onClose}>
              דלג
            </button>
            {index > 0 ? (
              <button className="btn-ghost tour-btn" type="button" onClick={() => setIndex((i) => advance(i, total, -1))}>
                <ArrowRight size={15} />
                הקודם
              </button>
            ) : null}
            {isLast ? (
              <button className="btn-primary tour-btn" type="button" onClick={onClose}>
                <Check size={16} />
                סיום
              </button>
            ) : (
              <button className="btn-primary tour-btn" type="button" onClick={() => setIndex((i) => advance(i, total, 1))}>
                הבא
                <ArrowLeft size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
