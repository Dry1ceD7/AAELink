'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/utils'
import { Heart, MoreVertical, Reply, Share } from 'lucide-react'
import { useState } from 'react'

interface Message {
  id: string
  user: {
    id: string
    name: string
    avatar?: string
    initials: string
    status: 'online' | 'offline' | 'away'
  }
  content: string
  timestamp: Date
  reactions: Array<{
    emoji: string
    count: number
    users: string[]
  }>
  isOwn: boolean
}

interface MessageListProps {
  messages: Message[]
  onReaction?: (messageId: string, emoji: string) => void
  onReply?: (messageId: string) => void
  onShare?: (messageId: string) => void
}

export function MessageList({ messages, onReaction, onReply, onShare }: MessageListProps) {
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null)

  const handleReaction = (messageId: string, emoji: string) => {
    onReaction?.(messageId, emoji)
  }

  const handleReply = (messageId: string) => {
    onReply?.(messageId)
  }

  const handleShare = (messageId: string) => {
    onShare?.(messageId)
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex gap-3 group hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded-lg transition-colors ${
            message.isOwn ? 'flex-row-reverse' : ''
          }`}
          onMouseEnter={() => setHoveredMessage(message.id)}
          onMouseLeave={() => setHoveredMessage(null)}
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={message.user.avatar} />
            <AvatarFallback className="bg-aae-blue text-white">
              {message.user.initials}
            </AvatarFallback>
          </Avatar>

          <div className={`flex-1 ${message.isOwn ? 'text-right' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                {message.user.name}
              </span>
              <div className={`w-2 h-2 rounded-full ${
                message.user.status === 'online' ? 'bg-green-500' :
                message.user.status === 'away' ? 'bg-yellow-500' : 'bg-gray-400'
              }`} />
              <span className="text-xs text-gray-500">
                {formatRelativeTime(message.timestamp)}
              </span>
            </div>

            <Card className={`p-3 max-w-md ${
              message.isOwn
                ? 'bg-aae-blue text-white ml-auto'
                : 'bg-white dark:bg-gray-700'
            }`}>
              <p className="text-sm">{message.content}</p>
            </Card>

            {message.reactions.length > 0 && (
              <div className="flex gap-1 mt-2">
                {message.reactions.map((reaction, index) => (
                  <button
                    key={index}
                    className="flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-600 rounded-full text-xs hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                    onClick={() => handleReaction(message.id, reaction.emoji)}
                  >
                    <span>{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {hoveredMessage === message.id && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleReaction(message.id, '❤️')}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
              >
                <Heart className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleReply(message.id)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
              >
                <Reply className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleShare(message.id)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
              >
                <Share className="h-4 w-4" />
              </button>
              <button className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
