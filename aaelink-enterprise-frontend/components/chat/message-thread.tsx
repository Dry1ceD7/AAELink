'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { formatDistanceToNow } from 'date-fns';
import {
    Edit,
    MessageCircle,
    Pin,
    ThumbsUp,
    Trash2
} from 'lucide-react';
import React, { useState } from 'react';

interface ThreadMessage {
  id: string;
  content: string;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  timestamp: Date;
  reactions: { emoji: string; count: number; users: string[] }[];
  isEdited?: boolean;
  isPinned?: boolean;
}

interface MessageThreadProps {
  parentMessage: {
    id: string;
    content: string;
    author: {
      id: string;
      name: string;
      avatar?: string;
    };
    timestamp: Date;
  };
  threadMessages: ThreadMessage[];
  onSendMessage: (content: string) => void;
  onReactToMessage: (messageId: string, emoji: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onPinMessage: (messageId: string) => void;
  currentUserId: string;
}

export function MessageThread({
  parentMessage,
  threadMessages,
  onSendMessage,
  onReactToMessage,
  onEditMessage,
  onDeleteMessage,
  onPinMessage,
  currentUserId
}: MessageThreadProps) {
  const [newMessage, setNewMessage] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      onSendMessage(newMessage.trim());
      setNewMessage('');
    }
  };

  const handleEditMessage = (messageId: string, currentContent: string) => {
    setEditingMessageId(messageId);
    setEditingContent(currentContent);
  };

  const handleSaveEdit = () => {
    if (editingMessageId && editingContent.trim()) {
      onEditMessage(editingMessageId, editingContent.trim());
      setEditingMessageId(null);
      setEditingContent('');
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (editingMessageId) {
        handleSaveEdit();
      } else {
        handleSendMessage();
      }
    }
  };

  const reactions = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡'];

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-2">
          <MessageCircle className="w-5 h-5 text-blue-500" />
          <CardTitle className="text-lg">Thread</CardTitle>
          <Badge variant="secondary">{threadMessages.length} replies</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Parent Message */}
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
          <div className="flex items-start space-x-3">
            <Avatar className="w-8 h-8">
              <AvatarImage src={parentMessage.author.avatar} />
              <AvatarFallback>
                {parentMessage.author.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-sm">{parentMessage.author.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(parentMessage.timestamp, { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm mt-1">{parentMessage.content}</p>
            </div>
          </div>
        </div>

        {/* Thread Messages */}
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {threadMessages.map((message) => (
            <div key={message.id} className="flex items-start space-x-3">
              <Avatar className="w-6 h-6">
                <AvatarImage src={message.author.avatar} />
                <AvatarFallback className="text-xs">
                  {message.author.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-sm">{message.author.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(message.timestamp, { addSuffix: true })}
                  </span>
                  {message.isEdited && (
                    <span className="text-xs text-muted-foreground">(edited)</span>
                  )}
                  {message.isPinned && (
                    <Pin className="w-3 h-3 text-yellow-500" />
                  )}
                </div>

                {editingMessageId === message.id ? (
                  <div className="mt-1 space-y-2">
                    <Textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      onKeyPress={handleKeyPress}
                      className="min-h-[60px]"
                      autoFocus
                    />
                    <div className="flex space-x-2">
                      <Button size="sm" onClick={handleSaveEdit}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1">
                    <p className="text-sm">{message.content}</p>

                    {/* Reactions */}
                    {message.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {message.reactions.map((reaction, index) => (
                          <Button
                            key={index}
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => onReactToMessage(message.id, reaction.emoji)}
                          >
                            {reaction.emoji} {reaction.count}
                          </Button>
                        ))}
                      </div>
                    )}

                    {/* Message Actions */}
                    <div className="flex items-center space-x-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => onReactToMessage(message.id, '👍')}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => onPinMessage(message.id)}
                      >
                        <Pin className="w-3 h-3" />
                      </Button>
                      {message.author.id === currentUserId && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => handleEditMessage(message.id, message.content)}
                          >
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-red-500"
                            onClick={() => onDeleteMessage(message.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* New Message Input */}
        <div className="space-y-2">
          <Textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Reply to thread..."
            className="min-h-[80px]"
          />
          <div className="flex justify-between items-center">
            <div className="flex space-x-1">
              {reactions.map((emoji) => (
                <Button
                  key={emoji}
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => onReactToMessage(parentMessage.id, emoji)}
                >
                  {emoji}
                </Button>
              ))}
            </div>
            <Button onClick={handleSendMessage} disabled={!newMessage.trim()}>
              Reply
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
