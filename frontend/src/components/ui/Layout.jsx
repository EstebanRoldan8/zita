import { Outlet } from 'react-router-dom';
import { Bell } from 'lucide-react';
import Sidebar from './Sidebar';
import AlertsPanel from './AlertsPanel';
import AIAssistant from './AIAssistant';
import SubscriptionWarning from './SubscriptionWarning';

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-[#080d18] overflow-x-hidden">
      <Sidebar />
      <div className="hidden md:flex fixed top-0 left-[210px] right-0 h-14 bg-[#0a0f1e] border-b border-white/5 z-30 items-center justify-center">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ZITA" className="h-6 w-6 object-contain" />
          <span className="text-white font-bold text-lg tracking-tight">ZITA</span>
        </div>
        <div className="absolute right-4">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('toggle-alerts'))}
            className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/5 transition"
          >
            <Bell size={18} className="text-white/70" />
            <span id="desktop-alerts-badge" className="hidden absolute -top-1 -right-1 w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold items-center justify-center" />
          </button>
        </div>
      </div>
      <main className="md:ml-[210px] min-h-screen flex-1 px-4 sm:px-6 py-6 pt-14 overflow-x-hidden w-full min-w-0">
        <SubscriptionWarning />
        <Outlet />
      </main>
      <AlertsPanel />
      <AIAssistant />
    </div>
  );
}
