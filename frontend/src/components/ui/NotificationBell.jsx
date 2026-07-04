import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';

export default function NotificationBell() {
  const { data: notifications } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: () => api.get('/api/admin/notifications').then(r => r.data.data),
    refetchInterval: 30000,
  });

  const { data: systemAlerts } = useQuery({
    queryKey: ['admin-system-alerts'],
    queryFn: () => api.get('/api/admin/system-alerts').then(r => r.data.data),
    refetchInterval: 30000,
  });

  const unread = (notifications || []).filter(n => !n.read).length;
  const unreadAlerts = (systemAlerts || []).filter(a => !a.read_at).length;
  const totalUnread = unread + unreadAlerts;

  return (
    <Link to="/admin/notificaciones" className="relative p-2 text-slate-400 hover:text-white transition-colors">
      <Bell size={20} />
      {totalUnread > 0 && (
        <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-500 rounded-full">
          {totalUnread}
        </span>
      )}
    </Link>
  );
}
