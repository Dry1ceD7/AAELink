'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
    Calendar as CalendarIcon,
    ChevronLeft,
    ChevronRight,
    Clock,
    MapPin,
    Plus,
    Search,
    Users
} from 'lucide-react';
import { useState } from 'react';

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  attendees: string[];
  type: 'meeting' | 'deadline' | 'reminder' | 'holiday';
  isAllDay: boolean;
}

interface CalendarViewProps {
  channelId: string;
}

export function CalendarView({ channelId }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  // Mock data for demonstration
  const mockEvents: CalendarEvent[] = [
    {
      id: '1',
      title: 'Team Standup',
      description: 'Daily standup meeting',
      startTime: new Date(2024, 8, 18, 9, 0),
      endTime: new Date(2024, 8, 18, 9, 30),
      attendees: ['John Doe', 'Jane Smith', 'Mike Johnson'],
      type: 'meeting',
      isAllDay: false
    },
    {
      id: '2',
      title: 'Project Deadline',
      description: 'Q3 Project deliverables due',
      startTime: new Date(2024, 8, 25, 17, 0),
      endTime: new Date(2024, 8, 25, 17, 0),
      attendees: ['Development Team'],
      type: 'deadline',
      isAllDay: true
    },
    {
      id: '3',
      title: 'Client Meeting',
      description: 'Presentation to AAE client',
      startTime: new Date(2024, 8, 20, 14, 0),
      endTime: new Date(2024, 8, 20, 15, 30),
      location: 'Conference Room A',
      attendees: ['Sarah Wilson', 'John Doe'],
      type: 'meeting',
      isAllDay: false
    },
    {
      id: '4',
      title: 'Company Holiday',
      description: 'National Holiday',
      startTime: new Date(2024, 8, 24, 0, 0),
      endTime: new Date(2024, 8, 24, 23, 59),
      attendees: ['All Staff'],
      type: 'holiday',
      isAllDay: true
    }
  ];

  const [events, setEvents] = useState<CalendarEvent[]>(mockEvents);

  const getEventTypeColor = (type: string) => {
    switch (type) {
      case 'meeting': return 'bg-blue-500';
      case 'deadline': return 'bg-red-500';
      case 'reminder': return 'bg-yellow-500';
      case 'holiday': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getEventTypeIcon = (type: string) => {
    switch (type) {
      case 'meeting': return '👥';
      case 'deadline': return '⏰';
      case 'reminder': return '🔔';
      case 'holiday': return '🎉';
      default: return '📅';
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  };

  const getEventsForDate = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.startTime);
      return eventDate.toDateString() === date.toDateString();
    });
  };

  const filteredEvents = events.filter(event => {
    const matchesSearch = event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         event.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || event.type === filterType;
    return matchesSearch && matchesFilter;
  });

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(newDate.getMonth() - 1);
      } else {
        newDate.setMonth(newDate.getMonth() + 1);
      }
      return newDate;
    });
  };

  const days = getDaysInMonth(currentDate);
  const monthName = currentDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Calendar
          </h2>
          <Badge variant="outline" className="text-xs">
            {channelId}
          </Badge>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView('month')}
            className={view === 'month' ? 'bg-blue-100 dark:bg-blue-900' : ''}
          >
            Month
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView('week')}
            className={view === 'week' ? 'bg-blue-100 dark:bg-blue-900' : ''}
          >
            Week
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView('day')}
            className={view === 'day' ? 'bg-blue-100 dark:bg-blue-900' : ''}
          >
            Day
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800"
        >
          <option value="all">All Types</option>
          <option value="meeting">Meetings</option>
          <option value="deadline">Deadlines</option>
          <option value="reminder">Reminders</option>
          <option value="holiday">Holidays</option>
        </select>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-2" />
          New Event
        </Button>
      </div>

      {/* Calendar View */}
      {view === 'month' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{monthName}</CardTitle>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateMonth('prev')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateMonth('next')}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1">
              {/* Day headers */}
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="p-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400">
                  {day}
                </div>
              ))}

              {/* Calendar days */}
              {days.map((day, index) => (
                <div
                  key={index}
                  className={cn(
                    "min-h-[100px] p-2 border border-gray-200 dark:border-gray-700",
                    day ? "bg-white dark:bg-gray-800" : "bg-gray-50 dark:bg-gray-900"
                  )}
                >
                  {day && (
                    <>
                      <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                        {day.getDate()}
                      </div>
                      <div className="space-y-1">
                        {getEventsForDate(day).slice(0, 3).map(event => (
                          <div
                            key={event.id}
                            className={cn(
                              "text-xs p-1 rounded truncate text-white",
                              getEventTypeColor(event.type)
                            )}
                          >
                            {getEventTypeIcon(event.type)} {event.title}
                          </div>
                        ))}
                        {getEventsForDate(day).length > 3 && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            +{getEventsForDate(day).length - 3} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Events List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Upcoming Events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <CalendarIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No events found</p>
            </div>
          ) : (
            filteredEvents.map(event => (
              <div
                key={event.id}
                className="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className={cn(
                  "w-3 h-3 rounded-full mt-1 flex-shrink-0",
                  getEventTypeColor(event.type)
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                      {event.title}
                    </h3>
                    <Badge variant="outline" className="text-xs">
                      {event.type}
                    </Badge>
                  </div>
                  {event.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                      {event.description}
                    </p>
                  )}
                  <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>
                        {event.isAllDay ? 'All day' : `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <CalendarIcon className="w-3 h-3" />
                      <span>{formatDate(event.startTime)}</span>
                    </div>
                    {event.location && (
                      <div className="flex items-center space-x-1">
                        <MapPin className="w-3 h-3" />
                        <span>{event.location}</span>
                      </div>
                    )}
                    <div className="flex items-center space-x-1">
                      <Users className="w-3 h-3" />
                      <span>{event.attendees.length} attendees</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
