import React, { useState, useEffect } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const TestConnection: React.FC = () => {
  const { user } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<string>('Testing...');
  const [backendHealth, setBackendHealth] = useState<string>('Testing...');
  const [authStatus, setAuthStatus] = useState<string>('Testing...');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    testConnections();
  }, []);

  const testConnections = async () => {
    setIsLoading(true);
    
    try {
      // Test backend health
      try {
        const healthResponse = await api.get('/healthz');
        setBackendHealth(`✅ Backend Health: ${healthResponse.data.status}`);
      } catch (error) {
        setBackendHealth('❌ Backend Health: Connection failed');
      }

      // Test authentication
      try {
        const sessionResponse = await api.get('/auth/session');
        if (sessionResponse.data.user) {
          setAuthStatus(`✅ Authentication: Logged in as ${sessionResponse.data.user.email}`);
        } else {
          setAuthStatus('⚠️ Authentication: Not logged in');
        }
      } catch (error) {
        setAuthStatus('❌ Authentication: Session check failed');
      }

      setConnectionStatus('✅ All tests completed');
    } catch (error) {
      setConnectionStatus('❌ Connection test failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <Card className="p-6">
          <h1 className="text-2xl font-bold mb-6">AAELink Connection Test</h1>
          
          <div className="space-y-4">
            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <h3 className="font-semibold mb-2">Current User</h3>
              <p>{user ? `Logged in as: ${user.email}` : 'Not logged in'}</p>
            </div>

            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <h3 className="font-semibold mb-2">Backend Health</h3>
              <p>{backendHealth}</p>
            </div>

            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <h3 className="font-semibold mb-2">Authentication</h3>
              <p>{authStatus}</p>
            </div>

            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <h3 className="font-semibold mb-2">Overall Status</h3>
              <p>{connectionStatus}</p>
            </div>

            <div className="flex gap-4">
              <Button 
                onClick={testConnections} 
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? 'Testing...' : 'Test Again'}
              </Button>
              
              <Button 
                onClick={() => window.location.href = '/'}
                variant="secondary"
                className="flex-1"
              >
                Go Home
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default TestConnection;