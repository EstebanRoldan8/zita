import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet, CalendarCheck, TrendingUp } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { getTimezone } from '../../lib/timezone';
import MonthSelector from '../../components/ui/MonthSelector';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-xs mb-1.5">
        <Icon size={14} className="text-violet-400" /> {label}
      </div>
      <p className="text-white text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-slate-500 text-xs mt-0.5">{hint}</p>}
    </div>
  );
}

// Comisiones del propio empleado (citas completadas × su porcentaje). No muestra datos de otros.
export default function MyCommissions() {
  const { business } = useAuth();
  const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: getTimezone(business?.country) }).slice(0, 7);
  const [month, setMonth] = useState(currentMonth);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['me', 'commissions', month],
    queryFn: () => api.get('/api/me/commissions', { params: { month } }).then((r) => r.data.data),
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-white text-xl font-bold">Mis comisiones</h1>
          <p className="text-slate-400 text-sm">
            {data ? `Tu comisión: ${Number(data.commission_percent)}% sobre las citas que marcas como hechas` : 'Sobre las citas que marcas como hechas'}
          </p>
        </div>
        <MonthSelector value={month} onChange={setMonth} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />)}
        </div>
      ) : isError || !data ? (
        <p className="text-slate-400 text-sm text-center py-16">No se pudieron cargar tus comisiones.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <Stat icon={Wallet} label="Comisión de hoy" value={formatCOP(data.today.commission)}
              hint={`${data.today.appointments} cita${data.today.appointments === 1 ? '' : 's'} hecha${data.today.appointments === 1 ? '' : 's'} hoy`} />
            <Stat icon={TrendingUp} label="Comisión del mes" value={formatCOP(data.period.commission)}
              hint={month === currentMonth ? 'Mes en curso' : undefined} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stat icon={CalendarCheck} label="Citas hechas en el mes" value={data.period.appointments} />
            <Stat icon={Wallet} label="Valor de esas citas" value={formatCOP(data.period.income)} />
          </div>
          {Number(data.commission_percent) === 0 && (
            <p className="text-slate-500 text-xs mt-4">Tu porcentaje de comisión está en 0 %. Si no es correcto, habla con el dueño del negocio.</p>
          )}
          <p className="text-slate-600 text-xs mt-4">Las ventas de productos no generan comisión.</p>
        </>
      )}
    </div>
  );
}
