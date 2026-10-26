import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Printer } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { LEGAL_FORMS } from '../content/flowLegal';
import { FORMS, FORMS_TITLE } from '../lib/policies';
import { formOptions } from '../lib/legal';
import { formsSeo, formSeo } from '../lib/seo';
import { flowContent } from '../content/flowContent';
import { whatsappDisplay } from '../lib/contact';
import Logo from '../components/Logo';
import { PageNotFound } from '../components/States';
import BackLink from '../components/BackLink';

// Campos que piden texto largo
const LONG = /productos que devuelvo|descripción|dirección/i;
// Lo diligencia FLOW: se deja en blanco y no se puede escribir
const BY_FLOW = /lo asigna flow/i;

function Field({ field, id }) {
  const options = formOptions(field.value);
  if (BY_FLOW.test(field.label)) return <span className="flow-form-blank" aria-hidden="true" />;
  if (options) {
    return (
      <div className={options.some((o) => o.blank) ? 'flex flex-col gap-2' : 'flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6'}>
        {options.map((o, i) => (
          <label key={o.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
            <input type="checkbox" className="flow-form-check" name={`${id}-${i}`} />
            <span>{o.label}</span>
            {o.blank && <input type="text" className="flow-form-input col-start-2 w-full" aria-label={o.label} autoComplete="off" />}
          </label>
        ))}
      </div>
    );
  }
  return LONG.test(field.label)
    ? <textarea id={id} rows={3} className="flow-form-input flow-form-area w-full" autoComplete="off" />
    : <input id={id} type="text" className="flow-form-input w-full" autoComplete="off" />;
}

// /formatos/:formKind — Anexos 2 y 3 para diligenciar, imprimir o guardar en PDF.
// Nada se envía ni se guarda: lo escrito vive solo en la pantalla hasta imprimir.
export function FormPage() {
  const { formKind } = useParams();
  const { store } = useStore();
  const path = useStorePath();
  const form = FORMS[formKind] ? LEGAL_FORMS[formKind] : null;
  useSeo(formSeo(useSeoContext(), { kind: formKind, form }));
  if (!form) return <PageNotFound homePath={path('/')} />;
  const { email } = flowContent.brand;
  const wa = whatsappDisplay(store);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <BackLink />
      <div className="flow-noprint mb-8">
        <Link to={path('/formatos')} className="flow-label text-flow-muted hover:underline">{FORMS_TITLE}</Link>
        <h1 className="flow-display mt-2 text-3xl md:text-4xl">{form.title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-flow-muted">
          Puedes escribir aquí o imprimirlo en blanco. Envíalo firmado a {email}{wa ? ` o por WhatsApp al ${wa}` : ''}.
        </p>
        <button type="button" onClick={() => window.print()} className="flow-btn flow-btn-primary mt-6">
          <Printer size={16} strokeWidth={1.5} aria-hidden="true" /> Imprimir / guardar PDF
        </button>
      </div>

      <form className="flow-form-sheet" onSubmit={(e) => e.preventDefault()} aria-label={form.title}>
        <div className="flow-print-only mb-6"><Logo height={28} safeArea={false} /></div>
        <p className="text-center text-base font-semibold md:text-lg">{form.heading}</p>
        <p className="mt-1 text-center text-sm font-semibold">{form.basis}</p>
        <table className="flow-form-table mt-6 w-full border-collapse text-left text-sm">
          <thead>
            <tr>{form.fieldsHead.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
          </thead>
          <tbody>
            {form.fields.map((f, i) => (
              <tr key={f.label}>
                <th scope="row">
                  {BY_FLOW.test(f.label) || formOptions(f.value) ? f.label : <label htmlFor={`f${i}`}>{f.label}</label>}
                </th>
                <td><Field field={f} id={`f${i}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {form.statement.map((p) => <p key={p} className="mt-6 text-sm leading-relaxed">{p}</p>)}
        <div className="flow-legal-sign mt-12 text-sm">
          {form.signature.map((l, i) => <p key={l} className={i === 0 ? 'font-semibold' : 'mt-3'}>{l}</p>)}
        </div>
      </form>
    </div>
  );
}

// /formatos: los formatos públicos
export function FormsIndex() {
  const path = useStorePath();
  useSeo(formsSeo(useSeoContext()));
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <BackLink />
      <h1 className="flow-display text-3xl md:text-4xl">{FORMS_TITLE}</h1>
      <p className="mt-4 text-sm leading-relaxed text-flow-muted">
        Formatos para ejercer el derecho de retracto o solicitar la garantía. Las condiciones están en{' '}
        <Link to={path('/cambios')} className="underline underline-offset-2">Cambios, retracto, garantía y reversión del pago</Link>.
      </p>
      <ul className="mt-8 border-t border-flow-stone">
        {Object.entries(FORMS).map(([kind, f]) => (
          <li key={kind}>
            <Link to={path(`/formatos/${kind}`)} className="flex min-h-14 items-center justify-between gap-4 border-b border-flow-stone py-4 text-base">
              <span className="flex items-center gap-3"><Printer size={18} strokeWidth={1.5} aria-hidden="true" /> {f.title}</span>
              <ChevronRight size={18} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
