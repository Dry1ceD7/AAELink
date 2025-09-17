/**
 * The Maestro AI Agent Orchestrator Integration
 * Integrates The Maestro framework with BMAD Method for advanced AI agent orchestration
 */

import { BMADMethod } from '../bmad-method'

export interface MaestroConfig {
  baseUrl: string
  apiKey?: string
  providers: {
    anthropic?: {
      apiKey: string
      clientId?: string
      redirectUri?: string
    }
    openai?: {
      apiKey: string
      orgId?: string
      clientId?: string
      redirectUri?: string
    }
    gemini?: {
      apiKey: string
      clientId?: string
      clientSecret?: string
      redirectUri?: string
    }
  }
}

export interface MaestroSession {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'gemini'
  authId: string
  createdAt: string
  updatedAt: string
}

export interface MaestroMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  metadata?: Record<string, any>
}

export interface MaestroAgent {
  id: string
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  provider: 'anthropic' | 'openai' | 'gemini'
  isActive: boolean
}

export class MaestroIntegration {
  private config: MaestroConfig
  private bmadMethod: BMADMethod

  constructor(config: MaestroConfig, bmadMethod: BMADMethod) {
    this.config = config
    this.bmadMethod = bmadMethod
  }

  /**
   * Initialize The Maestro integration
   */
  async initialize(): Promise<void> {
    try {
      console.log('🎭 Initializing The Maestro AI Agent Orchestrator...')

      // Test connection to The Maestro
      const healthCheck = await this.healthCheck()
      if (!healthCheck) {
        throw new Error('Failed to connect to The Maestro')
      }

      console.log('✅ The Maestro integration initialized successfully')
    } catch (error) {
      console.error('❌ Failed to initialize The Maestro integration:', error)
      throw error
    }
  }

  /**
   * Health check for The Maestro service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        }
      })
      return response.ok
    } catch (error) {
      console.error('The Maestro health check failed:', error)
      return false
    }
  }

  /**
   * Create a new AI agent session
   */
  async createSession(name: string, provider: 'anthropic' | 'openai' | 'gemini'): Promise<MaestroSession> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        },
        body: JSON.stringify({
          name,
          provider,
          authType: 'api_key'
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Failed to create Maestro session:', error)
      throw error
    }
  }

  /**
   * Send a message to an AI agent session
   */
  async sendMessage(sessionId: string, message: string, role: 'user' | 'assistant' | 'system' = 'user'): Promise<MaestroMessage> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        },
        body: JSON.stringify({
          content: message,
          role
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Failed to send message to Maestro session:', error)
      throw error
    }
  }

  /**
   * Get session history
   */
  async getSessionHistory(sessionId: string): Promise<MaestroMessage[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to get session history: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Failed to get Maestro session history:', error)
      throw error
    }
  }

  /**
   * Create a specialized AI agent for PRD updates
   */
  async createPRDAgent(): Promise<MaestroAgent> {
    const agentConfig = {
      name: 'AAELink PRD Update Agent',
      description: 'Specialized AI agent for updating and enhancing AAELink PRD+Prompts documents',
      systemPrompt: `You are a specialized AI agent for updating Product Requirements Documents (PRDs) and Prompts for the AAELink enterprise workspace application.

Your responsibilities include:
1. Analyzing existing PRD documents for completeness and accuracy
2. Identifying gaps in requirements and specifications
3. Updating technical architecture details
4. Enhancing feature descriptions and implementation status
5. Improving documentation structure and clarity
6. Ensuring consistency with current implementation status
7. Adding missing technical details and specifications
8. Updating project status and milestones

You should focus on:
- Technical accuracy and completeness
- Clear, professional documentation
- Consistent formatting and structure
- Up-to-date implementation status
- Comprehensive feature coverage
- Security and compliance requirements
- Performance and scalability considerations

Always maintain the professional tone and technical depth expected in enterprise documentation.`,
      tools: ['file_reader', 'file_writer', 'code_analyzer', 'document_parser'],
      provider: 'anthropic' as const,
      isActive: true
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        },
        body: JSON.stringify(agentConfig)
      })

      if (!response.ok) {
        throw new Error(`Failed to create PRD agent: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Failed to create PRD agent:', error)
      throw error
    }
  }

  /**
   * Update AAELink PRD+Prompts document using AI agent
   */
  async updatePRDDocument(prdPath: string): Promise<string> {
    try {
      console.log('🤖 Starting PRD update process with The Maestro...')

      // Create PRD agent
      const prdAgent = await this.createPRDAgent()
      console.log(`✅ Created PRD agent: ${prdAgent.name}`)

      // Create session for PRD update
      const session = await this.createSession('AAELink PRD Update Session', 'anthropic')
      console.log(`✅ Created session: ${session.name}`)

      // Read current PRD content
      const prdContent = await this.bmadMethod.fileSystem.readFile(prdPath)

      // Send PRD update request to agent
      const updatePrompt = `Please analyze and update the following AAELink PRD+Prompts document.

Current document content:
${prdContent}

Please provide an enhanced and updated version that includes:
1. Updated implementation status for all features
2. Enhanced technical architecture details
3. Improved feature descriptions and specifications
4. Updated security and compliance requirements
5. Enhanced performance and scalability considerations
6. Updated deployment and infrastructure details
7. Improved documentation structure and clarity
8. Added missing technical details and specifications

Please maintain the professional tone and technical depth while ensuring the document is comprehensive and up-to-date.`

      const response = await this.sendMessage(session.id, updatePrompt)
      console.log('✅ PRD update request sent to AI agent')

      // Get the updated content
      const updatedContent = response.content

      // Write updated PRD back to file
      await this.bmadMethod.fileSystem.writeFile(prdPath, updatedContent)
      console.log('✅ Updated PRD document saved')

      return updatedContent
    } catch (error) {
      console.error('❌ Failed to update PRD document:', error)
      throw error
    }
  }

  /**
   * Get available AI agents
   */
  async getAgents(): Promise<MaestroAgent[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/agents`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to get agents: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Failed to get Maestro agents:', error)
      throw error
    }
  }

  /**
   * Get active sessions
   */
  async getSessions(): Promise<MaestroSession[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/sessions`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to get sessions: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Failed to get Maestro sessions:', error)
      throw error
    }
  }
}

export default MaestroIntegration
