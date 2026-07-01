import { useEffect, useMemo, useState } from "react";
import { Newspaper, Quote as QuoteIcon } from "lucide-react";

import { Modal, Panel } from "../shared/ui";

// Self-contained side widgets: daily quote, Hacker News tile, and the
// API-offline placeholder. No dependency on app state.

const MOTIVATION_QUOTES: { text: string; author: string }[] = [
  { text: "You have power over your mind — not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { text: "Discipline equals freedom.", author: "Jocko Willink" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Aristotle" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "המעשים הקטנים שאתה עושה היום בונים את מי שתהיה מחר.", author: "Atlas" },
  { text: "Small daily improvements over time lead to stunning results.", author: "Robin Sharma" },
  { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
  { text: "What gets measured gets managed.", author: "Peter Drucker" },
  { text: "ההצלחה היא סך כל המאמצים הקטנים שחוזרים על עצמם יום אחרי יום.", author: "Robert Collier" },
  { text: "The successful warrior is the average man, with laser-like focus.", author: "Bruce Lee" },
  { text: "Well begun is half done.", author: "Aristotle" },
  { text: "Do something today that your future self will thank you for.", author: "Unknown" }
];

export function QuoteStrip() {
  const quote = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0).getTime();
    const dayOfYear = Math.floor((now.getTime() - start) / 86_400_000);
    return MOTIVATION_QUOTES[dayOfYear % MOTIVATION_QUOTES.length];
  }, []);

  return (
    <aside className="quote-strip" aria-label="ציטוט היום">
      <QuoteIcon size={16} aria-hidden="true" />
      <p dir="auto">
        {quote.text} <small>— {quote.author}</small>
      </p>
    </aside>
  );
}

type NewsItem = { id: number; title: string; url: string; score: number };

function useTechNews() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const ids: number[] = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json").then((response) => {
          if (!response.ok) {
            throw new Error("news");
          }
          return response.json();
        });
        const stories = await Promise.all(
          ids.slice(0, 10).map((id) =>
            fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((response) => response.json())
          )
        );
        if (!active) {
          return;
        }
        setItems(
          stories.filter(Boolean).map((story) => ({
            id: story.id,
            title: story.title,
            url: typeof story.url === "string" ? story.url : `https://news.ycombinator.com/item?id=${story.id}`,
            score: typeof story.score === "number" ? story.score : 0
          }))
        );
        setStatus("ready");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  return { items, status };
}

function NewsList({ items }: { items: NewsItem[] }) {
  return (
    <ul className="news-list">
      {items.map((item, index) => (
        <li className="news-item" key={item.id}>
          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
            <span className="news-rank">{index + 1}</span>
            <span className="news-title" dir="auto">{item.title}</span>
            <span className="news-score">▲ {item.score}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function NewsTile() {
  const { items, status } = useTechNews();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Panel
        title="Tech News"
        eyebrow="Hacker News · top stories"
        icon={<Newspaper size={21} />}
        className="news-panel"
        onOpen={() => setIsOpen(true)}
      >
        {status === "loading" ? <p className="news-empty">טוען חדשות טכנולוגיה…</p> : null}
        {status === "error" ? <p className="news-empty">לא ניתן לטעון חדשות כרגע. בדוק חיבור לרשת.</p> : null}
        {status === "ready" ? <NewsList items={items.slice(0, 4)} /> : null}
      </Panel>

      {isOpen ? (
        <Modal eyebrow="Hacker News" title="Tech News" onClose={() => setIsOpen(false)}>
          {status === "ready" ? (
            <NewsList items={items} />
          ) : (
            <p className="news-empty">{status === "error" ? "לא ניתן לטעון חדשות כרגע." : "טוען…"}</p>
          )}
        </Modal>
      ) : null}
    </>
  );
}

export function ApiUnavailablePanel() {
  return (
    <section className="api-unavailable-panel" aria-label="Atlas API unavailable">
      <div className="ai-core-wrap" aria-hidden="true">
        <div className="ai-core">
          <div className="ai-core-inner" />
        </div>
      </div>
      <div>
        <span>Atlas Core Offline</span>
        <h2>ה־API לא מחובר, לכן אין cockpit אמיתי להציג.</h2>
        <p>
          Atlas לא מציג יותר נתוני דמו במסך הראשי. הרץ את סביבת הפיתוח המלאה, ואז המסך ייטען מנתונים חיים בלבד.
        </p>
        <code>./scripts/dev.sh</code>
      </div>
    </section>
  );
}
