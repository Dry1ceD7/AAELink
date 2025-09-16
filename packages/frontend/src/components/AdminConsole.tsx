import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AdminStats {
  users: number;
  messages: number;
  files: number;
  organizations: number;
  activeConnections: number;
  systemHealth: 'healthy' | 'warning' | 'error';
  lastSync: string;
}

interface ERPStatus {
  status: 'connected' | 'disconnected' | 'error';
  lastSync: string;
  integrations: string[];
  errors?: string[];
}

interface AdminConsoleProps {
  onClose?: () => void;
}

const AdminConsole: React.FC<AdminConsoleProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'erp' | 'system'>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [erpStatus, setErpStatus] = useState<ERPStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncLoading, setSyncLoading] = useState(false);

  useEffect(() => {
    loadAdminData();
  }, []);

  const loadAdminData = async () => {
    try {
      setLoading(true);

      // Load admin stats
      const statsResponse = await fetch('/api/admin/stats', {
        credentials: 'include'
      });
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData);
      }

      // Load ERP status
      const erpResponse = await fetch('/api/erp/status', {
        credentials: 'include'
      });
      if (erpResponse.ok) {
        const erpData = await erpResponse.json();
        setErpStatus(erpData);
      }
    } catch (error) {
      console.error('Failed to load admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleERPSync = async (type: 'users' | 'data') => {
    try {
      setSyncLoading(true);

      const endpoint = type === 'users' ? '/api/erp/sync/users' : '/api/erp/sync/data';
      const body = type === 'data' ? { dataType: 'projects' } : {};

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`${type} sync result:`, result);
        // Refresh data
        await loadAdminData();
      }
    } catch (error) {
      console.error(`${type} sync failed:`, error);
    } finally {
      setSyncLoading(false);
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return 'text-green-600 dark:text-green-400';
      case 'warning': return 'text-yellow-600 dark:text-yellow-400';
      case 'error': return 'text-red-600 dark:text-red-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'text-green-600 dark:text-green-400';
      case 'disconnected': return 'text-gray-600 dark:text-gray-400';
      case 'error': return 'text-red-600 dark:text-red-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('admin.title')}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8 px-6">
            {[
              { id: 'overview', label: t('admin.overview', 'Overview') },
              { id: 'users', label: t('admin.userManagement') },
              { id: 'erp', label: t('admin.erpIntegration', 'ERP Integration') },
              { id: 'system', label: t('admin.systemSettings') }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* System Health */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                  <div className="flex items-center">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                      <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('admin.totalUsers')}</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.users || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                  <div className="flex items-center">
                    <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                      <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('admin.messages')}</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.messages || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                  <div className="flex items-center">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded-lg">
                      <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('admin.files')}</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.files || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                  <div className="flex items-center">
                    <div className="p-2 bg-orange-100 dark:bg-orange-900/20 rounded-lg">
                      <svg className="w-6 h-6 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('admin.organizations')}</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.organizations || 0}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* System Status */}
              <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  {t('admin.systemStatus', 'System Status')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full mr-3 ${
                      stats?.systemHealth === 'healthy' ? 'bg-green-500' :
                      stats?.systemHealth === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`}></div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t('admin.systemHealth', 'System Health')}:
                      <span className={`ml-2 font-medium ${getHealthColor(stats?.systemHealth || 'unknown')}`}>
                        {stats?.systemHealth || 'Unknown'}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t('admin.activeConnections', 'Active Connections')}:
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {stats?.activeConnections || 0}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-blue-500 rounded-full mr-3"></div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t('admin.lastSync', 'Last Sync')}:
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {stats?.lastSync ? new Date(stats.lastSync).toLocaleString() : 'Never'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'erp' && (
            <div className="space-y-6">
              {/* ERP Status */}
              <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  {t('admin.erpStatus', 'ERP Integration Status')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="flex items-center mb-2">
                      <div className={`w-3 h-3 rounded-full mr-3 ${
                        erpStatus?.status === 'connected' ? 'bg-green-500' :
                        erpStatus?.status === 'error' ? 'bg-red-500' : 'bg-gray-500'
                      }`}></div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {t('admin.connectionStatus', 'Connection Status')}
                      </span>
                    </div>
                    <p className={`text-sm ${getStatusColor(erpStatus?.status || 'disconnected')}`}>
                      {erpStatus?.status || 'Disconnected'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                      {t('admin.lastSync')}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {erpStatus?.lastSync ? new Date(erpStatus.lastSync).toLocaleString() : 'Never'}
                    </p>
                  </div>
                </div>

                {erpStatus?.integrations && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                      {t('admin.integrations', 'Integrations')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {erpStatus.integrations.map(integration => (
                        <span
                          key={integration}
                          className="px-2 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-xs rounded"
                        >
                          {integration.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ERP Actions */}
              <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  {t('admin.erpActions', 'ERP Actions')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => handleERPSync('users')}
                    disabled={syncLoading}
                    className="flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400"
                  >
                    {syncLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                    ) : (
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                    {t('admin.syncUsers', 'Sync Users')}
                  </button>

                  <button
                    onClick={() => handleERPSync('data')}
                    disabled={syncLoading}
                    className="flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-green-400"
                  >
                    {syncLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                    ) : (
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                    {t('admin.syncData', 'Sync Data')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  {t('admin.userManagement')}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('admin.userManagementDesc')}
                </p>
                <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                  {t('admin.manageUsers')}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'system' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  {t('admin.systemSettings')}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('admin.systemSettingsDesc')}
                </p>
                <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                  {t('admin.systemSettingsBtn')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminConsole;
