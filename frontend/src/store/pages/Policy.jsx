import { useStore } from '../hooks/useStore';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { POLICY_FALLBACK, POLICY_TITLES } from '../lib/copy';

// /envios, /cambios, /privacidad desde store_settings.policies; si falta, texto base pendiente
export default function Policy({ kind }) {
  const { store } = useStore();
  const title = POLICY_TITLES[kind];
  const text = store.policies?.[kind];
  useDocumentMeta(`${title} — ${store.name || 'Flow'}`, `${title} de ${store.name || 'Flow'}.`);

  return (
    <article className="mx-auto max-w-2xl px-4 py-16 md:px-8">
      <h1 className="flow-display text-3xl">{title}</h1>
      <hr className="flow-rule my-8" />
      {text ? (
        <p className="whitespace-pre-line text-sm leading-relaxed">{text}</p>
      ) : (
        <p className="whitespace-pre-line text-sm leading-relaxed text-flow-muted" data-placeholder={`politica-${kind}`}>
          {POLICY_FALLBACK[kind]}
        </p>
      )}
    </article>
  );
}
