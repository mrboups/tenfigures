import { HELP_ARTICLES, helpBySlug } from "../help.ts";

export function HelpPage({
  slug,
  go,
}: {
  slug: string;
  go: (p: string) => void;
}) {
  const article = slug ? helpBySlug(slug) : null;
  if (slug && !article) {
    return (
      <div className="page help-page">
        <h1>Help</h1>
        <p className="muted">That page is not here.</p>
        <button type="button" className="ghost" onClick={() => go("/help")}>
          All help
        </button>
      </div>
    );
  }
  if (!article) {
    return (
      <div className="page help-page">
        <h1>Help</h1>
        <p className="muted">Short notes on the switches on the Trade ticket.</p>
        <ul className="help-index">
          {HELP_ARTICLES.map((a) => (
            <li key={a.slug}>
              <button type="button" className="help-item" onClick={() => go(`/help/${a.slug}`)}>
                <strong>{a.title}</strong>
                <span>{a.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="page help-page">
      <button type="button" className="ghost help-back" onClick={() => go("/help")}>
        All help
      </button>
      <h1>{article.title}</h1>
      <p className="help-lead">{article.summary}</p>
      {article.sections.map((s, i) => (
        <section key={i}>
          {s.heading ? <h2>{s.heading}</h2> : null}
          {s.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {s.example && s.example.length > 0 && (
            <div className="help-example">
              {s.example.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
        </section>
      ))}
      <div className="help-related">
        <h2>Also</h2>
        <ul>
          {HELP_ARTICLES.filter((a) => a.slug !== article.slug).map((a) => (
            <li key={a.slug}>
              <button type="button" className="link" onClick={() => go(`/help/${a.slug}`)}>
                {a.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
