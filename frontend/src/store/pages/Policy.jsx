import { Link } from 'react-router-dom';
import { useStore, useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { POLICIES, policyText } from '../lib/policies';
import { policySeo } from '../lib/seo';

// /envios, /cambios, /privacidad, /terminos: de flowContent o store_settings.policies.
// Si no hay texto no se inventa nada: se avisa que aún no está publicado.
export default function Policy({ kind }) {
  const { store } = useStore();
  const path = useStorePath();
  const title = POLICIES[kind]?.title || 'Información';
  const text = policyText(kind, store);
  useSeo(policySeo(useSeoContext(), { kind, store }));

  return (
    <article className="mx-auto max-w-2xl px-4 py-16 md:px-8">
      <h1 className="flow-display text-3xl">{title}</h1>
      <hr className="flow-rule my-8" />
      {text ? (
        <p className="whitespace-pre-line text-sm leading-relaxed">{text}</p>
      ) : (
        <div className="text-sm text-flow-muted">
          <p>Esta información aún no está publicada.</p>
          <Link to={path('/ayuda')} className="mt-4 inline-block underline">Ir a Ayuda</Link>
        </div>
      )}
    </article>
  );
}
