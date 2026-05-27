import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import AlertsPanel from './AlertsPanel';
import AIAssistant from './AIAssistant';
import SubscriptionWarning from './SubscriptionWarning';

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-[#080d18]">
      <Sidebar />
      <main className="md:ml-[210px] min-h-screen flex-1 overflow-auto px-6 py-6 pt-16 md:pt-6">
        <SubscriptionWarning />
        <Outlet />
      </main>
      <AlertsPanel />
      <AIAssistant />
    </div>
  );
}
