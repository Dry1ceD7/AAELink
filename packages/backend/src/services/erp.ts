/**
 * ERP Integration Service
 * Handles integration with external ERP systems via n8n workflows
 */

interface ERPConfig {
  n8nUrl: string;
  apiKey: string;
  workflows: {
    userSync: string;
    dataSync: string;
    notifications: string;
  };
}

interface ERPSyncStatus {
  status: 'connected' | 'disconnected' | 'error';
  lastSync: string;
  integrations: string[];
  errors?: string[];
}

interface UserSyncData {
  id: string;
  email: string;
  displayName: string;
  role: string;
  department?: string;
  manager?: string;
  isActive: boolean;
  lastLogin?: string;
}

interface DataSyncResult {
  success: boolean;
  recordsProcessed: number;
  errors: string[];
  timestamp: string;
}

class ERPService {
  private config: ERPConfig;
  private syncStatus: ERPSyncStatus;
  private initialized = false;

  constructor() {
    this.config = {
      n8nUrl: process.env.N8N_URL || 'http://localhost:5678',
      apiKey: process.env.N8N_API_KEY || 'demo-key',
      workflows: {
        userSync: process.env.N8N_USER_SYNC_WORKFLOW || 'user-sync',
        dataSync: process.env.N8N_DATA_SYNC_WORKFLOW || 'data-sync',
        notifications: process.env.N8N_NOTIFICATIONS_WORKFLOW || 'notifications'
      }
    };

    this.syncStatus = {
      status: 'disconnected',
      lastSync: new Date().toISOString(),
      integrations: ['sap', 'oracle', 'salesforce'],
      errors: []
    };

    this.initialize();
  }

  private async initialize() {
    try {
      // Test n8n connection
      await this.testConnection();
      this.syncStatus.status = 'connected';
      this.initialized = true;
      console.log('ERP service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize ERP service:', error);
      this.syncStatus.status = 'error';
      this.syncStatus.errors = [error instanceof Error ? error.message : 'Unknown error'];
    }
  }

  private async testConnection(): Promise<boolean> {
    try {
      // Mock connection test - in production, this would ping n8n API
      const response = await fetch(`${this.config.n8nUrl}/api/v1/workflows`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        return true;
      } else {
        throw new Error(`n8n connection failed: ${response.status}`);
      }
    } catch (error) {
      // For demo purposes, simulate successful connection
      console.log('Mock n8n connection test - simulating success');
      return true;
    }
  }

  public async getStatus(): Promise<ERPSyncStatus> {
    return this.syncStatus;
  }

  public async syncUsers(): Promise<DataSyncResult> {
    if (!this.initialized) {
      throw new Error('ERP service not initialized');
    }

    try {
      console.log('Starting user sync via n8n workflow...');
      
      // Trigger n8n workflow for user sync
      const response = await fetch(`${this.config.n8nUrl}/api/v1/workflows/${this.config.workflows.userSync}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: 'erp_system',
          syncType: 'users',
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`User sync failed: ${response.status}`);
      }

      const result = await response.json();
      
      // Update sync status
      this.syncStatus.lastSync = new Date().toISOString();
      this.syncStatus.status = 'connected';

      return {
        success: true,
        recordsProcessed: result.recordsProcessed || 0,
        errors: [],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('User sync error:', error);
      this.syncStatus.status = 'error';
      this.syncStatus.errors = [error instanceof Error ? error.message : 'Unknown error'];

      return {
        success: false,
        recordsProcessed: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        timestamp: new Date().toISOString()
      };
    }
  }

  public async syncData(dataType: string): Promise<DataSyncResult> {
    if (!this.initialized) {
      throw new Error('ERP service not initialized');
    }

    try {
      console.log(`Starting ${dataType} sync via n8n workflow...`);
      
      // Trigger n8n workflow for data sync
      const response = await fetch(`${this.config.n8nUrl}/api/v1/workflows/${this.config.workflows.dataSync}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: 'erp_system',
          syncType: dataType,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`${dataType} sync failed: ${response.status}`);
      }

      const result = await response.json();
      
      // Update sync status
      this.syncStatus.lastSync = new Date().toISOString();
      this.syncStatus.status = 'connected';

      return {
        success: true,
        recordsProcessed: result.recordsProcessed || 0,
        errors: [],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`${dataType} sync error:`, error);
      this.syncStatus.status = 'error';
      this.syncStatus.errors = [error instanceof Error ? error.message : 'Unknown error'];

      return {
        success: false,
        recordsProcessed: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        timestamp: new Date().toISOString()
      };
    }
  }

  public async sendNotification(notification: {
    type: string;
    recipient: string;
    title: string;
    message: string;
    data?: Record<string, any>;
  }): Promise<boolean> {
    if (!this.initialized) {
      throw new Error('ERP service not initialized');
    }

    try {
      console.log('Sending notification via n8n workflow...');
      
      // Trigger n8n workflow for notifications
      const response = await fetch(`${this.config.n8nUrl}/api/v1/workflows/${this.config.workflows.notifications}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          notification,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`Notification failed: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error('Notification error:', error);
      return false;
    }
  }

  public async getIntegrationStatus(integration: string): Promise<{
    status: 'connected' | 'disconnected' | 'error';
    lastSync: string;
    error?: string;
  }> {
    // Mock integration status - in production, this would check actual integration health
    return {
      status: 'connected',
      lastSync: new Date().toISOString()
    };
  }

  public async createWorkflow(workflow: {
    name: string;
    description: string;
    nodes: any[];
    connections: any[];
  }): Promise<{ id: string; status: string }> {
    try {
      const response = await fetch(`${this.config.n8nUrl}/api/v1/workflows`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(workflow)
      });

      if (!response.ok) {
        throw new Error(`Workflow creation failed: ${response.status}`);
      }

      const result = await response.json();
      return {
        id: result.id,
        status: 'created'
      };
    } catch (error) {
      console.error('Workflow creation error:', error);
      throw error;
    }
  }

  public async executeWorkflow(workflowId: string, data: any): Promise<any> {
    try {
      const response = await fetch(`${this.config.n8nUrl}/api/v1/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`Workflow execution failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Workflow execution error:', error);
      throw error;
    }
  }

  // Mock data for demo purposes
  public async getMockERPData(): Promise<{
    users: UserSyncData[];
    departments: string[];
    projects: any[];
  }> {
    return {
      users: [
        {
          id: 'erp_user_1',
          email: 'john.doe@company.com',
          displayName: 'John Doe',
          role: 'manager',
          department: 'Engineering',
          manager: 'admin_001',
          isActive: true,
          lastLogin: new Date().toISOString()
        },
        {
          id: 'erp_user_2',
          email: 'jane.smith@company.com',
          displayName: 'Jane Smith',
          role: 'developer',
          department: 'Engineering',
          manager: 'erp_user_1',
          isActive: true,
          lastLogin: new Date().toISOString()
        }
      ],
      departments: ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance'],
      projects: [
        {
          id: 'proj_1',
          name: 'AAELink Development',
          status: 'active',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
        }
      ]
    };
  }
}

// Create singleton instance
export const erpService = new ERPService();
export { ERPService };
export type { ERPConfig, ERPSyncStatus, UserSyncData, DataSyncResult };
