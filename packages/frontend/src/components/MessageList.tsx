import React from 'react';

interface Message {
  id: string;
  content: string;
  userId: string;
  channelId: string;
  createdAt: string;
  type?: string;
  fileData?: {
    id: string;
    name: string;
    url: string;
    mimeType: string;
    size: number;
  };
}

interface MessageListProps {
  messages: Message[];
  currentUserId?: string;
}

const MessageList: React.FC<MessageListProps> = ({ messages, currentUserId }) => {
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.userId === currentUserId ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
              message.userId === currentUserId
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
            }`}
          >
            <div className="text-sm">
              {message.type === 'file' && message.fileData ? (
                <div className="flex items-center space-x-2">
                  <span>📎</span>
                  <a
                    href={message.fileData.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
                  >
                    {message.fileData.name}
                  </a>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({(message.fileData.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              ) : (
                message.content
              )}
            </div>
            <div
              className={`text-xs mt-1 ${
                message.userId === currentUserId
                  ? 'text-blue-100'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {formatTime(message.createdAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default MessageList;
