import React from 'react';

interface Channel {
  id: string;
  name: string;
  description: string;
}

interface ChannelListProps {
  channels: Channel[];
  selectedChannel: string;
  onChannelSelect: (channelId: string) => void;
}

const ChannelList: React.FC<ChannelListProps> = ({
  channels,
  selectedChannel,
  onChannelSelect
}) => {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-2 space-y-1">
        {channels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onChannelSelect(channel.id)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              selectedChannel === channel.id
                ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/20 dark:text-blue-100'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            <div className="flex items-center">
              <span className="text-gray-500 dark:text-gray-400 mr-2">#</span>
              <span className="font-medium">{channel.name}</span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
              {channel.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ChannelList;
