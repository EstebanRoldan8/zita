import { ChevronDown } from 'lucide-react';

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export default function MonthSelector({ value, onChange }) {
  const [year, month] = value.split('-').map(Number);
  const currentYear = parseInt(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).split('-')[0]);
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const handleMonthChange = (newMonth) => {
    const newValue = `${year}-${String(newMonth + 1).padStart(2, '0')}`;
    onChange(newValue);
  };

  const handleYearChange = (newYear) => {
    const newValue = `${newYear}-${String(month).padStart(2, '0')}`;
    onChange(newValue);
  };

  return (
    <div className="flex gap-3" style={{ backgroundColor: '#1e293b' }}>
      {/* Mes dropdown */}
      <div className="relative">
        <select
          value={month - 1}
          onChange={(e) => handleMonthChange(Number(e.target.value))}
          className="appearance-none bg-slate-800 hover:bg-slate-700 border border-violet-500 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500 transition cursor-pointer pr-10"
          style={{
            backgroundColor: '#1e293b',
            borderColor: '#7c3aed',
            color: '#fff'
          }}
        >
          {MONTHS.map((m, i) => (
            <option key={i} value={i}>{m}</option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-400 pointer-events-none"
        />
      </div>

      {/* Año dropdown */}
      <div className="relative">
        <select
          value={year}
          onChange={(e) => handleYearChange(Number(e.target.value))}
          className="appearance-none bg-slate-800 hover:bg-slate-700 border border-violet-500 text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500 transition cursor-pointer pr-10"
          style={{
            backgroundColor: '#1e293b',
            borderColor: '#7c3aed',
            color: '#fff'
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-400 pointer-events-none"
        />
      </div>
    </div>
  );
}
