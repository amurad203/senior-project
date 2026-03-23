import { useState, useRef, useEffect } from 'react';
import { Bell, Settings, User, ChevronRight, LogOut } from 'lucide-react';

type DropdownType = 'notifications' | 'settings' | 'profile' | null;

const MOCK_NOTIFICATIONS = [
  { id: '1', title: 'Drone connected', message: 'DJI Mini 3 Pro is online', time: '2 min ago', unread: true },
  { id: '2', title: 'Detection complete', message: '3 vehicles detected in current view', time: '15 min ago', unread: true },
  { id: '3', title: 'Stream active', message: 'Live feed is running smoothly', time: '1 hour ago', unread: false },
];

export function Header() {
  const [openDropdown, setOpenDropdown] = useState<DropdownType>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenDropdown(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const toggleDropdown = (type: DropdownType) => {
    setOpenDropdown((prev) => (prev === type ? null : type));
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-zinc-800">
      <h1 className="text-lg font-medium text-white">
        Small VLMs for Zero-Shot Object Recognition
      </h1>
      <div ref={dropdownRef} className="flex items-center gap-1 relative">
        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown('notifications')}
            className={`p-2 rounded-lg transition-colors ${
              openDropdown === 'notifications'
                ? 'text-white bg-zinc-700'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            aria-label="Notifications"
            aria-expanded={openDropdown === 'notifications'}
          >
            <Bell size={20} />
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 text-[10px] font-medium text-white bg-red-500 rounded-full flex items-center justify-center">
              {MOCK_NOTIFICATIONS.filter((n) => n.unread).length}
            </span>
          </button>
          {openDropdown === 'notifications' && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700">
                <h3 className="font-medium text-white">Notifications</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Recent activity</p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {MOCK_NOTIFICATIONS.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`w-full px-4 py-3 text-left hover:bg-zinc-700/50 transition-colors border-b border-zinc-700/50 last:border-0 ${
                      n.unread ? 'bg-zinc-700/30' : ''
                    }`}
                  >
                    <p className="text-sm font-medium text-white">{n.title}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{n.message}</p>
                    <p className="text-xs text-zinc-500 mt-1">{n.time}</p>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="w-full px-4 py-2 text-sm text-blue-400 hover:bg-zinc-700/50 transition-colors"
                onClick={() => setOpenDropdown(null)}
              >
                View all notifications
              </button>
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown('settings')}
            className={`p-2 rounded-lg transition-colors ${
              openDropdown === 'settings'
                ? 'text-white bg-zinc-700'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            aria-label="Settings"
            aria-expanded={openDropdown === 'settings'}
          >
            <Settings size={20} />
          </button>
          {openDropdown === 'settings' && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700">
                <h3 className="font-medium text-white">Settings</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Configure your preferences</p>
              </div>
              <div className="py-2">
                {[
                  { label: 'Stream quality', value: '1080p' },
                  { label: 'Notifications', value: 'On' },
                  { label: 'Detection labels', value: 'On' },
                  { label: 'Theme', value: 'Dark' },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-700/50 transition-colors text-left"
                  >
                    <span className="text-sm text-zinc-200">{item.label}</span>
                    <span className="flex items-center gap-1 text-xs text-zinc-500">
                      {item.value}
                      <ChevronRight size={14} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown('profile')}
            className={`p-2 rounded-lg transition-colors ${
              openDropdown === 'profile'
                ? 'text-white bg-zinc-700'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            aria-label="Profile"
            aria-expanded={openDropdown === 'profile'}
          >
            <User size={20} />
          </button>
          {openDropdown === 'profile' && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                    <User size={20} className="text-white" />
                  </div>
                  <div>
                    <p className="font-medium text-white">Operator</p>
                    <p className="text-xs text-zinc-400">operator@uav.local</p>
                  </div>
                </div>
              </div>
              <div className="py-2">
                <button
                  type="button"
                  className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-zinc-700/50 transition-colors text-left text-sm text-zinc-200"
                >
                  <User size={16} />
                  Account
                </button>
                <button
                  type="button"
                  className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-zinc-700/50 transition-colors text-left text-sm text-zinc-200"
                >
                  <Settings size={16} />
                  Preferences
                </button>
                <button
                  type="button"
                  className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-red-500/20 hover:text-red-400 transition-colors text-left text-sm text-zinc-200"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
