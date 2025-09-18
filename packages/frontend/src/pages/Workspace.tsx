import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';

const WorkspacePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Logo variant="text" size="md" />
            </div>
            <div className="flex items-center space-x-4">
              {user ? (
                <>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Welcome, {user.email}
                  </span>
                  <Button 
                    onClick={handleLogout}
                    variant="danger"
                    size="sm"
                  >
                    Logout
                  </Button>
                </>
              ) : (
                <Button 
                  onClick={() => navigate('/login')}
                  variant="primary"
                  size="sm"
                >
                  Login
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="text-center">
            <Logo size="xl" className="mx-auto mb-8" />
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
              AAELink Workspace
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
              Enterprise workspace platform with real-time collaboration
            </p>
            
            {/* Feature cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <div className="text-3xl mb-4">💬</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Real-time Messaging
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Discord-style channels with WebSocket-powered real-time communication
                </p>
              </div>
              
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <div className="text-3xl mb-4">📁</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  File Sharing
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Secure file storage with MinIO and drag-drop uploads
                </p>
              </div>
              
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <div className="text-3xl mb-4">🔐</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Secure Authentication
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  JWT-based authentication with secure session management
                </p>
              </div>
            </div>

            {/* Quick actions */}
            <div className="mt-12 flex justify-center space-x-4">
              <Button 
                onClick={() => navigate('/test')}
                variant="secondary"
                size="lg"
              >
                Test Connection
              </Button>
              {!user && (
                <Button 
                  onClick={() => navigate('/login')}
                  variant="primary"
                  size="lg"
                >
                  Get Started
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default WorkspacePage;
