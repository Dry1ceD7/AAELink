/**
 * D5 Calls — framework-agnostic WebRTC mesh client.
 *
 * Drives a full-mesh huddle on top of the server signaling relay
 * (app/api/calls/[roomId]/signals) using MDN's "perfect negotiation" pattern per
 * peer. Every side-effect — ICE fetch, signal poll/send, peer-connection
 * construction, media-stream callbacks — is injected through the constructor so a
 * vitest suite can drive the whole state machine with fakes and zero browser
 * globals. The React layer (components/workspace/useHuddleRtc.ts) supplies the
 * real browser implementations.
 *
 * Lifecycle:
 *   start(localStream) → fetch ICE once, then a setTimeout-chained poll loop with
 *     an in-flight guard (never two concurrent polls). Each tick reconciles the
 *     active-participant set into per-peer connections, then applies queued
 *     signals in seq order.
 *   stop() → broadcast a 'bye', halt the loop, and close every peer connection.
 *     Local tracks are owned by the caller and are NOT stopped here.
 *
 * Topology + negotiation roles live in lib/calls/rtcMesh.ts (pure); this file is
 * the imperative shell that wires them to the injected effects.
 */
import { isPolite, shouldInitiateOffer, reconcilePeers } from './rtcMesh'
import type { CallSignal, RoomParticipant } from './signaling'

/**
 * Structural subset of RTCPeerConnection the client touches. Defined as an
 * interface (not the lib.dom type directly) so test fakes implement only what is
 * exercised, and so the client never assumes a real browser PC.
 */
/** A sender we can swap the outgoing track on. */
export interface RtcSenderLike {
  track: MediaStreamTrack | null
  replaceTrack(t: MediaStreamTrack | null): Promise<void>
}

/**
 * The event-handler property types are intentionally widened to `(ev: any) =>
 * any` so a real lib.dom `RTCPeerConnection` is structurally assignable to this
 * interface (its handlers carry the full DOM event types). The client only reads
 * `ev.candidate` / `ev.streams`, both present on the real events and on the test
 * fakes.
 */
export interface RtcPeerConnectionLike {
  signalingState: RTCSignalingState
  connectionState: RTCPeerConnectionState
  localDescription: RTCSessionDescriptionInit | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onicecandidate: ((ev: any) => any) | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ontrack: ((ev: any) => any) | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onnegotiationneeded: ((ev: any) => any) | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onconnectionstatechange: ((ev: any) => any) | null
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): unknown
  addTransceiver(trackOrKind: string, init?: { direction?: RTCRtpTransceiverDirection }): unknown
  getSenders(): RtcSenderLike[]
  createOffer(): Promise<RTCSessionDescriptionInit>
  createAnswer(): Promise<RTCSessionDescriptionInit>
  setLocalDescription(desc?: RTCSessionDescriptionInit): Promise<void>
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>
  close(): void
}

export interface RtcMeshApi {
  /** GET /api/calls/ice — fresh ICE servers (TURN creds are short-lived). */
  fetchIce(): Promise<{ ice_servers: RTCIceServer[] }>
  /** GET /api/calls/:roomId/signals?after= — poll for signals + participants. */
  poll(after: number): Promise<{ signals: CallSignal[]; cursor: number; participants: RoomParticipant[] }>
  /** POST /api/calls/:roomId/signals — relay a signal ('' toUser = broadcast). */
  send(toUser: string, kind: CallSignal['kind'], payload: unknown): Promise<void>
}

export interface HuddleRtcDeps {
  selfId: string
  roomId: string
  api: RtcMeshApi
  /** Construct a peer connection from the fetched ICE config. */
  createPeerConnection(config: { iceServers: RTCIceServer[] }): RtcPeerConnectionLike
  pollIntervalMs?: number
  callbacks: {
    onRemoteStream(peerId: string, stream: MediaStream | null): void
    onParticipants(participants: RoomParticipant[]): void
    onError?(err: unknown): void
  }
}

/** Per-peer perfect-negotiation state. */
interface PeerEntry {
  pc: RtcPeerConnectionLike
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  /** True once the connection has reached 'connected' at least once. The
   *  non-initiator only auto-opens offers (renegotiation) after this, never for
   *  the initial connect — the initiator owns the first offer. */
  connected: boolean
}

const DEFAULT_POLL_MS = 1200

export class HuddleRtcClient {
  private readonly selfId: string
  private readonly roomId: string
  private readonly api: RtcMeshApi
  private readonly createPc: (config: { iceServers: RTCIceServer[] }) => RtcPeerConnectionLike
  private readonly pollIntervalMs: number
  private readonly cb: HuddleRtcDeps['callbacks']

  private peers = new Map<string, PeerEntry>()
  private localStream: MediaStream | null = null
  private iceServers: RTCIceServer[] = []
  private cursor = 0

  private running = false
  private polling = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: HuddleRtcDeps) {
    this.selfId = deps.selfId
    this.roomId = deps.roomId
    this.api = deps.api
    this.createPc = deps.createPeerConnection
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS
    this.cb = deps.callbacks
  }

  /** Fetch ICE once, then begin the poll loop. */
  async start(localStream: MediaStream | null): Promise<void> {
    if (this.running) return
    this.running = true
    this.localStream = localStream
    try {
      const ice = await this.api.fetchIce()
      this.iceServers = ice.ice_servers ?? []
    } catch (err) {
      this.cb.onError?.(err)
      this.iceServers = []
    }
    void this.pollOnce()
  }

  /** Broadcast bye, stop polling, and close all peers. Local tracks are NOT stopped. */
  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null }
    try { await this.api.send('', 'bye', {}) } catch (err) { this.cb.onError?.(err) }
    for (const [peerId] of this.peers) this.closePeer(peerId)
    this.peers.clear()
  }

  /**
   * Swap the outgoing video track on every peer (screen-share / camera switch).
   * If a peer has no video sender yet (e.g. the joiner started listen-only), add a
   * fresh track so a sender + m-line is negotiated rather than silently dropping
   * the share. addTrack fires negotiationneeded, which renegotiates the connection.
   */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    for (const { pc } of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track === null ? false : s.track.kind === 'video')
      const target = sender ?? pc.getSenders().find((s) => s.track === null)
      if (target) {
        try { await target.replaceTrack(track) } catch (err) { this.cb.onError?.(err) }
      } else if (track) {
        // No sender to swap onto — create one so the new media is actually sent.
        try { pc.addTrack(track) } catch (err) { this.cb.onError?.(err) }
      }
    }
  }

  // ── Poll loop ──────────────────────────────────────────────────────────

  /** Schedule the next poll, never overlapping the in-flight one. */
  private scheduleNext(): void {
    if (!this.running) return
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => { void this.pollOnce() }, this.pollIntervalMs)
  }

  /** One poll tick: reconcile peers, then apply signals in seq order. */
  private async pollOnce(): Promise<void> {
    if (!this.running || this.polling) return
    this.polling = true
    try {
      const { signals, cursor, participants } = await this.api.poll(this.cursor)
      this.cursor = cursor
      this.cb.onParticipants(participants)
      this.reconcile(participants)
      for (const sig of signals) {
        await this.handleSignal(sig)
      }
    } catch (err) {
      this.cb.onError?.(err)
    } finally {
      this.polling = false
      this.scheduleNext()
    }
  }

  // ── Peer lifecycle ───────────────────────────────────────────────────────

  private reconcile(participants: RoomParticipant[]): void {
    const ids = participants.map((p) => p.user_id)
    const { toAdd, toRemove } = reconcilePeers(this.selfId, ids, [...this.peers.keys()])
    for (const peerId of toAdd) this.addPeer(peerId)
    for (const peerId of toRemove) this.closePeer(peerId)
  }

  /**
   * @param initiate Whether this side may open the initial offer. Suppressed when
   *   addPeer is called in response to an inbound offer (handleSignal): the remote
   *   is already negotiating, so we answer rather than open a competing offer.
   */
  private addPeer(peerId: string, initiate = true): void {
    if (this.peers.has(peerId)) return
    const pc = this.createPc({ iceServers: this.iceServers })
    const entry: PeerEntry = { pc, polite: isPolite(this.selfId, peerId), makingOffer: false, ignoreOffer: false, connected: false }
    this.peers.set(peerId, entry)

    const haveAudio = !!this.localStream?.getAudioTracks().length
    const haveVideo = !!this.localStream?.getVideoTracks().length
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream)
    }
    // Without any sendable track of a kind, add a recvonly transceiver so the SDP
    // still carries an m-line and inbound media is negotiated (listen-only join).
    if (!haveAudio) { try { pc.addTransceiver('audio', { direction: 'recvonly' }) } catch { /* fake/older PC */ } }
    if (!haveVideo) { try { pc.addTransceiver('video', { direction: 'recvonly' }) } catch { /* fake/older PC */ } }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) void this.safeSend(peerId, 'ice', ev.candidate)
    }
    pc.ontrack = (ev) => {
      this.cb.onRemoteStream(peerId, ev.streams[0] ?? null)
    }
    // negotiationneeded fires async after addTrack on a real PC, on BOTH sides.
    // It is the renegotiation path (e.g. screen-share addTrack later). The INITIAL
    // offer is owned solely by the initiator's explicit kick below, so we suppress
    // the event-driven first offer: the non-initiator never opens it, and the
    // initiator's duplicate (from its own addTrack) is dropped by the makingOffer /
    // signalingState guard in onNegotiationNeeded.
    pc.onnegotiationneeded = () => {
      // Until connected, only the initiator opens the (single) initial offer; the
      // guard in onNegotiationNeeded then de-dups its own addTrack-driven event.
      if (!entry.connected && !shouldInitiateOffer(this.selfId, peerId)) return
      void this.onNegotiationNeeded(peerId, entry)
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // Drop the failed peer; the next poll re-adds it and renegotiates fresh.
        this.closePeer(peerId)
      } else if (pc.connectionState === 'connected') {
        entry.connected = true
        // Negotiation settled — clear any stale ignore flag from a past collision
        // so genuine ICE failures are no longer swallowed.
        entry.ignoreOffer = false
      }
    }

    // Exactly one side opens the initial offer, and only when not answering an
    // inbound offer (initiate=false from handleSignal). Relies on the guard in
    // onNegotiationNeeded for de-dup against the addTrack-driven event on a real PC.
    if (initiate && shouldInitiateOffer(this.selfId, peerId)) {
      void this.onNegotiationNeeded(peerId, entry)
    }
  }

  private closePeer(peerId: string): void {
    const entry = this.peers.get(peerId)
    if (!entry) return
    // Detach handlers so an already-queued event (e.g. onicecandidate) cannot
    // fire after teardown and signal a peer that no longer exists.
    entry.pc.onicecandidate = null
    entry.pc.ontrack = null
    entry.pc.onnegotiationneeded = null
    entry.pc.onconnectionstatechange = null
    try { entry.pc.close() } catch { /* already closed */ }
    this.peers.delete(peerId)
    this.cb.onRemoteStream(peerId, null)
  }

  // ── Perfect negotiation (per MDN) ────────────────────────────────────────

  private async onNegotiationNeeded(peerId: string, entry: PeerEntry): Promise<void> {
    // Guard against re-entry: addTrack on a real PC schedules a second
    // negotiationneeded event after the manual initial kick, and renegotiation can
    // race an in-flight offer. Only ever open an offer from a stable, idle state.
    if (entry.makingOffer || entry.pc.signalingState !== 'stable') return
    try {
      entry.makingOffer = true
      const offer = await entry.pc.createOffer()
      await entry.pc.setLocalDescription(offer)
      await this.safeSend(peerId, 'offer', entry.pc.localDescription ?? offer)
    } catch (err) {
      this.cb.onError?.(err)
    } finally {
      entry.makingOffer = false
    }
  }

  private async handleSignal(sig: CallSignal): Promise<void> {
    const peerId = sig.from_user
    if (sig.kind === 'bye') { this.closePeer(peerId); return }

    let entry = this.peers.get(peerId)
    if (!entry) {
      // A peer we don't yet track is negotiating with us (e.g. it polled us
      // before we polled it). Create the connection so we can answer — but do NOT
      // self-initiate a competing offer: the inbound signal means the remote is
      // already negotiating; we answer it.
      this.addPeer(peerId, false)
      entry = this.peers.get(peerId)
      if (!entry) return
    }
    const { pc } = entry

    try {
      if (sig.kind === 'offer') {
        const offer = sig.payload as RTCSessionDescriptionInit
        const collision = entry.makingOffer || pc.signalingState !== 'stable'
        entry.ignoreOffer = !entry.polite && collision
        if (entry.ignoreOffer) return
        // Polite peer accepts even on collision — setRemoteDescription performs
        // implicit rollback of any in-progress local offer.
        await pc.setRemoteDescription(offer)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await this.safeSend(peerId, 'answer', pc.localDescription ?? answer)
        // This negotiation round was accepted, not ignored — clear the flag so a
        // later ICE failure on this peer is surfaced rather than swallowed.
        entry.ignoreOffer = false
      } else if (sig.kind === 'answer') {
        await pc.setRemoteDescription(sig.payload as RTCSessionDescriptionInit)
        // Our own offer was answered; the round is settled and not ignored.
        entry.ignoreOffer = false
      } else if (sig.kind === 'ice') {
        try {
          await pc.addIceCandidate(sig.payload as RTCIceCandidateInit)
        } catch (err) {
          // Swallow when we deliberately ignored the offer this candidate belongs
          // to; otherwise surface it.
          if (!entry.ignoreOffer) this.cb.onError?.(err)
        }
      }
    } catch (err) {
      this.cb.onError?.(err)
    }
  }

  private async safeSend(toUser: string, kind: CallSignal['kind'], payload: unknown): Promise<void> {
    try { await this.api.send(toUser, kind, payload) } catch (err) { this.cb.onError?.(err) }
  }
}
