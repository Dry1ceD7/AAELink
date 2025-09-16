/**
 * Calendar Service
 * Handles events, meetings, and calendar management
 */

import { v4 as uuidv4 } from 'uuid';

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location?: string;
  attendees: string[];
  createdBy: string;
  channelId?: string;
  isRecurring: boolean;
  recurrenceRule?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

interface CreateEventData {
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  allDay?: boolean;
  location?: string;
  attendees?: string[];
  channelId?: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
  metadata?: Record<string, any>;
}

interface EventFilter {
  userId?: string;
  channelId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

class CalendarService {
  private events = new Map<string, CalendarEvent>();
  private initialized = false;

  constructor() {
    this.initializeMockData();
  }

  private initializeMockData() {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Mock events
    const mockEvents: CalendarEvent[] = [
      {
        id: 'event_1',
        title: 'Team Standup',
        description: 'Daily standup meeting with the development team',
        startDate: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
        endDate: new Date(now.getTime() + 2.5 * 60 * 60 * 1000).toISOString(),
        allDay: false,
        location: 'Conference Room A',
        attendees: ['admin_001', 'user_002', 'user_003'],
        createdBy: 'admin_001',
        channelId: 'general',
        isRecurring: true,
        recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          meetingType: 'standup',
          priority: 'high'
        }
      },
      {
        id: 'event_2',
        title: 'Project Review',
        description: 'Monthly project review and planning session',
        startDate: tomorrow.toISOString(),
        endDate: new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        allDay: false,
        location: 'Main Conference Room',
        attendees: ['admin_001', 'user_004', 'user_005'],
        createdBy: 'admin_001',
        channelId: 'development',
        isRecurring: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          meetingType: 'review',
          priority: 'medium'
        }
      },
      {
        id: 'event_3',
        title: 'Company All-Hands',
        description: 'Monthly all-hands meeting with company updates',
        startDate: nextWeek.toISOString(),
        endDate: new Date(nextWeek.getTime() + 1.5 * 60 * 60 * 1000).toISOString(),
        allDay: false,
        location: 'Auditorium',
        attendees: ['admin_001', 'user_002', 'user_003', 'user_004', 'user_005'],
        createdBy: 'admin_001',
        isRecurring: true,
        recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          meetingType: 'all-hands',
          priority: 'high'
        }
      }
    ];

    mockEvents.forEach(event => {
      this.events.set(event.id, event);
    });

    this.initialized = true;
    console.log('Calendar service initialized with mock data');
  }

  public async createEvent(userId: string, eventData: CreateEventData): Promise<CalendarEvent> {
    if (!this.initialized) {
      throw new Error('Calendar service not initialized');
    }

    const event: CalendarEvent = {
      id: uuidv4(),
      title: eventData.title,
      description: eventData.description,
      startDate: eventData.startDate,
      endDate: eventData.endDate,
      allDay: eventData.allDay || false,
      location: eventData.location,
      attendees: eventData.attendees || [],
      createdBy: userId,
      channelId: eventData.channelId,
      isRecurring: eventData.isRecurring || false,
      recurrenceRule: eventData.recurrenceRule,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: eventData.metadata || {}
    };

    this.events.set(event.id, event);
    console.log(`Event created: ${event.title} by ${userId}`);
    
    return event;
  }

  public async getEvents(filter: EventFilter = {}): Promise<{
    events: CalendarEvent[];
    total: number;
  }> {
    if (!this.initialized) {
      throw new Error('Calendar service not initialized');
    }

    let filteredEvents = Array.from(this.events.values());

    // Apply filters
    if (filter.userId) {
      filteredEvents = filteredEvents.filter(event => 
        event.createdBy === filter.userId || 
        event.attendees.includes(filter.userId)
      );
    }

    if (filter.channelId) {
      filteredEvents = filteredEvents.filter(event => 
        event.channelId === filter.channelId
      );
    }

    if (filter.startDate) {
      const startDate = new Date(filter.startDate);
      filteredEvents = filteredEvents.filter(event => 
        new Date(event.startDate) >= startDate
      );
    }

    if (filter.endDate) {
      const endDate = new Date(filter.endDate);
      filteredEvents = filteredEvents.filter(event => 
        new Date(event.startDate) <= endDate
      );
    }

    // Sort by start date
    filteredEvents.sort((a, b) => 
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;
    const paginatedEvents = filteredEvents.slice(offset, offset + limit);

    return {
      events: paginatedEvents,
      total: filteredEvents.length
    };
  }

  public async getEvent(eventId: string): Promise<CalendarEvent | null> {
    if (!this.initialized) {
      throw new Error('Calendar service not initialized');
    }

    return this.events.get(eventId) || null;
  }

  public async updateEvent(eventId: string, userId: string, updates: Partial<CreateEventData>): Promise<CalendarEvent | null> {
    if (!this.initialized) {
      throw new Error('Calendar service not initialized');
    }

    const event = this.events.get(eventId);
    if (!event) {
      return null;
    }

    // Check if user can update the event
    if (event.createdBy !== userId) {
      throw new Error('Unauthorized to update this event');
    }

    const updatedEvent: CalendarEvent = {
      ...event,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    this.events.set(eventId, updatedEvent);
    console.log(`Event updated: ${updatedEvent.title}`);
    
    return updatedEvent;
  }

  public async deleteEvent(eventId: string, userId: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error('Calendar service not initialized');
    }

    const event = this.events.get(eventId);
    if (!event) {
      return false;
    }

    // Check if user can delete the event
    if (event.createdBy !== userId) {
      throw new Error('Unauthorized to delete this event');
    }

    this.events.delete(eventId);
    console.log(`Event deleted: ${event.title}`);
    
    return true;
  }

  public async getUpcomingEvents(userId: string, days: number = 7): Promise<CalendarEvent[]> {
    if (!this.initialized) {
      throw new Error('Calendar service not initialized');
    }

    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const { events } = await this.getEvents({
      userId,
      startDate: now.toISOString(),
      endDate: futureDate.toISOString()
    });

    return events;
  }

  public async getTodayEvents(userId: string): Promise<CalendarEvent[]> {
    if (!this.initialized) {
      throw new Error('Calendar service not initialized');
    }

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    const { events } = await this.getEvents({
      userId,
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString()
    });

    return events;
  }

  public async searchEvents(query: string, userId?: string): Promise<CalendarEvent[]> {
    if (!this.initialized) {
      throw new Error('Calendar service not initialized');
    }

    const searchTerm = query.toLowerCase();
    let events = Array.from(this.events.values());

    if (userId) {
      events = events.filter(event => 
        event.createdBy === userId || 
        event.attendees.includes(userId)
      );
    }

    return events.filter(event => 
      event.title.toLowerCase().includes(searchTerm) ||
      event.description?.toLowerCase().includes(searchTerm) ||
      event.location?.toLowerCase().includes(searchTerm)
    );
  }

  // Recurring event expansion
  public async expandRecurringEvents(eventId: string, startDate: string, endDate: string): Promise<CalendarEvent[]> {
    const event = this.events.get(eventId);
    if (!event || !event.isRecurring || !event.recurrenceRule) {
      return [];
    }

    // Simple recurrence expansion (in production, use a proper RRULE parser)
    const events: CalendarEvent[] = [];
    const baseEvent = { ...event };
    const start = new Date(startDate);
    const end = new Date(endDate);
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    const duration = eventEnd.getTime() - eventStart.getTime();

    let currentDate = new Date(eventStart);
    while (currentDate <= end) {
      if (currentDate >= start) {
        const expandedEvent: CalendarEvent = {
          ...baseEvent,
          id: `${event.id}_${currentDate.getTime()}`,
          startDate: currentDate.toISOString(),
          endDate: new Date(currentDate.getTime() + duration).toISOString(),
          isRecurring: false // Mark as expanded instance
        };
        events.push(expandedEvent);
      }

      // Simple daily recurrence (in production, parse RRULE properly)
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return events;
  }
}

// Create singleton instance
export const calendarService = new CalendarService();
export { CalendarService };
export type { CalendarEvent, CreateEventData, EventFilter };
