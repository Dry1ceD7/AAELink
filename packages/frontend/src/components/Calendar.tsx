import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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

interface CalendarProps {
  onEventClick?: (event: CalendarEvent) => void;
  onEventCreate?: (event: CalendarEvent) => void;
  className?: string;
}

const Calendar: React.FC<CalendarProps> = ({ onEventClick, onEventCreate, className = '' }) => {
  const { t } = useTranslation();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    loadEvents();
  }, [currentDate, view]);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const startDate = getViewStartDate();
      const endDate = getViewEndDate();
      
      const response = await fetch(
        `/api/calendar/events?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        { credentials: 'include' }
      );

      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
      }
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setLoading(false);
    }
  };

  const getViewStartDate = (): Date => {
    const date = new Date(currentDate);
    switch (view) {
      case 'month':
        date.setDate(1);
        date.setHours(0, 0, 0, 0);
        // Go to start of week (Sunday)
        date.setDate(date.getDate() - date.getDay());
        return date;
      case 'week':
        date.setDate(date.getDate() - date.getDay());
        date.setHours(0, 0, 0, 0);
        return date;
      case 'day':
        date.setHours(0, 0, 0, 0);
        return date;
      default:
        return date;
    }
  };

  const getViewEndDate = (): Date => {
    const date = new Date(currentDate);
    switch (view) {
      case 'month':
        date.setMonth(date.getMonth() + 1);
        date.setDate(0); // Last day of current month
        date.setHours(23, 59, 59, 999);
        // Go to end of week (Saturday)
        date.setDate(date.getDate() + (6 - date.getDay()));
        return date;
      case 'week':
        date.setDate(date.getDate() - date.getDay() + 6);
        date.setHours(23, 59, 59, 999);
        return date;
      case 'day':
        date.setHours(23, 59, 59, 999);
        return date;
      default:
        return date;
    }
  };

  const getDaysInView = (): Date[] => {
    const startDate = getViewStartDate();
    const days: Date[] = [];
    const daysToShow = view === 'month' ? 42 : view === 'week' ? 7 : 1;

    for (let i = 0; i < daysToShow; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      days.push(date);
    }

    return days;
  };

  const getEventsForDate = (date: Date): CalendarEvent[] => {
    return events.filter(event => {
      const eventDate = new Date(event.startDate);
      return eventDate.toDateString() === date.toDateString();
    });
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isToday = (date: Date): boolean => {
    return date.toDateString() === new Date().toDateString();
  };

  const isCurrentMonth = (date: Date): boolean => {
    return date.getMonth() === currentDate.getMonth();
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    switch (view) {
      case 'month':
        newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
        break;
      case 'week':
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
        break;
      case 'day':
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
        break;
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const renderMonthView = () => {
    const days = getDaysInView();
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
        {/* Week day headers */}
        {weekDays.map(day => (
          <div key={day} className="bg-gray-100 dark:bg-gray-800 p-2 text-center text-sm font-medium text-gray-700 dark:text-gray-300">
            {day}
          </div>
        ))}
        
        {/* Calendar days */}
        {days.map((date, index) => {
          const dayEvents = getEventsForDate(date);
          const isCurrentDay = isToday(date);
          const isCurrentMonthDay = isCurrentMonth(date);

          return (
            <div
              key={index}
              className={`bg-white dark:bg-gray-900 p-2 min-h-[100px] ${
                isCurrentDay ? 'bg-blue-50 dark:bg-blue-900/20' : ''
              } ${!isCurrentMonthDay ? 'text-gray-400 dark:text-gray-600' : ''}`}
            >
              <div className={`text-sm font-medium ${isCurrentDay ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                {date.getDate()}
              </div>
              
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 3).map(event => (
                  <div
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className="text-xs p-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/50 truncate"
                  >
                    {event.allDay ? event.title : `${formatTime(new Date(event.startDate))} ${event.title}`}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderWeekView = () => {
    const days = getDaysInView();
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="flex flex-col h-full">
        {/* Week day headers */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
          {weekDays.map((day, index) => (
            <div key={day} className="bg-gray-100 dark:bg-gray-800 p-2 text-center text-sm font-medium text-gray-700 dark:text-gray-300">
              <div>{day}</div>
              <div className={`text-lg ${isToday(days[index]) ? 'text-blue-600 dark:text-blue-400 font-bold' : ''}`}>
                {days[index].getDate()}
              </div>
            </div>
          ))}
        </div>
        
        {/* Week content */}
        <div className="flex-1 grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
          {days.map((date, index) => {
            const dayEvents = getEventsForDate(date);
            const isCurrentDay = isToday(date);

            return (
              <div
                key={index}
                className={`bg-white dark:bg-gray-900 p-2 ${
                  isCurrentDay ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <div className="space-y-1">
                  {dayEvents.map(event => (
                    <div
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className="text-xs p-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/50"
                    >
                      <div className="font-medium">{event.title}</div>
                      {!event.allDay && (
                        <div className="text-gray-600 dark:text-gray-400">
                          {formatTime(new Date(event.startDate))} - {formatTime(new Date(event.endDate))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const day = currentDate;
    const dayEvents = getEventsForDate(day);
    const hours = Array.from({ length: 24 }, (_, i) => i);

    return (
      <div className="flex h-full">
        {/* Time column */}
        <div className="w-16 bg-gray-100 dark:bg-gray-800">
          {hours.map(hour => (
            <div key={hour} className="h-12 border-b border-gray-200 dark:border-gray-700 p-1 text-xs text-gray-500 dark:text-gray-400">
              {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
            </div>
          ))}
        </div>
        
        {/* Events column */}
        <div className="flex-1 relative">
          {hours.map(hour => (
            <div key={hour} className="h-12 border-b border-gray-200 dark:border-gray-700"></div>
          ))}
          
          {/* Events */}
          {dayEvents.map(event => {
            const startTime = new Date(event.startDate);
            const endTime = new Date(event.endDate);
            const startHour = startTime.getHours() + startTime.getMinutes() / 60;
            const endHour = endTime.getHours() + endTime.getMinutes() / 60;
            const duration = endHour - startHour;

            return (
              <div
                key={event.id}
                onClick={() => setSelectedEvent(event)}
                className="absolute left-1 right-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded p-1 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/50"
                style={{
                  top: `${startHour * 48}px`,
                  height: `${duration * 48}px`
                }}
              >
                <div className="text-sm font-medium">{event.title}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {formatTime(startTime)} - {formatTime(endTime)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderView = () => {
    switch (view) {
      case 'month':
        return renderMonthView();
      case 'week':
        return renderWeekView();
      case 'day':
        return renderDayView();
      default:
        return renderMonthView();
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow ${className}`}>
      {/* Calendar Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {currentDate.toLocaleDateString('en-US', { 
                month: 'long', 
                year: 'numeric' 
              })}
            </h2>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => navigateDate('prev')}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={goToToday}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {t('calendar.today')}
              </button>
              <button
                onClick={() => navigateDate('next')}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg">
              {(['month', 'week', 'day'] as const).map(viewType => (
                <button
                  key={viewType}
                  onClick={() => setView(viewType)}
                  className={`px-3 py-1 text-sm rounded ${
                    view === viewType
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {t(`calendar.${viewType}`, viewType)}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {t('calendar.createEvent')}
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Body */}
      <div className="p-4">
        {renderView()}
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {selectedEvent.title}
                </h3>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-3">
                {selectedEvent.description && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('calendar.eventDescription')}
                    </label>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedEvent.description}
                    </p>
                  </div>
                )}
                
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('calendar.startDate')}
                  </label>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {new Date(selectedEvent.startDate).toLocaleString()}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('calendar.endDate')}
                  </label>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {new Date(selectedEvent.endDate).toLocaleString()}
                  </p>
                </div>
                
                {selectedEvent.location && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('calendar.location')}
                    </label>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedEvent.location}
                    </p>
                  </div>
                )}
                
                {selectedEvent.attendees.length > 0 && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('calendar.attendees')}
                    </label>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedEvent.attendees.join(', ')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
