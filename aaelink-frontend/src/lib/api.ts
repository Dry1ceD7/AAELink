const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  error?: string
}

export interface User {
  id: string
  username: string
  email: string
  role: string
}

export interface Message {
  id: string
  channelId: string
  userId: string
  content: string
  timestamp: string
  reactions: Array<{
    emoji: string
    count: number
    users: string[]
  }>
  isOwn: boolean
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  success: boolean
  token?: string
  user?: User
  message?: string
}

class ApiClient {
  private baseURL: string
  private token: string | null = null

  constructor(baseURL: string) {
    this.baseURL = baseURL
    this.token = localStorage.getItem('auth_token')
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.message || 'An error occurred',
        }
      }

      return {
        success: true,
        data,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  setToken(token: string) {
    this.token = token
    localStorage.setItem('auth_token', token)
  }

  clearToken() {
    this.token = null
    localStorage.removeItem('auth_token')
  }

  // Auth endpoints
  async login(credentials: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    const response = await this.request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    })

    if (response.success && response.data?.token) {
      this.setToken(response.data.token)
    }

    return response
  }

  async getCurrentUser(): Promise<ApiResponse<User>> {
    return this.request<User>('/api/users/me')
  }

  // Message endpoints
  async getMessages(channelId: string): Promise<ApiResponse<{ messages: Message[] }>> {
    return this.request<{ messages: Message[] }>(`/api/messages/${channelId}`)
  }

  async sendMessage(channelId: string, content: string): Promise<ApiResponse<Message>> {
    return this.request<Message>(`/api/messages/${channelId}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  }

  // File endpoints
  async uploadFile(file: File): Promise<ApiResponse<{ fileId: string; url: string }>> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${this.baseURL}/api/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      body: formData,
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message || 'Upload failed',
      }
    }

    return {
      success: true,
      data,
    }
  }

  // Health check
  async healthCheck(): Promise<ApiResponse<{ status: string; timestamp: string }>> {
    return this.request<{ status: string; timestamp: string }>('/health')
  }
}

export const apiClient = new ApiClient(API_BASE_URL)
