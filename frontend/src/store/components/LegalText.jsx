import { Link } from 'react-router-dom';
import { useStore, useStorePath } from '../hooks/useStore';
import { legalTokens } from '../lib/legal';

// Texto legal con sus marcas (negrita, enlaces, WhatsApp, correo). El texto sale tal cual de flowLegal.js.
export function LegalInline({ text }) {
  const { store } = useStore();
  const path = useStorePath();
  const render = (tokens) => tokens.map((t, i) => {
    if (t.type === 'bold') return <strong key={i}>{render(t.children)}</strong>;
    if (t.type === 'link') return <Link key={i} to={path(t.href)} className="underline underline-offset-2">{t.text}</Link>;
    if (t.type === 'a') {
      return (
        <a key={i} href={t.href} className="underline underline-offset-2 [overflow-wrap:anywhere]"
          {...(t.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{t.text}</a>
      );
    }
    return <span key={i}>{t.text}</span>;
  });
  return render(legalTokens(text, store));
}

function LegalTable({ head, rows }) {
  return (
    <div className="flow-legal-table my-6">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col" className="border-b border-flow-black py-2 pr-4 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-flow-stone align-top">
              {r.map((c, j) => (j === 0
                ? <th key={j} scope="row" className="py-3 pr-4 font-medium">{c}</th>
                : <td key={j} className="py-3 pr-4"><LegalInline text={c} /></td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Bloques de un documento: p, ul, h3, table, sign (firma)
export function LegalBlocks({ blocks }) {
  return (blocks || []).map((b, i) => {
    if (b.t === 'p') return <p key={i}><LegalInline text={b.text} /></p>;
    if (b.t === 'h3') return <h3 key={i} className="flow-legal-h3">{b.text}</h3>;
    if (b.t === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}><LegalInline text={it} /></li>)}</ul>;
    if (b.t === 'table') return <LegalTable key={i} head={b.head} rows={b.rows} />;
    if (b.t === 'sign') {
      return (
        <div key={i} className="flow-legal-sign">
          {b.lines.map((l, j) => <p key={j} className={j === 0 ? 'font-semibold' : ''}>{l}</p>)}
        </div>
      );
    }
    return null;
  });
}
