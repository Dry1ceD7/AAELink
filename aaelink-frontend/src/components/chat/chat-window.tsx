'use client'

import { useState, useEffect } from 'react'
import { MessageList } from './message-list'
import { MessageInput } from './message-input'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { formatRelativeTime } from '@/lib/utils'

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

interface ChatWindowProps {
  channelName: string
  channelId: string
  messages: Message[]
  onSendMessage: (content: string) => void
  onSendFile?: (files: File[]) => void
  onReaction?: (messageId: string, emoji: string) => void
  onReply?: (messageId: string) => void
  onShare?: (messageId: string) => void
  isConnected?: boolean
}

export function ChatWindow({
  channelName,
  channelId,
  messages,
  onSendMessage,
  onSendFile,
  onReaction,
  onReply,
  onShare,
  isConnected = true
}: ChatWindowProps) {
  const [isRecording, setIsRecording] = useState(false)
  const { toast } = useToast()

  const handleSendMessage = (content: string) => {
    if (!isConnected) {
      toast({
        title: "Connection Error",
        description: "You are not connected to the chat server.",
        variant: "destructive",
      })
      return
    }
    onSendMessage(content)
  }

  const handleSendFile = (files: File[]) => {
    if (!isConnected) {
      toast({
        title: "Connection Error",
        description: "You are not connected to the chat server.",
        variant: "destructive",
      })
      return
    }
    onSendFile?.(files)
    toast({
      title: "Files Uploaded",
      description: `${files.length} file(s) have been uploaded successfully.`,
      variant: "success",
    })
  }

  const handleReaction = (messageId: string, emoji: string) => {
    onReaction?.(messageId, emoji)
    toast({
      title: "Reaction Added",
      description: `Added ${emoji} reaction to message.`,
    })
  }

  const handleReply = (messageId: string) => {
    onReply?.(messageId)
    toast({
      title: "Reply Started",
      description: "You are now replying to a message.",
    })
  }

  const handleShare = (messageId: string) => {
    onShare?.(messageId)
    toast({
      title: "Message Shared",
      description: "Message has been shared successfully.",
    })
  }

  const handleStartVoice = () => {
    setIsRecording(true)
    toast({
      title: "Voice Recording",
      description: "Voice recording started. Click the microphone again to stop.",
    })
  }

  const handleStopVoice = () => {
    setIsRecording(false)
    toast({
      title: "Voice Recording",
      description: "Voice recording stopped and sent.",
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Channel Header */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <h2 className="text-lg font-semibold">#{channelName}</h2>
          <span className="text-sm text-gray-500">
            {messages.length} messages
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            Search
          </Button>
          <Button variant="ghost" size="sm">
            Members
          </Button>
          <Button variant="ghost" size="sm">
            Settings
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={messages}
          onReaction={handleReaction}
          onReply={handleReply}
          onShare={handleShare}
        />
      </div>

      {/* Message Input */}
      <MessageInput
        onSendMessage={handleSendMessage}
        onSendFile={handleSendFile}
        onStartVoice={handleStartVoice}
        onStopVoice={handleStopVoice}
        isRecording={isRecording}
        disabled={!isConnected}
        placeholder={isConnected ? `Message #${channelName}` : "Connecting..."}
      />
    </div>
  )
}
