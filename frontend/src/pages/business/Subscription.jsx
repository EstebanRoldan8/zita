import { useState, useEffect } from 'react';
import { CreditCard, AlertCircle, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

const PLAN_COLORS = {
  lite: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  estandar: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  pro: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
};

const PLAN_ORDER = { lite: 0, estandar: 1, pro: 2 };

const PLAN_DESCRIPTIONS = {
  lite: 'Para negocios que están comenzando',
  estandar: 'El más popular entre nuestros clientes',
  pro: 'Para negocios que quieren crecer sin límites'
};

const ALL_FEATURES = [
  'bot_whatsapp',
  'citas',
  'empleados',
  'caja',
  'clientes',
  'productos',
  'analiticas',
  'configuracion',
  'asistente_ia',
  'campanas',
  'reportes_pdf',
  'multi_sede',
  'pedidos'
];

const PLAN_FEATURES = {
  lite: ['bot_whatsapp', 'citas', 'empleados', 'caja', 'configuracion'],
  estandar: ['bot_whatsapp', 'citas', 'empleados', 'caja', 'clientes', 'productos', 'analiticas', 'configuracion', 'asistente_ia'],
  pro: ALL_FEATURES
};

const BUSINESS_TYPE_CONFIG = {
  barberia:    { usa_citas: true,  usa_pedidos: false, label_citas: 'citas agendadas' },
  spa:         { usa_citas: true,  usa_pedidos: false, label_citas: 'citas agendadas' },
  veterinaria: { usa_citas: true,  usa_pedidos: false, label_citas: 'consultas agendadas' },
  salud:       { usa_citas: true,  usa_pedidos: false, label_citas: 'consultas agendadas' },
  tienda:      { usa_citas: true,  usa_pedidos: true,  label_citas: 'citas agendadas', label_pedidos: 'pedidos procesados' },
};

const DEFAULT_TYPE_CONFIG = { usa_citas: true, usa_pedidos: false, label_citas: 'citas agendadas' };

const FEATURE_LABELS = {
  'bot_whatsapp': 'Bot WhatsApp',
  'citas': 'Citas',
  'empleados': 'Empleados',
  'caja': 'Caja',
  'clientes': 'Clientes',
  'productos': 'Productos',
  'analiticas': 'Analíticas',
  'configuracion': 'Configuración',
  'asistente_ia': 'Asistente IA',
  'campanas': 'Campañas',
  'reportes_pdf': 'Reportes PDF',
  'multi_sede': 'Multi-sede',
  'pedidos': 'Pedidos'
};

export default function Subscription() {
  const { business } = useAuth();
  const typeConfig = BUSINESS_TYPE_CONFIG[business?.business_type] || DEFAULT_TYPE_CONFIG;
  const [sub, setSub] = useState(null);
  const [selectedPlanTab, setSelectedPlanTab] = useState(null);
  const [loading, setLoading] = useState(true);
  const [upgradeModal, setUpgradeModal] = useState(null);

  useEffect(() => {
    const fetchSub = async () => {
      try {
        const { data } = await api.get('/api/subscription');
        setSub(data.data);
      } catch (err) {
        console.error('Error fetching subscription:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSub();
  }, []);

  if (loading) return <div className="p-6 text-slate-400">Cargando...</div>;
  if (!sub) return <div className="p-6 text-red-400">Error al cargar suscripción</div>;

  console.log('plan actual:', sub?.plan, 'estado:', sub?.estado);
  const currentPlanOrder = PLAN_ORDER[sub.plan] ?? 0;
  const nextPlanKey = Object.keys(PLAN_ORDER).find(k => PLAN_ORDER[k] === currentPlanOrder + 1) || 'pro';
  if (selectedPlanTab === null) setSelectedPlanTab(nextPlanKey);
  const getStateText = () => {
    if (sub.estado === 'trial') {
      return `🎁 Trial activo — ${sub.dias_restantes} días restantes`;
    } else if (sub.estado === 'active') {
      return `✅ Plan activo — vence el ${new Date(sub.plan_expires_at).toLocaleDateString('es-CO')}`;
    } else if (sub.estado === 'grace') {
      return `⚠️ Vencido — tienes 3 días para renovar`;
    } else {
      return `🔴 Suscripción vencida`;
    }
  };

  const getProgressColor = (percent) => {
    if (percent >= 100) return 'bg-red-500';
    if (percent >= 80) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  const getNextPlan = () => {
    if (sub.plan === 'lite') return 'estandar';
    if (sub.plan === 'estandar') return 'pro';
    return null;
  };

  const formatFeatureName = (feature) => {
    return FEATURE_LABELS[feature] || feature.replace(/_/g, ' ');
  };

  const getFeatureDescription = (feature, planKey) => {
    const p = sub.todos_los_planes[planKey];
    switch(feature) {
      case 'citas':
        if (!typeConfig.usa_citas) return null;
        return p.max_appointments_month === -1
          ? `${typeConfig.label_citas} ilimitadas`
          : `Hasta ${p.max_appointments_month} ${typeConfig.label_citas}/mes`;
      case 'pedidos':
        if (!typeConfig.usa_pedidos) return null;
        return p.max_orders_month === -1
          ? 'pedidos ilimitados'
          : `Hasta ${p.max_orders_month} pedidos/mes`;
      case 'empleados':
        return p.max_employees === -1
          ? 'Empleados ilimitados'
          : `Hasta ${p.max_employees} empleados activos`;
      case 'asistente_ia':
        return p.ai_messages_day === -1
          ? 'Mensajes ilimitados con IA'
          : p.ai_messages_day === 0
          ? 'No incluido en este plan'
          : `${p.ai_messages_day} mensajes diarios con IA`;
      case 'bot_whatsapp':
        return 'Agendamiento automático 24/7';
      case 'caja':
        return planKey === 'lite'
          ? 'Ingresos del día y mes con meta mensual'
          : 'Control completo de ingresos y egresos';
      case 'configuracion':
        return planKey === 'lite'
          ? 'Horarios, perfil y conexión WhatsApp'
          : 'Personalización completa del negocio';
      case 'clientes':
        return 'Historial y fidelización de clientes';
      case 'productos':
        return 'Inventario y control de stock';
      case 'analiticas':
        return 'Retención y comportamiento de clientes';
      case 'campanas':
        return 'Mensajes masivos a tus clientes';
      case 'reportes_pdf':
        return 'Reporte mensual automático por email';
      case 'multi_sede':
        return 'Gestiona múltiples sucursales';
      default:
        return null;
    }
  };

  const plans = Object.entries(sub.todos_los_planes).map(([key, plan]) => ({
    key,
    ...plan
  }));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-white text-xl sm:text-2xl font-bold">Mi Suscripción</h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1">Gestiona tu plan y revisa el uso</p>
      </div>

      {/* SECCIÓN 1 — Estado actual */}
      <div className={`mb-6 p-4 sm:p-6 rounded-xl border ${PLAN_COLORS[sub.plan]}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">{sub.plan_name}</span>
          <span className="text-xs bg-white/10 px-3 py-1 rounded-full">${sub.price.toLocaleString('es-CO')}/mes</span>
        </div>
        <p className="text-slate-300 text-sm sm:text-base">{getStateText()}</p>

        {sub.estado === 'trial' && (
          <div className="mt-4 bg-black/30 rounded-lg overflow-hidden h-2">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
              style={{ width: `${((30 - sub.dias_restantes) / 30) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* SECCIÓN 2 — Uso actual (solo si no es Pro) */}
      {sub.plan !== 'pro' && (
        <div className="mb-6 grid gap-4">
          <h2 className="text-slate-300 text-sm font-semibold">Uso actual</h2>

          {/* Citas */}
          {sub.limites.max_appointments_month !== -1 && (
            <div className="bg-[#131929] border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-300 text-sm font-medium">Citas este mes</span>
                <span className="text-slate-400 text-xs">{sub.uso.citas_mes} / {sub.limites.max_appointments_month}</span>
              </div>
              <div className="bg-black/30 rounded-lg overflow-hidden h-2">
                <div
                  className={`h-full ${getProgressColor((sub.uso.citas_mes / sub.limites.max_appointments_month) * 100)}`}
                  style={{ width: `${Math.min((sub.uso.citas_mes / sub.limites.max_appointments_month) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Empleados */}
          {sub.limites.max_employees !== -1 && (
            <div className="bg-[#131929] border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-300 text-sm font-medium">Empleados activos</span>
                <span className="text-slate-400 text-xs">{sub.uso.empleados_activos} / {sub.limites.max_employees}</span>
              </div>
              <div className="bg-black/30 rounded-lg overflow-hidden h-2">
                <div
                  className={`h-full ${getProgressColor((sub.uso.empleados_activos / sub.limites.max_employees) * 100)}`}
                  style={{ width: `${Math.min((sub.uso.empleados_activos / sub.limites.max_employees) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* IA Messages */}
          {sub.plan === 'lite' ? (
            <div className="flex items-center justify-between bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-violet-400">🤖</span>
                <span className="text-sm text-slate-300">Asistente IA no incluido en tu plan</span>
              </div>
              <a href="/dashboard/suscripcion" className="text-xs text-violet-400 hover:text-violet-300 font-medium whitespace-nowrap">
                Activar con Estándar →
              </a>
            </div>
          ) : sub.limites.ai_messages_day === 0 ? (
            <div className="bg-[#131929] border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-300 text-sm font-medium">Mensajes IA diarios</span>
                <span className="text-slate-500 text-xs italic">No incluido en este plan</span>
              </div>
              <div className="bg-black/30 rounded-lg overflow-hidden h-2">
                <div className="h-full bg-gray-700" style={{ width: '0%' }} />
              </div>
            </div>
          ) : (
            <div className="bg-[#131929] border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-300 text-sm font-medium">Mensajes IA hoy</span>
                <span className="text-slate-400 text-xs">{sub.uso.ai_messages_today} / {sub.limites.ai_messages_day}</span>
              </div>
              <div className="bg-black/30 rounded-lg overflow-hidden h-2">
                <div
                  className={`h-full ${getProgressColor((sub.uso.ai_messages_today / sub.limites.ai_messages_day) * 100)}`}
                  style={{ width: `${Math.min((sub.uso.ai_messages_today / sub.limites.ai_messages_day) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECCIÓN 3 — Comparativo de planes */}
      <div className="mb-6 pt-6">
        <h2 className="text-slate-300 text-sm font-semibold mb-4 text-center md:text-left">Planes disponibles</h2>
        <div>
          {/* Tabs solo en móvil */}
          <div className="flex lg:hidden gap-2 mb-4">
            {['lite', 'estandar', 'pro'].map((key) => (
              <button
                key={key}
                onClick={() => setSelectedPlanTab(key)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all duration-200 border ${
                  selectedPlanTab === key
                    ? key === 'lite'
                      ? 'bg-slate-700 border-slate-500 text-white'
                      : key === 'estandar'
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400'
                    : 'bg-white/5 border-white/10 text-slate-400'
                }`}
              >
                {key === 'lite' ? 'Lite' : key === 'estandar' ? 'Estándar' : 'Pro'}
              </button>
            ))}
          </div>
          <div className="lg:grid lg:grid-cols-3 lg:gap-6 max-w-5xl mx-auto items-stretch pt-2 lg:pt-8">
          {plans.map((plan) => {
            const isCurrent = plan.key === sub.plan;
            const planOrder = PLAN_ORDER[plan.key];
            const isHigher = planOrder > currentPlanOrder;
            const isLower = planOrder < currentPlanOrder;
            const planFeatures = PLAN_FEATURES[plan.key] || [];

            let cardBg, cardBorder, planNameColor, priceColor, buttonClass, shadowClass;

            if (plan.key === 'lite') {
              cardBg = 'bg-gradient-to-b from-slate-800/40 to-gray-900/40';
              cardBorder = 'border-slate-600/50';
              planNameColor = 'text-slate-300';
              priceColor = 'text-gray-300';
              shadowClass = 'shadow-lg shadow-gray-900/50';
              buttonClass = isCurrent ? 'bg-gray-700 text-gray-300 cursor-default' : isHigher ? 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white' : 'bg-gray-700 text-gray-300 cursor-default';
            } else if (plan.key === 'estandar') {
              cardBg = 'bg-gradient-to-b from-violet-950/60 to-gray-900/60';
              cardBorder = 'border-violet-500 border-2';
              planNameColor = 'text-violet-400';
              priceColor = 'text-violet-300';
              shadowClass = 'shadow-xl shadow-violet-500/25';
              buttonClass = isCurrent ? 'bg-violet-900/50 text-violet-300 cursor-default' : isHigher ? 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-black font-bold' : 'bg-violet-900/30 text-slate-400 cursor-default';
            } else {
              cardBg = 'bg-gradient-to-b from-yellow-950/40 to-gray-900/60';
              cardBorder = 'border-yellow-400/40 border-2';
              planNameColor = 'text-yellow-400';
              priceColor = 'text-yellow-300';
              shadowClass = 'shadow-xl shadow-yellow-400/10';
              buttonClass = isCurrent ? 'bg-yellow-600/50 text-yellow-300 cursor-default' : 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-black font-black shadow-lg shadow-yellow-500/30';
            }

            return (
              <div
                key={plan.key}
                className={`${selectedPlanTab !== plan.key ? 'hidden lg:flex' : ''} flex-shrink-0 w-[85vw] lg:w-auto min-w-0 flex flex-col rounded-2xl border p-7 relative overflow-visible ${cardBg} backdrop-blur-sm ${shadowClass} ${cardBorder}`}
              >
                {isCurrent && (
                  <div className="absolute top-[-12px] left-1/2 -translate-x-1/2 bg-violet-600 text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap">
                    Tu plan actual
                  </div>
                )}

                <div className="min-h-[100px] flex flex-col justify-between">
                  <div>
                    <p className={`text-2xl font-black text-white uppercase tracking-widest mb-1 text-center ${planNameColor}`}>
                      {plan.name}
                    </p>
                    <div className="flex items-end justify-center gap-1 mt-1">
                      <span className="text-5xl font-black text-white">${(plan.price / 1000).toFixed(0)}k</span>
                      <span className="text-sm text-gray-400 mb-2">/mes</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 text-center">{PLAN_DESCRIPTIONS[plan.key]}</p>
                </div>

                <hr className="border-gray-700/50 my-4" />

                <div className="flex-grow space-y-2.5 mb-6">
                  {plan.key === 'pro' ? (
                    ALL_FEATURES.filter(f => f !== 'pedidos' || typeConfig.usa_pedidos).map((feature) => (
                      <li key={feature} className="flex flex-col gap-0.5 list-none">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                          <span className="text-sm text-gray-200">{formatFeatureName(feature)}</span>
                        </div>
                        {getFeatureDescription(feature, plan.key) && (
                          <p className="text-xs text-gray-500 ml-6">
                            {getFeatureDescription(feature, plan.key)}
                          </p>
                        )}
                      </li>
                    ))
                  ) : (
                    <>
                      {planFeatures.filter(f => f !== 'pedidos' || typeConfig.usa_pedidos).map((feature) => (
                        <li key={feature} className="flex flex-col gap-0.5 list-none">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                            <span className="text-sm text-gray-200">{formatFeatureName(feature)}</span>
                          </div>
                          {getFeatureDescription(feature, plan.key) && (
                            <p className="text-xs text-gray-500 ml-6">
                              {getFeatureDescription(feature, plan.key)}
                            </p>
                          )}
                        </li>
                      ))}
                      {plan.key === 'lite' && (
                        <div className="mt-3 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-center">
                          <p className="text-xs text-violet-300">
                            ✨ Desbloquea panel completo y asistente IA
                          </p>
                          <p className="text-xs text-violet-400 font-medium mt-0.5">
                            desde $100k/mes →
                          </p>
                        </div>
                      )}
                      {plan.key !== 'lite' && (ALL_FEATURES.filter(f => f !== 'pedidos' || typeConfig.usa_pedidos).length - planFeatures.filter(f => f !== 'pedidos' || typeConfig.usa_pedidos).length) > 0 && (
                        <p className="text-xs text-gray-600 mt-3 italic">
                          + {ALL_FEATURES.filter(f => f !== 'pedidos' || typeConfig.usa_pedidos).length - planFeatures.filter(f => f !== 'pedidos' || typeConfig.usa_pedidos).length} funciones más disponibles en Plan Pro
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div>
                  {(() => {
                    const cardOrder = PLAN_ORDER[plan.key] ?? 0;
                    const currentOrder = PLAN_ORDER[sub.plan] ?? 0;

                    if (cardOrder === currentOrder) {
                      return (
                        <button disabled
                          className="w-full py-2.5 rounded-xl bg-gray-700/50 text-gray-400 text-sm font-medium cursor-default">
                          ✓ Tu plan actual
                        </button>
                      );
                    }
                    if (cardOrder < currentOrder) {
                      return (
                        <button disabled
                          className="w-full py-2.5 rounded-xl bg-gray-800/50 text-gray-600 text-sm cursor-default">
                          Ya tienes mejor plan
                        </button>
                      );
                    }
                    const planNames = { estandar: 'Estándar', pro: 'Pro' };
                    const btnClass = plan.key === 'pro'
                      ? "w-full py-2.5 rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-black font-black text-sm transition-all shadow-lg shadow-yellow-500/30"
                      : "w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm transition-all shadow-lg shadow-violet-500/30";
                    return (
                      <div>
                        <p className="text-xs text-center text-gray-500 mb-2">
                          Precio de lanzamiento — garantizado mientras sigas activo
                        </p>
                        <button onClick={() => setUpgradeModal(plan.key)} className={btnClass}>
                          Mejorar a {planNames[plan.key]}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* SECCIÓN 4 — CTA dinámico */}
      {sub.plan !== 'pro' && (
        <div className="space-y-3">
          {sub.limites.max_appointments_month !== -1 && sub.uso.citas_mes >= sub.limites.max_appointments_month * 0.8 && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <div>
                <p className="text-blue-300 text-sm">
                  📈 Usaste el {Math.round((sub.uso.citas_mes / sub.limites.max_appointments_month) * 100)}% de tus citas este mes.
                  {getNextPlan() && ` Con Plan ${sub.todos_los_planes[getNextPlan()].name} tendrías ${sub.todos_los_planes[getNextPlan()].max_appointments_month === -1 ? 'citas ilimitadas' : sub.todos_los_planes[getNextPlan()].max_appointments_month + ' citas'}.`}
                </p>
                {getNextPlan() && (
                  <button
                    onClick={() => setUpgradeModal(getNextPlan())}
                    className="mt-2 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition"
                  >
                    Mejorar
                  </button>
                )}
              </div>
            </div>
          )}

          {sub.limites.max_employees !== -1 && sub.uso.empleados_activos >= sub.limites.max_employees && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
              <div>
                <p className="text-orange-300 text-sm">
                  👥 Llegaste al límite de empleados de tu plan.
                  {getNextPlan() && ` Con Plan ${sub.todos_los_planes[getNextPlan()].name} puedes tener ${sub.todos_los_planes[getNextPlan()].max_employees === -1 ? 'empleados ilimitados' : 'más empleados'}.`}
                </p>
                {getNextPlan() && (
                  <button
                    onClick={() => setUpgradeModal(getNextPlan())}
                    className="mt-2 text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded transition"
                  >
                    Mejorar
                  </button>
                )}
              </div>
            </div>
          )}

          {sub.limites.ai_messages_day > 0 && sub.uso.ai_messages_today >= sub.limites.ai_messages_day * 0.8 && (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
              <div>
                <p className="text-purple-300 text-sm">
                  🤖 Casi agotaste tus mensajes IA de hoy. Con Plan Pro son ilimitados.
                </p>
                <button
                  onClick={() => setUpgradeModal('pro')}
                  className="mt-2 text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded transition"
                >
                  Mejorar a Pro
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de upgrade */}
      {upgradeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-4 sm:py-0">
          <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-white font-semibold text-lg mb-4">
              Actualizar a {sub.todos_los_planes[upgradeModal].name}
            </h3>
            <p className="text-slate-400 text-sm mb-6">
              Próximamente podrás pagar directamente aquí. Por ahora escríbenos por WhatsApp
              y te activamos el plan en minutos. 🚀
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setUpgradeModal(null)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-sm font-medium transition"
              >
                Cancelar
              </button>
              <a
                href="https://wa.me/573001234567"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2.5 rounded-lg text-sm font-medium transition text-center"
              >
                Escribir en WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
