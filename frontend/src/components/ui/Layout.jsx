import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import AlertsPanel from './AlertsPanel';
import AIAssistant from './AIAssistant';
import SubscriptionWarning from './SubscriptionWarning';

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-[#080d18] overflow-x-hidden">
      <Sidebar />
      <main className="md:ml-[210px] min-h-screen flex-1 px-4 sm:px-6 py-6 pt-14 md:pt-6 overflow-x-hidden w-full min-w-0">
        <SubscriptionWarning />
        <Outlet />
      </main>
      <AlertsPanel />
      <AIAssistant />
    </div>
  );
}
