// Una tabla de la guía de tallas (flowContent.sizeGuide.tables[i]). En pantallas angostas la tabla
// tiene su propio scroll horizontal; la página nunca se desborda.
export default function SizeGuideTable({ table, headingLevel = 2 }) {
  if (!table) return null;
  const H = `h${headingLevel}`;
  return (
    <section aria-label={`Guía de tallas: ${table.title}`}>
      <H className="flow-serif mb-3 text-2xl">{table.title}</H>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[300px] text-left text-sm">
          <thead>
            <tr className="border-b border-flow-black">
              {table.columns.map((c) => <th key={c} scope="col" className="flow-label whitespace-nowrap py-2 pr-4">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-[color:var(--flow-sand)]">
                {(Array.isArray(row) ? row : []).map((cell, j) => (j === 0
                  ? <th key={j} scope="row" className="py-3 pr-4 font-medium">{cell}</th>
                  : <td key={j} className="whitespace-nowrap py-3 pr-4">{cell}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
