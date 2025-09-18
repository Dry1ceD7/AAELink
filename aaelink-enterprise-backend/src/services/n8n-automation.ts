import axios from 'axios';

export interface N8NWorkflow {
  id: string;
  name: string;
  description: string;
  active: boolean;
  nodes: N8NNode[];
  connections: N8NConnection[];
  settings: N8NWorkflowSettings;
}

export interface N8NNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, any>;
}

export interface N8NConnection {
  node: string;
  type: string;
  index: number;
}

export interface N8NWorkflowSettings {
  executionOrder: 'v1' | 'v2';
  saveManualExecutions: boolean;
  callerPolicy: 'workflowsFromSameOwner' | 'workflowsFromAllUsers';
  errorWorkflow?: string;
}

export interface N8NExecution {
  id: string;
  finished: boolean;
  mode: 'manual' | 'trigger';
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  data: any;
  status: 'running' | 'success' | 'error' | 'waiting';
}

export class N8NAutomationService {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async makeRequest(method: string, endpoint: string, data?: any) {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}/api/v1${endpoint}`,
        headers: {
          'X-N8N-API-KEY': this.apiKey,
          'Content-Type': 'application/json'
        },
        data
      });
      return response.data;
    } catch (error) {
      console.error('N8N API Error:', error);
      throw error;
    }
  }

  // Workflow Management
  async getWorkflows(): Promise<N8NWorkflow[]> {
    return this.makeRequest('GET', '/workflows');
  }

  async getWorkflow(id: string): Promise<N8NWorkflow> {
    return this.makeRequest('GET', `/workflows/${id}`);
  }

  async createWorkflow(workflow: Omit<N8NWorkflow, 'id'>): Promise<N8NWorkflow> {
    return this.makeRequest('POST', '/workflows', workflow);
  }

  async updateWorkflow(id: string, workflow: Partial<N8NWorkflow>): Promise<N8NWorkflow> {
    return this.makeRequest('PUT', `/workflows/${id}`, workflow);
  }

  async deleteWorkflow(id: string): Promise<void> {
    return this.makeRequest('DELETE', `/workflows/${id}`);
  }

  async activateWorkflow(id: string): Promise<void> {
    return this.makeRequest('POST', `/workflows/${id}/activate`);
  }

  async deactivateWorkflow(id: string): Promise<void> {
    return this.makeRequest('POST', `/workflows/${id}/deactivate`);
  }

  // Execution Management
  async getExecutions(workflowId?: string, limit = 20): Promise<N8NExecution[]> {
    const params = new URLSearchParams();
    if (workflowId) params.append('workflowId', workflowId);
    params.append('limit', limit.toString());
    
    return this.makeRequest('GET', `/executions?${params.toString()}`);
  }

  async getExecution(id: string): Promise<N8NExecution> {
    return this.makeRequest('GET', `/executions/${id}`);
  }

  async executeWorkflow(workflowId: string, data?: any): Promise<N8NExecution> {
    return this.makeRequest('POST', `/workflows/${workflowId}/execute`, { data });
  }

  async stopExecution(executionId: string): Promise<void> {
    return this.makeRequest('POST', `/executions/${executionId}/stop`);
  }

  // Pre-built Workflows for AAELink
  async createUserProvisioningWorkflow(): Promise<N8NWorkflow> {
    const workflow: Omit<N8NWorkflow, 'id'> = {
      name: 'AAELink User Provisioning',
      description: 'Automatically provision users in AAELink when they are added to the system',
      active: true,
      nodes: [
        {
          id: 'webhook-trigger',
          name: 'User Created Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [100, 200],
          parameters: {
            httpMethod: 'POST',
            path: 'user-created',
            responseMode: 'responseNode'
          }
        },
        {
          id: 'validate-user',
          name: 'Validate User Data',
          type: 'n8n-nodes-base.function',
          typeVersion: 1,
          position: [300, 200],
          parameters: {
            functionCode: `
              const userData = $input.first().json;
              
              // Validate required fields
              if (!userData.email || !userData.name) {
                throw new Error('Missing required user data');
              }
              
              return {
                json: {
                  email: userData.email,
                  name: userData.name,
                  department: userData.department || 'General',
                  role: userData.role || 'user',
                  isActive: userData.isActive !== false
                }
              };
            `
          }
        },
        {
          id: 'create-user',
          name: 'Create AAELink User',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 1,
          position: [500, 200],
          parameters: {
            method: 'POST',
            url: 'http://localhost:3001/api/users',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer {{ $env.AAELINK_API_TOKEN }}'
            },
            body: '={{ $json }}'
          }
        },
        {
          id: 'send-welcome-email',
          name: 'Send Welcome Email',
          type: 'n8n-nodes-base.emailSend',
          typeVersion: 1,
          position: [700, 200],
          parameters: {
            fromEmail: 'noreply@aae.co.th',
            toEmail: '={{ $json.email }}',
            subject: 'Welcome to AAELink',
            message: 'Welcome to AAELink! Your account has been created successfully.'
          }
        },
        {
          id: 'webhook-response',
          name: 'Webhook Response',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1,
          position: [900, 200],
          parameters: {
            respondWith: 'json',
            responseBody: '={{ { success: true, message: "User created successfully" } }}'
          }
        }
      ],
      connections: [
        {
          node: 'webhook-trigger',
          type: 'main',
          index: 0
        },
        {
          node: 'validate-user',
          type: 'main',
          index: 0
        },
        {
          node: 'create-user',
          type: 'main',
          index: 0
        },
        {
          node: 'send-welcome-email',
          type: 'main',
          index: 0
        },
        {
          node: 'webhook-response',
          type: 'main',
          index: 0
        }
      ],
      settings: {
        executionOrder: 'v1',
        saveManualExecutions: true,
        callerPolicy: 'workflowsFromSameOwner'
      }
    };

    return this.createWorkflow(workflow);
  }

  async createERPSyncWorkflow(): Promise<N8NWorkflow> {
    const workflow: Omit<N8NWorkflow, 'id'> = {
      name: 'AAELink ERP Data Sync',
      description: 'Sync data from ERP4All to AAELink on a schedule',
      active: true,
      nodes: [
        {
          id: 'schedule-trigger',
          name: 'Schedule Trigger',
          type: 'n8n-nodes-base.cron',
          typeVersion: 1,
          position: [100, 200],
          parameters: {
            rule: {
              interval: [
                {
                  field: 'hours',
                  hoursInterval: 1
                }
              ]
            }
          }
        },
        {
          id: 'fetch-erp-data',
          name: 'Fetch ERP Data',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 1,
          position: [300, 200],
          parameters: {
            method: 'GET',
            url: 'http://localhost:3001/api/erp/inventory',
            headers: {
              'Authorization': 'Bearer {{ $env.ERP_API_TOKEN }}'
            }
          }
        },
        {
          id: 'process-data',
          name: 'Process ERP Data',
          type: 'n8n-nodes-base.function',
          typeVersion: 1,
          position: [500, 200],
          parameters: {
            functionCode: `
              const erpData = $input.first().json;
              
              // Transform ERP data to AAELink format
              const processedData = erpData.map(item => ({
                id: item.id,
                name: item.name,
                description: item.description,
                quantity: item.quantity,
                price: item.price,
                category: item.category,
                lastUpdated: new Date().toISOString()
              }));
              
              return processedData.map(item => ({ json: item }));
            `
          }
        },
        {
          id: 'update-aaelink',
          name: 'Update AAELink',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 1,
          position: [700, 200],
          parameters: {
            method: 'POST',
            url: 'http://localhost:3001/api/erp/sync-inventory',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer {{ $env.AAELINK_API_TOKEN }}'
            },
            body: '={{ $json }}'
          }
        }
      ],
      connections: [
        {
          node: 'schedule-trigger',
          type: 'main',
          index: 0
        },
        {
          node: 'fetch-erp-data',
          type: 'main',
          index: 0
        },
        {
          node: 'process-data',
          type: 'main',
          index: 0
        },
        {
          node: 'update-aaelink',
          type: 'main',
          index: 0
        }
      ],
      settings: {
        executionOrder: 'v1',
        saveManualExecutions: true,
        callerPolicy: 'workflowsFromSameOwner'
      }
    };

    return this.createWorkflow(workflow);
  }

  async createNotificationWorkflow(): Promise<N8NWorkflow> {
    const workflow: Omit<N8NWorkflow, 'id'> = {
      name: 'AAELink Notification System',
      description: 'Send notifications for important events in AAELink',
      active: true,
      nodes: [
        {
          id: 'webhook-trigger',
          name: 'Notification Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [100, 200],
          parameters: {
            httpMethod: 'POST',
            path: 'notification',
            responseMode: 'responseNode'
          }
        },
        {
          id: 'determine-type',
          name: 'Determine Notification Type',
          type: 'n8n-nodes-base.switch',
          typeVersion: 1,
          position: [300, 200],
          parameters: {
            rules: {
              rules: [
                {
                  operation: 'equal',
                  value1: '={{ $json.type }}',
                  value2: 'email'
                },
                {
                  operation: 'equal',
                  value1: '={{ $json.type }}',
                  value2: 'push'
                },
                {
                  operation: 'equal',
                  value1: '={{ $json.type }}',
                  value2: 'sms'
                }
              ]
            }
          }
        },
        {
          id: 'send-email',
          name: 'Send Email',
          type: 'n8n-nodes-base.emailSend',
          typeVersion: 1,
          position: [500, 100],
          parameters: {
            fromEmail: 'noreply@aae.co.th',
            toEmail: '={{ $json.recipient }}',
            subject: '={{ $json.subject }}',
            message: '={{ $json.message }}'
          }
        },
        {
          id: 'send-push',
          name: 'Send Push Notification',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 1,
          position: [500, 200],
          parameters: {
            method: 'POST',
            url: 'http://localhost:3001/api/notifications/push',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer {{ $env.AAELINK_API_TOKEN }}'
            },
            body: '={{ $json }}'
          }
        },
        {
          id: 'send-sms',
          name: 'Send SMS',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 1,
          position: [500, 300],
          parameters: {
            method: 'POST',
            url: 'https://api.twilio.com/2010-04-01/Accounts/{{ $env.TWILIO_ACCOUNT_SID }}/Messages.json',
            headers: {
              'Authorization': 'Basic {{ $env.TWILIO_AUTH_TOKEN }}',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'To={{ $json.recipient }}&From={{ $env.TWILIO_PHONE_NUMBER }}&Body={{ $json.message }}'
          }
        },
        {
          id: 'webhook-response',
          name: 'Webhook Response',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1,
          position: [700, 200],
          parameters: {
            respondWith: 'json',
            responseBody: '={{ { success: true, message: "Notification sent" } }}'
          }
        }
      ],
      connections: [
        {
          node: 'webhook-trigger',
          type: 'main',
          index: 0
        },
        {
          node: 'determine-type',
          type: 'main',
          index: 0
        },
        {
          node: 'send-email',
          type: 'main',
          index: 0
        },
        {
          node: 'send-push',
          type: 'main',
          index: 0
        },
        {
          node: 'send-sms',
          type: 'main',
          index: 0
        },
        {
          node: 'webhook-response',
          type: 'main',
          index: 0
        }
      ],
      settings: {
        executionOrder: 'v1',
        saveManualExecutions: true,
        callerPolicy: 'workflowsFromSameOwner'
      }
    };

    return this.createWorkflow(workflow);
  }

  // Utility methods
  async testConnection(): Promise<boolean> {
    try {
      await this.makeRequest('GET', '/workflows?limit=1');
      return true;
    } catch (error) {
      return false;
    }
  }

  async getWorkflowStats(): Promise<{ total: number; active: number; executions: number }> {
    const workflows = await this.getWorkflows();
    const executions = await this.getExecutions();
    
    return {
      total: workflows.length,
      active: workflows.filter(w => w.active).length,
      executions: executions.length
    };
  }
}

// Default configuration
export const defaultN8NConfig = {
  baseUrl: process.env.N8N_BASE_URL || 'http://localhost:5678',
  apiKey: process.env.N8N_API_KEY || 'your-api-key-here'
};

// Singleton instance
export const n8nService = new N8NAutomationService(
  defaultN8NConfig.baseUrl,
  defaultN8NConfig.apiKey
);
