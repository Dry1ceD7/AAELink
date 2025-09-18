'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
    Mic,
    MicOff,
    PhoneOff,
    Settings,
    Share,
    Users,
    Video,
    VideoOff
} from 'lucide-react';
import { useRef, useState } from 'react';

interface Participant {
  id: string;
  name: string;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  isSpeaking: boolean;
}

interface VideoRoomProps {
  roomId: string;
  participants: Participant[];
  onJoinRoom: (roomId: string) => void;
  onLeaveRoom: () => void;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
  onShareScreen: () => void;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  isScreenSharing: boolean;
}

export function VideoRoom({
  roomId,
  participants,
  onJoinRoom,
  onLeaveRoom,
  onToggleVideo,
  onToggleAudio,
  onShareScreen,
  isVideoEnabled,
  isAudioEnabled,
  isScreenSharing
}: VideoRoomProps) {
  const [isJoined, setIsJoined] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [roomName, setRoomName] = useState(roomId);
  const [showSettings, setShowSettings] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const screenShareRef = useRef<HTMLVideoElement>(null);

  const handleJoinRoom = async () => {
    setIsConnecting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      onJoinRoom(roomId);
      setIsJoined(true);
    } catch (error) {
      console.error('Error joining room:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleLeaveRoom = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    onLeaveRoom();
    setIsJoined(false);
  };

  const handleShareScreen = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      if (screenShareRef.current) {
        screenShareRef.current.srcObject = stream;
      }

      onShareScreen();
    } catch (error) {
      console.error('Error sharing screen:', error);
    }
  };

  if (!isJoined) {
    return (
      <Card className="w-96 mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Join Video Room</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Room ID</label>
            <Input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Enter room ID"
              className="mt-1"
            />
          </div>

          <div className="flex justify-center">
            <Button
              onClick={handleJoinRoom}
              disabled={isConnecting || !roomName.trim()}
              className="w-full"
            >
              <Video className="w-4 h-4 mr-2" />
              {isConnecting ? 'Joining...' : 'Join Room'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h1 className="text-lg font-semibold">Room: {roomName}</h1>
          <Badge variant="secondary">
            <Users className="w-3 h-3 mr-1" />
            {participants.length}
          </Badge>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            onClick={() => setShowSettings(!showSettings)}
            variant="ghost"
            size="icon"
          >
            <Settings className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleLeaveRoom}
            variant="destructive"
            size="icon"
          >
            <PhoneOff className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main Video Area */}
      <div className="flex-1 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full">
          {/* Main Video (Self) */}
          <div className="relative bg-gray-800 rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn(
                "w-full h-full object-cover",
                !isVideoEnabled && "hidden"
              )}
            />
            {!isVideoEnabled && (
              <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                <VideoOff className="w-12 h-12 text-gray-400" />
              </div>
            )}

            {/* Self Video Label */}
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-sm">
              You {!isAudioEnabled && '(Muted)'}
            </div>
          </div>

          {/* Screen Share */}
          {isScreenSharing && (
            <div className="relative bg-gray-800 rounded-lg overflow-hidden">
              <video
                ref={screenShareRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-sm">
                Screen Share
              </div>
            </div>
          )}

          {/* Other Participants */}
          {participants.map((participant) => (
            <div key={participant.id} className="relative bg-gray-800 rounded-lg overflow-hidden">
              <div className={cn(
                "w-full h-full flex items-center justify-center",
                participant.isVideoEnabled ? "bg-gray-700" : "bg-gray-600"
              )}>
                {participant.isVideoEnabled ? (
                  <div className="w-full h-full bg-gray-600 flex items-center justify-center">
                    <Video className="w-12 h-12 text-gray-400" />
                  </div>
                ) : (
                  <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-xl font-bold">
                      {participant.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-sm">
                {participant.name}
                {!participant.isAudioEnabled && ' (Muted)'}
                {participant.isSpeaking && ' 🎤'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 p-4">
        <div className="flex justify-center space-x-4">
          <Button
            onClick={onToggleAudio}
            variant={isAudioEnabled ? "outline" : "destructive"}
            size="icon"
          >
            {isAudioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </Button>

          <Button
            onClick={onToggleVideo}
            variant={isVideoEnabled ? "outline" : "destructive"}
            size="icon"
          >
            {isVideoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </Button>

          <Button
            onClick={handleShareScreen}
            variant={isScreenSharing ? "outline" : "secondary"}
            size="icon"
          >
            <Share className="w-4 h-4" />
          </Button>

          <Button
            onClick={handleLeaveRoom}
            variant="destructive"
            size="icon"
          >
            <PhoneOff className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="absolute top-16 right-4 bg-gray-800 p-4 rounded-lg shadow-lg w-64">
          <h3 className="font-semibold mb-2">Room Settings</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Camera</span>
              <Button
                onClick={onToggleVideo}
                variant={isVideoEnabled ? "outline" : "destructive"}
                size="sm"
              >
                {isVideoEnabled ? 'On' : 'Off'}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Microphone</span>
              <Button
                onClick={onToggleAudio}
                variant={isAudioEnabled ? "outline" : "destructive"}
                size="sm"
              >
                {isAudioEnabled ? 'On' : 'Off'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
