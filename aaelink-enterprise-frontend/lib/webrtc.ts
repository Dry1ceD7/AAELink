import SimplePeer from 'simple-peer';

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  signalingServer: string;
}

export interface PeerConnection {
  id: string;
  peer: SimplePeer.Instance;
  stream?: MediaStream;
}

export class WebRTCService {
  private config: WebRTCConfig;
  private peers: Map<string, PeerConnection> = new Map();
  private localStream?: MediaStream;
  private socket?: WebSocket;
  private roomId?: string;

  constructor(config: WebRTCConfig) {
    this.config = config;
  }

  async initialize(roomId: string): Promise<void> {
    this.roomId = roomId;

    // Get user media
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    // Connect to signaling server
    this.socket = new WebSocket(this.config.signalingServer);
    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      console.log('Connected to signaling server');
      this.socket?.send(JSON.stringify({
        type: 'join',
        roomId: this.roomId
      }));
    };

    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleSignalingMessage(data);
    };

    this.socket.onclose = () => {
      console.log('Disconnected from signaling server');
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private handleSignalingMessage(data: any): void {
    switch (data.type) {
      case 'user-joined':
        this.createPeer(data.userId, false);
        break;
      case 'user-left':
        this.removePeer(data.userId);
        break;
      case 'offer':
        this.handleOffer(data.userId, data.offer);
        break;
      case 'answer':
        this.handleAnswer(data.userId, data.answer);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(data.userId, data.candidate);
        break;
    }
  }

  private createPeer(userId: string, initiator: boolean): void {
    const peer = new SimplePeer({
      initiator,
      stream: this.localStream,
      config: {
        iceServers: this.config.iceServers
      }
    });

    peer.on('signal', (signal) => {
      this.socket?.send(JSON.stringify({
        type: initiator ? 'offer' : 'answer',
        userId,
        [initiator ? 'offer' : 'answer']: signal
      }));
    });

    peer.on('stream', (stream) => {
      this.peers.set(userId, {
        id: userId,
        peer,
        stream
      });
      this.onRemoteStream?.(userId, stream);
    });

    peer.on('error', (error) => {
      console.error('Peer error:', error);
    });

    this.peers.set(userId, { id: userId, peer });
  }

  private handleOffer(userId: string, offer: any): void {
    const peerConnection = this.peers.get(userId);
    if (peerConnection) {
      peerConnection.peer.signal(offer);
    }
  }

  private handleAnswer(userId: string, answer: any): void {
    const peerConnection = this.peers.get(userId);
    if (peerConnection) {
      peerConnection.peer.signal(answer);
    }
  }

  private handleIceCandidate(userId: string, candidate: any): void {
    const peerConnection = this.peers.get(userId);
    if (peerConnection) {
      peerConnection.peer.signal(candidate);
    }
  }

  private removePeer(userId: string): void {
    const peerConnection = this.peers.get(userId);
    if (peerConnection) {
      peerConnection.peer.destroy();
      this.peers.delete(userId);
      this.onPeerLeft?.(userId);
    }
  }

  // Public methods
  getLocalStream(): MediaStream | undefined {
    return this.localStream;
  }

  getPeers(): PeerConnection[] {
    return Array.from(this.peers.values());
  }

  toggleAudio(enabled: boolean): void {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
      }
    }
  }

  toggleVideo(enabled: boolean): void {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
      }
    }
  }

  async shareScreen(): Promise<MediaStream | null> {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      // Replace video track in all peer connections
      this.peers.forEach((peerConnection) => {
        const videoTrack = screenStream.getVideoTracks()[0];
        if (videoTrack) {
          const peer = peerConnection.peer as any;
          if (peer._pc) {
            const sender = peer._pc.getSenders().find((s: any) =>
              s.track && s.track.kind === 'video'
            );
            if (sender) {
              sender.replaceTrack(videoTrack);
            }
          }
        }
      });

      return screenStream;
    } catch (error) {
      console.error('Error sharing screen:', error);
      return null;
    }
  }

  disconnect(): void {
    this.peers.forEach((peerConnection) => {
      peerConnection.peer.destroy();
    });
    this.peers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }

    if (this.socket) {
      this.socket.close();
    }
  }

  // Event callbacks
  onRemoteStream?: (userId: string, stream: MediaStream) => void;
  onPeerLeft?: (userId: string) => void;
}

// Default configuration
export const defaultWebRTCConfig: WebRTCConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  signalingServer: 'ws://localhost:3001'
};

// Singleton instance
export const webrtcService = new WebRTCService(defaultWebRTCConfig);
