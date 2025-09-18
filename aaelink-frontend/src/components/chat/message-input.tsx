'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Mic, MicOff, Paperclip, Send, Smile } from 'lucide-react'
import { KeyboardEvent, useRef, useState } from 'react'

interface MessageInputProps {
  onSendMessage: (content: string) => void
  onSendFile?: (files: File[]) => void
  onStartVoice?: () => void
  onStopVoice?: () => void
  isRecording?: boolean
  placeholder?: string
  disabled?: boolean
}

export function MessageInput({
  onSendMessage,
  onSendFile,
  onStartVoice,
  onStopVoice,
  isRecording = false,
  placeholder = "Type a message...",
  disabled = false
}: MessageInputProps) {
  const [message, setMessage] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim())
      setMessage('')
      setIsTyping(false)
    }
  }

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0 && onSendFile) {
      onSendFile(files)
    }
  }

  const handleVoiceToggle = () => {
    if (isRecording) {
      onStopVoice?.()
    } else {
      onStartVoice?.()
    }
  }

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value)
    if (e.target.value && !isTyping) {
      setIsTyping(true)
    } else if (!e.target.value && isTyping) {
      setIsTyping(false)
    }
  }

  return (
    <Card className="p-4 border-t">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        <div className="flex-1 relative">
          <Input
            ref={inputRef}
            value={message}
            onChange={handleTyping}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            disabled={disabled}
            className="pr-10"
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 transform -translate-y-1/2"
            disabled={disabled}
          >
            <Smile className="h-4 w-4" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleVoiceToggle}
          disabled={disabled}
          className={isRecording ? 'text-red-500' : ''}
        >
          {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>

        <Button
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          className="bg-aae-blue hover:bg-aae-blue-dark"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
      />

      {isTyping && (
        <div className="mt-2 text-xs text-gray-500">
          Typing...
        </div>
      )}
    </Card>
  )
}
