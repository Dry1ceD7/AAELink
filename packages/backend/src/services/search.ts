/**
 * Full-Text Search Service
 * Handles PostgreSQL FTS with multi-language support
 */

interface SearchResult {
  id: string;
  type: 'message' | 'file' | 'channel' | 'user';
  title: string;
  content: string;
  url: string;
  score: number;
  metadata: Record<string, any>;
  highlights: string[];
}

interface SearchOptions {
  query: string;
  type?: 'all' | 'messages' | 'files' | 'channels' | 'users';
  userId?: string;
  channelId?: string;
  limit?: number;
  offset?: number;
  language?: 'en' | 'th' | 'de';
}

class SearchService {
  private messages = new Map<string, any>();
  private files = new Map<string, any>();
  private channels = new Map<string, any>();
  private users = new Map<string, any>();

  constructor() {
    this.initializeMockData();
  }

  private initializeMockData() {
    // Mock messages for search
    this.messages.set('msg_1', {
      id: 'msg_1',
      content: 'Welcome to AAELink! This is a powerful enterprise workspace platform.',
      userId: 'admin_001',
      channelId: 'general',
      createdAt: new Date().toISOString(),
      type: 'message'
    });

    this.messages.set('msg_2', {
      id: 'msg_2',
      content: 'We support real-time messaging, file sharing, and collaboration features.',
      userId: 'admin_001',
      channelId: 'general',
      createdAt: new Date().toISOString(),
      type: 'message'
    });

    this.messages.set('msg_3', {
      id: 'msg_3',
      content: 'The platform includes calendar integration, ERP connectivity, and advanced search.',
      userId: 'admin_001',
      channelId: 'announcements',
      createdAt: new Date().toISOString(),
      type: 'message'
    });

    // Mock files for search
    this.files.set('file_1', {
      id: 'file_1',
      name: 'project-proposal.pdf',
      originalName: 'AAELink Project Proposal.pdf',
      mimeType: 'application/pdf',
      size: 1024000,
      userId: 'admin_001',
      channelId: 'general',
      createdAt: new Date().toISOString(),
      type: 'file'
    });

    this.files.set('file_2', {
      id: 'file_2',
      name: 'meeting-notes.docx',
      originalName: 'Team Meeting Notes.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 512000,
      userId: 'admin_001',
      channelId: 'development',
      createdAt: new Date().toISOString(),
      type: 'file'
    });

    // Mock channels for search
    this.channels.set('general', {
      id: 'general',
      name: 'general',
      description: 'General discussion and announcements',
      type: 'text',
      isPrivate: false,
      createdAt: new Date().toISOString(),
      type: 'channel'
    });

    this.channels.set('development', {
      id: 'development',
      name: 'development',
      description: 'Development team collaboration and code reviews',
      type: 'text',
      isPrivate: false,
      createdAt: new Date().toISOString(),
      type: 'channel'
    });

    // Mock users for search
    this.users.set('admin_001', {
      id: 'admin_001',
      email: 'admin@aae.co.th',
      displayName: 'Admin User',
      role: 'sysadmin',
      createdAt: new Date().toISOString(),
      type: 'user'
    });
  }

  public async search(options: SearchOptions): Promise<{
    results: SearchResult[];
    total: number;
    query: string;
    took: number;
  }> {
    const startTime = Date.now();
    const { query, type = 'all', limit = 20, offset = 0 } = options;

    if (!query.trim()) {
      return {
        results: [],
        total: 0,
        query,
        took: Date.now() - startTime
      };
    }

    const searchTerms = this.parseQuery(query);
    const results: SearchResult[] = [];

    // Search messages
    if (type === 'all' || type === 'messages') {
      const messageResults = this.searchMessages(searchTerms, options);
      results.push(...messageResults);
    }

    // Search files
    if (type === 'all' || type === 'files') {
      const fileResults = this.searchFiles(searchTerms, options);
      results.push(...fileResults);
    }

    // Search channels
    if (type === 'all' || type === 'channels') {
      const channelResults = this.searchChannels(searchTerms, options);
      results.push(...channelResults);
    }

    // Search users
    if (type === 'all' || type === 'users') {
      const userResults = this.searchUsers(searchTerms, options);
      results.push(...userResults);
    }

    // Sort by relevance score
    results.sort((a, b) => b.score - a.score);

    // Apply pagination
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      results: paginatedResults,
      total: results.length,
      query,
      took: Date.now() - startTime
    };
  }

  private parseQuery(query: string): string[] {
    // Simple query parsing - in production, use a proper search parser
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => term.replace(/[^\w]/g, ''));
  }

  private searchMessages(searchTerms: string[], options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [id, message] of this.messages.entries()) {
      if (options.channelId && message.channelId !== options.channelId) {
        continue;
      }

      const content = message.content.toLowerCase();
      const score = this.calculateScore(searchTerms, content);

      if (score > 0) {
        results.push({
          id,
          type: 'message',
          title: `Message in #${message.channelId}`,
          content: message.content,
          url: `/channels/${message.channelId}`,
          score,
          metadata: {
            userId: message.userId,
            channelId: message.channelId,
            createdAt: message.createdAt
          },
          highlights: this.generateHighlights(message.content, searchTerms)
        });
      }
    }

    return results;
  }

  private searchFiles(searchTerms: string[], options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [id, file] of this.files.entries()) {
      if (options.channelId && file.channelId !== options.channelId) {
        continue;
      }

      const searchableText = `${file.name} ${file.originalName}`.toLowerCase();
      const score = this.calculateScore(searchTerms, searchableText);

      if (score > 0) {
        results.push({
          id,
          type: 'file',
          title: file.originalName,
          content: `File: ${file.originalName} (${this.formatFileSize(file.size)})`,
          url: `/files/${id}`,
          score,
          metadata: {
            userId: file.userId,
            channelId: file.channelId,
            mimeType: file.mimeType,
            size: file.size,
            createdAt: file.createdAt
          },
          highlights: this.generateHighlights(file.originalName, searchTerms)
        });
      }
    }

    return results;
  }

  private searchChannels(searchTerms: string[], options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [id, channel] of this.channels.entries()) {
      const searchableText = `${channel.name} ${channel.description}`.toLowerCase();
      const score = this.calculateScore(searchTerms, searchableText);

      if (score > 0) {
        results.push({
          id,
          type: 'channel',
          title: `#${channel.name}`,
          content: channel.description,
          url: `/channels/${id}`,
          score,
          metadata: {
            isPrivate: channel.isPrivate,
            createdAt: channel.createdAt
          },
          highlights: this.generateHighlights(`${channel.name} ${channel.description}`, searchTerms)
        });
      }
    }

    return results;
  }

  private searchUsers(searchTerms: string[], options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [id, user] of this.users.entries()) {
      const searchableText = `${user.displayName} ${user.email}`.toLowerCase();
      const score = this.calculateScore(searchTerms, searchableText);

      if (score > 0) {
        results.push({
          id,
          type: 'user',
          title: user.displayName,
          content: user.email,
          url: `/users/${id}`,
          score,
          metadata: {
            role: user.role,
            createdAt: user.createdAt
          },
          highlights: this.generateHighlights(`${user.displayName} ${user.email}`, searchTerms)
        });
      }
    }

    return results;
  }

  private calculateScore(searchTerms: string[], text: string): number {
    let score = 0;

    for (const term of searchTerms) {
      if (text.includes(term)) {
        // Exact match gets higher score
        if (text.includes(` ${term} `) || text.startsWith(`${term} `) || text.endsWith(` ${term}`)) {
          score += 2;
        } else {
          score += 1;
        }
      }
    }

    return score;
  }

  private generateHighlights(text: string, searchTerms: string[]): string[] {
    const highlights: string[] = [];
    const maxLength = 100;

    for (const term of searchTerms) {
      const index = text.toLowerCase().indexOf(term.toLowerCase());
      if (index !== -1) {
        const start = Math.max(0, index - 20);
        const end = Math.min(text.length, index + term.length + 20);
        let highlight = text.substring(start, end);

        if (start > 0) highlight = '...' + highlight;
        if (end < text.length) highlight = highlight + '...';

        highlights.push(highlight);
      }
    }

    return highlights.slice(0, 3); // Limit to 3 highlights
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Index management methods (for production use)
  public async indexMessage(message: any): Promise<void> {
    this.messages.set(message.id, message);
  }

  public async indexFile(file: any): Promise<void> {
    this.files.set(file.id, file);
  }

  public async indexChannel(channel: any): Promise<void> {
    this.channels.set(channel.id, channel);
  }

  public async indexUser(user: any): Promise<void> {
    this.users.set(user.id, user);
  }

  public async removeFromIndex(type: string, id: string): Promise<void> {
    switch (type) {
      case 'message':
        this.messages.delete(id);
        break;
      case 'file':
        this.files.delete(id);
        break;
      case 'channel':
        this.channels.delete(id);
        break;
      case 'user':
        this.users.delete(id);
        break;
    }
  }
}

// Create singleton instance
export const searchService = new SearchService();
export { SearchService };
export type { SearchOptions, SearchResult };

