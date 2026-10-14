// Tabla de la guía de tallas (flowContent.sizeGuide). Solo se usa si la guía existe.
export default function SizeGuideTable({ guide }) {
  if (!guide) return null;
  return (
    <div>
      {guide.intro && <p className="mb-4 text-sm text-flow-muted">{guide.intro}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-sm">
          <thead>
            <tr className="border-b border-flow-black">
              {guide.columns.map((c) => <th key={c} scope="col" className="flow-label py-2 pr-4">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {guide.rows.map((row, i) => (
              <tr key={i} className="border-b border-[color:var(--flow-sand)]">
                {(Array.isArray(row) ? row : []).map((cell, j) => <td key={j} className="py-2 pr-4">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
