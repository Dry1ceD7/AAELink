'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Mic,
    MicOff,
    Phone,
    PhoneOff,
    Settings,
    Users,
    Video,
    VideoOff,
    Volume2,
    VolumeX
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface VoiceVideoCallProps {
  channelId: string;
  callType: 'voice' | 'video';
  isActive: boolean;
  onEndCall: () => void;
}

interface Participant {
  id: string;
  name: string;
  avatar: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking: boolean;
}

export function VoiceVideoCall({
  channelId,
  callType,
  isActive,
  onEndCall
}: VoiceVideoCallProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(callType === 'voice');
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [participants, setParticipants] = useState<Participant[]>([
    {
      id: '1',
      name: 'John Doe',
      avatar: 'JD',
      isMuted: false,
      isVideoOff: false,
      isSpeaking: true
    },
    {
      id: '2',
      name: 'Jane Smith',
      avatar: 'JS',
      isMuted: true,
      isVideoOff: false,
      isSpeaking: false
    },
    {
      id: '3',
      name: 'Mike Johnson',
      avatar: 'MJ',
      isMuted: false,
      isVideoOff: true,
      isSpeaking: false
    }
  ]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (isActive && callType === 'video') {
      startVideoCall();
    } else if (isActive && callType === 'voice') {
      startVoiceCall();
    }

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [isActive, callType]);

  const startVideoCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      localStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing camera/microphone:', error);
    }
  };

  const startVoiceCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });

      localStreamRef.current = stream;
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = isMuted;
      });
    }
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = isVideoOff;
      });
    }
    setIsVideoOff(!isVideoOff);
  };

  const toggleSpeaker = () => {
    setIsSpeakerOn(!isSpeakerOn);
  };

  const endCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    onEndCall();
  };

  if (!isActive) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              {callType === 'video' ? (
                <Video className="w-8 h-8 text-gray-400" />
              ) : (
                <Phone className="w-8 h-8 text-gray-400" />
              )}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {callType === 'video' ? 'Video Call' : 'Voice Call'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {callType === 'video'
                ? 'Start a video call with your team'
                : 'Start a voice call with your team'
              }
            </p>
            <Button onClick={() => {/* Start call logic */}}>
              {callType === 'video' ? (
                <>
                  <Video className="w-4 h-4 mr-2" />
                  Start Video Call
                </>
              ) : (
                <>
                  <Phone className="w-4 h-4 mr-2" />
                  Start Voice Call
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Call Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                {callType === 'video' ? (
                  <Video className="w-5 h-5 text-white" />
                ) : (
                  <Phone className="w-5 h-5 text-white" />
                )}
              </div>
              <div>
                <CardTitle className="text-lg">
                  {callType === 'video' ? 'Video Call' : 'Voice Call'}
                </CardTitle>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Channel: {channelId}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-green-600 border-green-600">
              Live
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Video/Audio Display */}
      <Card>
        <CardContent className="p-4">
          {callType === 'video' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Local Video */}
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  className="w-full h-48 bg-gray-900 rounded-lg object-cover"
                />
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                  You {isMuted && '(Muted)'}
                </div>
              </div>

              {/* Remote Video Placeholder */}
              <div className="w-full h-48 bg-gray-800 rounded-lg flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <Users className="w-12 h-12 mx-auto mb-2" />
                  <p>Waiting for participants...</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-24 h-24 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <Phone className="w-12 h-12 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Voice Call Active
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {participants.length} participants
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Participants */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Participants ({participants.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {participants.map(participant => (
              <div
                key={participant.id}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                        {participant.avatar}
                      </span>
                    </div>
                    {participant.isSpeaking && (
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-800"></div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {participant.name}
                    </p>
                    <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                      {participant.isMuted && (
                        <Badge variant="outline" className="text-xs">
                          <MicOff className="w-3 h-3 mr-1" />
                          Muted
                        </Badge>
                      )}
                      {participant.isVideoOff && callType === 'video' && (
                        <Badge variant="outline" className="text-xs">
                          <VideoOff className="w-3 h-3 mr-1" />
                          Camera Off
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Call Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-center space-x-4">
            <Button
              variant={isMuted ? "destructive" : "outline"}
              size="lg"
              onClick={toggleMute}
              className="w-12 h-12 rounded-full"
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>

            {callType === 'video' && (
              <Button
                variant={isVideoOff ? "destructive" : "outline"}
                size="lg"
                onClick={toggleVideo}
                className="w-12 h-12 rounded-full"
              >
                {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </Button>
            )}

            <Button
              variant={isSpeakerOn ? "default" : "outline"}
              size="lg"
              onClick={toggleSpeaker}
              className="w-12 h-12 rounded-full"
            >
              {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-12 h-12 rounded-full"
            >
              <Settings className="w-5 h-5" />
            </Button>

            <Button
              variant="destructive"
              size="lg"
              onClick={endCall}
              className="w-12 h-12 rounded-full"
            >
              <PhoneOff className="w-5 h-5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
