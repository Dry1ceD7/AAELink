/**
 * ERP4All Integration Service
 * Comprehensive ERP system integration for AAELink Enterprise
 * Version: 1.2.0
 */

import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

// ERP4All API Configuration
interface ERP4AllConfig {
  baseUrl: string;
  apiKey: string;
  username: string;
  password: string;
  timeout: number;
  retryAttempts: number;
}

// ERP4All Data Schemas
const EmployeeSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  department: z.string(),
  position: z.string(),
  managerId: z.string().optional(),
  hireDate: z.string(),
  status: z.enum(['active', 'inactive', 'terminated']),
  salary: z.number().optional(),
  phone: z.string().optional(),
  address: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string(),
  }).optional(),
});

const ProjectSchema = z.object({
  id: z.string(),
  projectCode: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['planning', 'active', 'on-hold', 'completed', 'cancelled']),
  startDate: z.string(),
  endDate: z.string().optional(),
  budget: z.number().optional(),
  managerId: z.string(),
  teamMembers: z.array(z.string()),
  clientId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});

const TimesheetSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  projectId: z.string(),
  date: z.string(),
  hours: z.number(),
  description: z.string().optional(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
});

const InvoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  clientId: z.string(),
  projectId: z.string(),
  amount: z.number(),
  currency: z.string(),
  issueDate: z.string(),
  dueDate: z.string(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    total: z.number(),
  })),
});

const ClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string(),
  }),
  contactPerson: z.string().optional(),
  industry: z.string().optional(),
  status: z.enum(['active', 'inactive', 'prospect']),
});

// Type definitions
export type Employee = z.infer<typeof EmployeeSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Timesheet = z.infer<typeof TimesheetSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type Client = z.infer<typeof ClientSchema>;

export interface ERP4AllResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  errors?: string[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export class ERP4AllService {
  private client: AxiosInstance;
  private config: ERP4AllConfig;
  private authToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: ERP4AllConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor to add auth token
    this.client.interceptors.request.use(async (config) => {
      if (!this.authToken || this.isTokenExpired()) {
        await this.authenticate();
      }

      if (this.authToken) {
        config.headers.Authorization = `Bearer ${this.authToken}`;
      }

      return config;
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // Token expired, try to re-authenticate
          await this.authenticate();
          return this.client.request(error.config);
        }

        return Promise.reject(error);
      }
    );
  }

  private async authenticate(): Promise<void> {
    try {
      const response = await axios.post(`${this.config.baseUrl}/auth/login`, {
        username: this.config.username,
        password: this.config.password,
        apiKey: this.config.apiKey,
      });

      this.authToken = response.data.token;
      this.tokenExpiry = new Date(Date.now() + (response.data.expiresIn * 1000));
    } catch (error) {
      console.error('ERP4All authentication failed:', error);
      throw new Error('Failed to authenticate with ERP4All');
    }
  }

  private isTokenExpired(): boolean {
    if (!this.tokenExpiry) return true;
    return new Date() >= this.tokenExpiry;
  }

  // Employee Management
  async getEmployees(params?: {
    page?: number;
    limit?: number;
    department?: string;
    status?: string;
    search?: string;
  }): Promise<ERP4AllResponse<PaginatedResponse<Employee>>> {
    try {
      const response = await this.client.get('/employees', { params });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getEmployee(id: string): Promise<ERP4AllResponse<Employee>> {
    try {
      const response = await this.client.get(`/employees/${id}`);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createEmployee(employee: Omit<Employee, 'id'>): Promise<ERP4AllResponse<Employee>> {
    try {
      const validatedData = EmployeeSchema.omit({ id: true }).parse(employee);
      const response = await this.client.post('/employees', validatedData);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateEmployee(id: string, employee: Partial<Employee>): Promise<ERP4AllResponse<Employee>> {
    try {
      const response = await this.client.put(`/employees/${id}`, employee);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deleteEmployee(id: string): Promise<ERP4AllResponse<boolean>> {
    try {
      await this.client.delete(`/employees/${id}`);
      return {
        success: true,
        data: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // Project Management
  async getProjects(params?: {
    page?: number;
    limit?: number;
    status?: string;
    managerId?: string;
    search?: string;
  }): Promise<ERP4AllResponse<PaginatedResponse<Project>>> {
    try {
      const response = await this.client.get('/projects', { params });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getProject(id: string): Promise<ERP4AllResponse<Project>> {
    try {
      const response = await this.client.get(`/projects/${id}`);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createProject(project: Omit<Project, 'id'>): Promise<ERP4AllResponse<Project>> {
    try {
      const validatedData = ProjectSchema.omit({ id: true }).parse(project);
      const response = await this.client.post('/projects', validatedData);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateProject(id: string, project: Partial<Project>): Promise<ERP4AllResponse<Project>> {
    try {
      const response = await this.client.put(`/projects/${id}`, project);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // Timesheet Management
  async getTimesheets(params?: {
    page?: number;
    limit?: number;
    employeeId?: string;
    projectId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }): Promise<ERP4AllResponse<PaginatedResponse<Timesheet>>> {
    try {
      const response = await this.client.get('/timesheets', { params });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getTimesheet(id: string): Promise<ERP4AllResponse<Timesheet>> {
    try {
      const response = await this.client.get(`/timesheets/${id}`);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createTimesheet(timesheet: Omit<Timesheet, 'id'>): Promise<ERP4AllResponse<Timesheet>> {
    try {
      const validatedData = TimesheetSchema.omit({ id: true }).parse(timesheet);
      const response = await this.client.post('/timesheets', validatedData);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateTimesheet(id: string, timesheet: Partial<Timesheet>): Promise<ERP4AllResponse<Timesheet>> {
    try {
      const response = await this.client.put(`/timesheets/${id}`, timesheet);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async approveTimesheet(id: string, approvedBy: string): Promise<ERP4AllResponse<Timesheet>> {
    try {
      const response = await this.client.post(`/timesheets/${id}/approve`, {
        approvedBy,
        approvedAt: new Date().toISOString(),
      });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // Invoice Management
  async getInvoices(params?: {
    page?: number;
    limit?: number;
    clientId?: string;
    projectId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<ERP4AllResponse<PaginatedResponse<Invoice>>> {
    try {
      const response = await this.client.get('/invoices', { params });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getInvoice(id: string): Promise<ERP4AllResponse<Invoice>> {
    try {
      const response = await this.client.get(`/invoices/${id}`);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createInvoice(invoice: Omit<Invoice, 'id'>): Promise<ERP4AllResponse<Invoice>> {
    try {
      const validatedData = InvoiceSchema.omit({ id: true }).parse(invoice);
      const response = await this.client.post('/invoices', validatedData);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateInvoice(id: string, invoice: Partial<Invoice>): Promise<ERP4AllResponse<Invoice>> {
    try {
      const response = await this.client.put(`/invoices/${id}`, invoice);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async sendInvoice(id: string): Promise<ERP4AllResponse<boolean>> {
    try {
      await this.client.post(`/invoices/${id}/send`);
      return {
        success: true,
        data: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // Client Management
  async getClients(params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<ERP4AllResponse<PaginatedResponse<Client>>> {
    try {
      const response = await this.client.get('/clients', { params });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getClient(id: string): Promise<ERP4AllResponse<Client>> {
    try {
      const response = await this.client.get(`/clients/${id}`);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createClient(client: Omit<Client, 'id'>): Promise<ERP4AllResponse<Client>> {
    try {
      const validatedData = ClientSchema.omit({ id: true }).parse(client);
      const response = await this.client.post('/clients', validatedData);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateClient(id: string, client: Partial<Client>): Promise<ERP4AllResponse<Client>> {
    try {
      const response = await this.client.put(`/clients/${id}`, client);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // Reporting and Analytics
  async getEmployeeReport(employeeId: string, startDate: string, endDate: string): Promise<ERP4AllResponse<any>> {
    try {
      const response = await this.client.get(`/reports/employee/${employeeId}`, {
        params: { startDate, endDate },
      });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getProjectReport(projectId: string): Promise<ERP4AllResponse<any>> {
    try {
      const response = await this.client.get(`/reports/project/${projectId}`);
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getFinancialReport(startDate: string, endDate: string): Promise<ERP4AllResponse<any>> {
    try {
      const response = await this.client.get('/reports/financial', {
        params: { startDate, endDate },
      });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // Data Synchronization
  async syncEmployees(): Promise<ERP4AllResponse<{ synced: number; errors: number }>> {
    try {
      const response = await this.client.post('/sync/employees');
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async syncProjects(): Promise<ERP4AllResponse<{ synced: number; errors: number }>> {
    try {
      const response = await this.client.post('/sync/projects');
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async syncTimesheets(): Promise<ERP4AllResponse<{ synced: number; errors: number }>> {
    try {
      const response = await this.client.post('/sync/timesheets');
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // Health Check
  async healthCheck(): Promise<ERP4AllResponse<{ status: string; version: string; uptime: number }>> {
    try {
      const response = await this.client.get('/health');
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  private handleError(error: any): ERP4AllResponse<any> {
    console.error('ERP4All API Error:', error);

    return {
      success: false,
      data: null,
      message: error.response?.data?.message || error.message || 'Unknown error occurred',
      errors: error.response?.data?.errors || [error.message],
    };
  }
}

// Export singleton instance
export const erp4AllService = new ERP4AllService({
  baseUrl: process.env.ERP4ALL_BASE_URL || 'https://api.erp4all.com/v1',
  apiKey: process.env.ERP4ALL_API_KEY || '',
  username: process.env.ERP4ALL_USERNAME || '',
  password: process.env.ERP4ALL_PASSWORD || '',
  timeout: 30000,
  retryAttempts: 3,
});

export default erp4AllService;
