import React, { useEffect, useState } from 'react';

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

interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  took: number;
}

interface AdvancedSearchProps {
  onResultClick?: (result: SearchResult) => void;
  onClose?: () => void;
}

const AdvancedSearch: React.FC<AdvancedSearchProps> = ({ onResultClick, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchType, setSearchType] = useState<'all' | 'messages' | 'files' | 'channels' | 'users'>('all');
  const [total, setTotal] = useState(0);
  const [took, setTook] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (query.trim()) {
      const timeoutId = setTimeout(() => {
        performSearch();
      }, 300); // Debounce search

      return () => clearTimeout(timeoutId);
    } else {
      setResults([]);
      setTotal(0);
    }
  }, [query, searchType]);

  const performSearch = async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}&type=${searchType}&limit=20`,
        { credentials: 'include' }
      );

      if (response.ok) {
        const data: SearchResponse = await response.json();
        setResults(data.results);
        setTotal(data.total);
        setTook(data.took);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'message': return '💬';
      case 'file': return '📄';
      case 'channel': return '#';
      case 'user': return '👤';
      default: return '🔍';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'message': return 'text-blue-600 dark:text-blue-400';
      case 'file': return 'text-green-600 dark:text-green-400';
      case 'channel': return 'text-purple-600 dark:text-purple-400';
      case 'user': return 'text-orange-600 dark:text-orange-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      return 'Just now';
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else if (diffInHours < 168) {
      return `${Math.floor(diffInHours / 24)}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const handleResultClick = (result: SearchResult) => {
    onResultClick?.(result);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mt-20">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Search AAELink
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search Input */}
          <div className="mt-4 relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages, files, channels, and users..."
              className="w-full px-4 py-3 pl-10 pr-4 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              autoFocus
            />
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
              ) : (
                <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {showFilters ? 'Hide' : 'Show'} Filters
              </button>
            </div>

            {total > 0 && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {total} results in {took}ms
              </div>
            )}
          </div>

          {/* Filter Options */}
          {showFilters && (
            <div className="mt-3 flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-700 dark:text-gray-300">Type:</label>
                <select
                  value={searchType}
                  onChange={(e) => setSearchType(e.target.value as any)}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 dark:bg-gray-700 dark:text-white"
                >
                  <option value="all">All</option>
                  <option value="messages">Messages</option>
                  <option value="files">Files</option>
                  <option value="channels">Channels</option>
                  <option value="users">Users</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {query && !isLoading && results.length === 0 && (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              <div className="text-4xl mb-2">🔍</div>
              <p>No results found for "{query}"</p>
              <p className="text-sm mt-1">Try different keywords or check your spelling</p>
            </div>
          )}

          {results.map((result) => (
            <div
              key={`${result.type}-${result.id}`}
              onClick={() => handleResultClick(result)}
              className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0"
            >
              <div className="flex items-start space-x-3">
                <div className={`text-lg ${getTypeColor(result.type)}`}>
                  {getTypeIcon(result.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {result.title}
                    </h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${getTypeColor(result.type)} bg-opacity-10`}>
                      {result.type}
                    </span>
                  </div>

                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {result.content}
                  </p>

                  {result.highlights.length > 0 && (
                    <div className="mt-2">
                      {result.highlights.map((highlight, index) => (
                        <span
                          key={index}
                          className="text-xs bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 px-1 rounded"
                        >
                          {highlight}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {result.metadata.createdAt && formatDate(result.metadata.createdAt)}
                    </div>
                    <div className="text-xs text-gray-400">
                      Score: {result.score.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {query && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
              Press <kbd className="px-1 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-xs">Esc</kbd> to close
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvancedSearch;
