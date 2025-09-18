'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface VoiceCallProps {
  isInCall: boolean;
  onEndCall: () => void;
  onAnswerCall: () => void;
  onRejectCall: () => void;
  callerName?: string;
  isIncoming?: boolean;
}

export function VoiceCall({
  isInCall,
  onEndCall,
  onAnswerCall,
  onRejectCall,
  callerName = 'Unknown',
  isIncoming = false
}: VoiceCallProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isInCall && !isIncoming) {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isInCall, isIncoming]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleSpeaker = () => {
    if (audioRef.current) {
      audioRef.current.muted = !audioRef.current.muted;
      setIsSpeakerEnabled(!audioRef.current.muted);
    }
  };

  const handleAnswerCall = async () => {
    setIsConnecting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });
      streamRef.current = stream;

      if (audioRef.current) {
        audioRef.current.srcObject = stream;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      onAnswerCall();
    } catch (error) {
      console.error('Error accessing media devices:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleEndCall = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    onEndCall();
    setCallDuration(0);
  };

  if (isIncoming && !isInCall) {
    return (
      <Card className="w-80 mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Incoming Call</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-500 rounded-full mx-auto mb-4 flex items-center justify-center">
              <span className="text-white text-xl font-bold">
                {callerName.charAt(0).toUpperCase()}
              </span>
            </div>
            <p className="text-lg font-semibold">{callerName}</p>
            <p className="text-sm text-muted-foreground">Voice & Video Call</p>
          </div>

          <div className="flex justify-center space-x-4">
            <Button
              onClick={handleAnswerCall}
              disabled={isConnecting}
              className="bg-green-500 hover:bg-green-600"
            >
              <Phone className="w-4 h-4 mr-2" />
              {isConnecting ? 'Answering...' : 'Answer'}
            </Button>
            <Button
              onClick={onRejectCall}
              variant="destructive"
            >
              <PhoneOff className="w-4 h-4 mr-2" />
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isInCall) {
    return null;
  }

  return (
    <Card className="w-96 mx-auto">
      <CardHeader>
        <CardTitle className="text-center">
          {isIncoming ? 'Incoming Call' : `Call with ${callerName}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Video Stream */}
        <div className="relative bg-gray-900 rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "w-full h-48 object-cover",
              !isVideoEnabled && "hidden"
            )}
          />
          {!isVideoEnabled && (
            <div className="w-full h-48 bg-gray-800 flex items-center justify-center">
              <VideoOff className="w-12 h-12 text-gray-400" />
            </div>
          )}

          {/* Call Duration */}
          <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
            {formatDuration(callDuration)}
          </div>
        </div>

        {/* Call Controls */}
        <div className="flex justify-center space-x-4">
          <Button
            onClick={toggleMute}
            variant={isMuted ? "destructive" : "outline"}
            size="icon"
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>

          <Button
            onClick={toggleVideo}
            variant={isVideoEnabled ? "outline" : "destructive"}
            size="icon"
          >
            {isVideoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </Button>

          <Button
            onClick={toggleSpeaker}
            variant={isSpeakerEnabled ? "outline" : "secondary"}
            size="icon"
          >
            {isSpeakerEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>

          <Button
            onClick={handleEndCall}
            variant="destructive"
            size="icon"
          >
            <PhoneOff className="w-4 h-4" />
          </Button>
        </div>

        {/* Audio Element */}
        <audio ref={audioRef} autoPlay playsInline />
      </CardContent>
    </Card>
  );
}
