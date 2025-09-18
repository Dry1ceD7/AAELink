'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Search, 
  Filter, 
  Calendar, 
  User, 
  FileText, 
  MessageCircle,
  Hash,
  Star,
  Clock,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchFilters {
  query: string;
  type: 'all' | 'messages' | 'files' | 'users' | 'channels' | 'events';
  dateRange: 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';
  customDateFrom?: string;
  customDateTo?: string;
  author?: string;
  channel?: string;
  hasAttachments: boolean;
  isPinned: boolean;
  isStarred: boolean;
  sortBy: 'relevance' | 'date' | 'author' | 'channel';
  sortOrder: 'asc' | 'desc';
}

interface SearchResult {
  id: string;
  type: 'message' | 'file' | 'user' | 'channel' | 'event';
  title: string;
  content: string;
  author?: string;
  channel?: string;
  timestamp: Date;
  url: string;
  highlights: string[];
  metadata?: Record<string, any>;
}

interface AdvancedSearchProps {
  onSearch: (filters: SearchFilters) => void;
  onClear: () => void;
  results: SearchResult[];
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export function AdvancedSearch({
  onSearch,
  onClear,
  results,
  isLoading,
  isOpen,
  onClose
}: AdvancedSearchProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    type: 'all',
    dateRange: 'all',
    hasAttachments: false,
    isPinned: false,
    isStarred: false,
    sortBy: 'relevance',
    sortOrder: 'desc'
  });

  const [activeTab, setActiveTab] = useState('search');

  const handleFilterChange = (key: keyof SearchFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSearch = () => {
    if (filters.query.trim()) {
      onSearch(filters);
    }
  };

  const handleClear = () => {
    setFilters({
      query: '',
      type: 'all',
      dateRange: 'all',
      hasAttachments: false,
      isPinned: false,
      isStarred: false,
      sortBy: 'relevance',
      sortOrder: 'desc'
    });
    onClear();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const getResultIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'message':
        return <MessageCircle className="w-4 h-4" />;
      case 'file':
        return <FileText className="w-4 h-4" />;
      case 'user':
        return <User className="w-4 h-4" />;
      case 'channel':
        return <Hash className="w-4 h-4" />;
      case 'event':
        return <Calendar className="w-4 h-4" />;
      default:
        return <Search className="w-4 h-4" />;
    }
  };

  const getResultColor = (type: SearchResult['type']) => {
    switch (type) {
      case 'message':
        return 'text-blue-600';
      case 'file':
        return 'text-green-600';
      case 'user':
        return 'text-purple-600';
      case 'channel':
        return 'text-orange-600';
      case 'event':
        return 'text-pink-600';
      default:
        return 'text-gray-600';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Search className="w-5 h-5" />
              <CardTitle>Advanced Search</CardTitle>
            </div>
            <Button onClick={onClose} variant="ghost" size="icon">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start rounded-none border-b">
              <TabsTrigger value="search">Search</TabsTrigger>
              <TabsTrigger value="results">
                Results {results.length > 0 && `(${results.length})`}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="p-6">
              <div className="space-y-6">
                {/* Search Query */}
                <div className="space-y-2">
                  <Label htmlFor="query">Search Query</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="query"
                      value={filters.query}
                      onChange={(e) => handleFilterChange('query', e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Enter search terms..."
                      className="flex-1"
                    />
                    <Button onClick={handleSearch} disabled={!filters.query.trim() || isLoading}>
                      <Search className="w-4 h-4 mr-2" />
                      {isLoading ? 'Searching...' : 'Search'}
                    </Button>
                  </div>
                </div>

                {/* Search Type */}
                <div className="space-y-2">
                  <Label>Search Type</Label>
                  <Select value={filters.type} onValueChange={(value) => handleFilterChange('type', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="messages">Messages</SelectItem>
                      <SelectItem value="files">Files</SelectItem>
                      <SelectItem value="users">Users</SelectItem>
                      <SelectItem value="channels">Channels</SelectItem>
                      <SelectItem value="events">Events</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date Range */}
                <div className="space-y-2">
                  <Label>Date Range</Label>
                  <Select value={filters.dateRange} onValueChange={(value) => handleFilterChange('dateRange', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Time</SelectItem>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="week">This Week</SelectItem>
                      <SelectItem value="month">This Month</SelectItem>
                      <SelectItem value="year">This Year</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {filters.dateRange === 'custom' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="dateFrom">From</Label>
                        <Input
                          id="dateFrom"
                          type="date"
                          value={filters.customDateFrom || ''}
                          onChange={(e) => handleFilterChange('customDateFrom', e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="dateTo">To</Label>
                        <Input
                          id="dateTo"
                          type="date"
                          value={filters.customDateTo || ''}
                          onChange={(e) => handleFilterChange('customDateTo', e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Additional Filters */}
                <div className="space-y-4">
                  <Label>Additional Filters</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="attachments"
                        checked={filters.hasAttachments}
                        onCheckedChange={(checked: boolean) => handleFilterChange('hasAttachments', checked)}
                      />
                      <Label htmlFor="attachments">Has Attachments</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="pinned"
                        checked={filters.isPinned}
                        onCheckedChange={(checked: boolean) => handleFilterChange('isPinned', checked)}
                      />
                      <Label htmlFor="pinned">Pinned Messages</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="starred"
                        checked={filters.isStarred}
                        onCheckedChange={(checked: boolean) => handleFilterChange('isStarred', checked)}
                      />
                      <Label htmlFor="starred">Starred Messages</Label>
                    </div>
                  </div>
                </div>

                {/* Sort Options */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Sort By</Label>
                    <Select value={filters.sortBy} onValueChange={(value) => handleFilterChange('sortBy', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="relevance">Relevance</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="author">Author</SelectItem>
                        <SelectItem value="channel">Channel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Sort Order</Label>
                    <Select value={filters.sortOrder} onValueChange={(value) => handleFilterChange('sortOrder', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desc">Descending</SelectItem>
                        <SelectItem value="asc">Ascending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-between">
                  <Button onClick={handleClear} variant="outline">
                    Clear Filters
                  </Button>
                  <div className="space-x-2">
                    <Button onClick={onClose} variant="ghost">
                      Cancel
                    </Button>
                    <Button onClick={handleSearch} disabled={!filters.query.trim() || isLoading}>
                      Search
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="results" className="p-0">
              <div className="max-h-96 overflow-y-auto">
                {isLoading ? (
                  <div className="p-6 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                    <p className="mt-2 text-muted-foreground">Searching...</p>
                  </div>
                ) : results.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    No results found
                  </div>
                ) : (
                  <div className="divide-y">
                    {results.map((result) => (
                      <div key={result.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <div className="flex items-start space-x-3">
                          <div className={cn("mt-1", getResultColor(result.type))}>
                            {getResultIcon(result.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <h4 className="font-medium text-sm">{result.title}</h4>
                              <Badge variant="secondary" className="text-xs">
                                {result.type}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {result.content}
                            </p>
                            {result.highlights.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs text-muted-foreground">Highlights:</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {result.highlights.map((highlight, index) => (
                                    <Badge key={index} variant="outline" className="text-xs">
                                      {highlight}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="flex items-center space-x-4 mt-2 text-xs text-muted-foreground">
                              {result.author && (
                                <span>By {result.author}</span>
                              )}
                              {result.channel && (
                                <span>In {result.channel}</span>
                              )}
                              <span>
                                <Clock className="w-3 h-3 inline mr-1" />
                                {result.timestamp.toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
