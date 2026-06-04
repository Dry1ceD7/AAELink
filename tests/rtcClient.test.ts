/**
 * Unit tests for lib/calls/rtcClient.ts — the framework-agnostic mesh client.
 *
 * The client's side-effects are all injected, so we drive it with a fake
 * RTCPeerConnection factory and a scripted signaling API. Vitest fake timers
 * advance the setTimeout-chained poll loop deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HuddleRtcClient, type RtcPeerConnectionLike, type RtcMeshApi } from '@/lib/calls/rtcClient'
import type { CallSignal, RoomParticipant } from '@/lib/calls/signaling'

// ── Fakes ──────────────────────────────────────────────────────────────────

class FakeTrack {
  constructor(public kind: 'audio' | 'video', public enabled = true) {}
  stop = vi.fn()
}

class FakeStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getTracks() { return this.tracks }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video') }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio') }
}

class FakeSender {
  replaceTrack = vi.fn(async (t: MediaStreamTrack | null) => { this.track = t })
  constructor(public track: MediaStreamTrack | null) {}
}

let pcSeq = 0

class FakePc implements RtcPeerConnectionLike {
  id = ++pcSeq
  signalingState: RTCSignalingState = 'stable'
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  onicecandidate: RtcPeerConnectionLike['onicecandidate'] = null
  ontrack: RtcPeerConnectionLike['ontrack'] = null
  onnegotiationneeded: RtcPeerConnectionLike['onnegotiationneeded'] = null
  onconnectionstatechange: RtcPeerConnectionLike['onconnectionstatechange'] = null

  senders: FakeSender[] = []
  transceivers: Array<{ kind: string; direction?: string }> = []
  addTrack = vi.fn((track: MediaStreamTrack) => {
    const sender = new FakeSender(track)
    this.senders.push(sender)
    // A real PC fires negotiationneeded asynchronously after addTrack.
    queueMicrotask(() => { this.onnegotiationneeded?.({}) })
    return sender
  })
  addTransceiver = vi.fn((kind: string, init?: { direction?: string }) => {
    this.transceivers.push({ kind, direction: init?.direction })
    return {}
  })
  getSenders() { return this.senders }

  createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'offer', sdp: `offer-${this.id}` }))
  createAnswer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'answer', sdp: `answer-${this.id}` }))
  setLocalDescription = vi.fn(async (desc?: RTCSessionDescriptionInit) => {
    this.localDescription = desc ?? { type: 'offer', sdp: `local-${this.id}` }
    this.signalingState = desc?.type === 'offer' ? 'have-local-offer' : 'stable'
  })
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable'
  })
  addIceCandidate = vi.fn(async () => {})
  close = vi.fn(() => { this.connectionState = 'closed' })
}

function makeParticipant(user_id: string): RoomParticipant {
  return { user_id, role: 'participant', muted: false, video_on: true, screen_sharing: false, joined_at: Date.now() }
}

let signalSeq = 0
function makeSignal(partial: Partial<CallSignal> & Pick<CallSignal, 'from_user' | 'kind'>): CallSignal {
  return {
    seq: ++signalSeq,
    id: `sig-${signalSeq}`,
    to_user: '',
    payload: {},
    created_at: Date.now(),
    ...partial,
  }
}

/** Scripted API: each poll() call dequeues the next scripted response. */
function scriptedApi(script: Array<{ signals: CallSignal[]; participants: RoomParticipant[] }>): {
  api: RtcMeshApi
  sent: Array<{ toUser: string; kind: string; payload: unknown }>
  fetchIce: ReturnType<typeof vi.fn>
  pollCalls: number[]
} {
  const sent: Array<{ toUser: string; kind: string; payload: unknown }> = []
  const pollCalls: number[] = []
  let i = 0
  const fetchIce = vi.fn(async () => ({ ice_servers: [{ urls: 'stun:stun.example' }] as RTCIceServer[] }))
  const api: RtcMeshApi = {
    fetchIce,
    poll: vi.fn(async (after: number) => {
      pollCalls.push(after)
      const step = script[i] ?? { signals: [], participants: script[script.length - 1]?.participants ?? [] }
      i++
      const cursor = step.signals.length ? step.signals[step.signals.length - 1].seq : after
      return { signals: step.signals, cursor, participants: step.participants }
    }),
    send: vi.fn(async (toUser: string, kind: string, payload: unknown) => { sent.push({ toUser, kind, payload }) }),
  }
  return { api, sent, fetchIce, pollCalls }
}

let createdPcs: FakePc[] = []
function pcFactory() {
  return (_config: { iceServers: RTCIceServer[] }): RtcPeerConnectionLike => {
    const pc = new FakePc()
    createdPcs.push(pc)
    return pc
  }
}

const SELF = 'm-self'           // mid-range id
const LOW = 'a-low'             // sorts before SELF → SELF is impolite-from-LOW? compare below
const HIGH = 'z-high'           // sorts after SELF

beforeEach(() => {
  vi.useFakeTimers()
  createdPcs = []
  pcSeq = 0
  signalSeq = 0
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('HuddleRtcClient — startup + ICE', () => {
  it('fetches ICE exactly once on start', async () => {
    const { api, fetchIce } = scriptedApi([{ signals: [], participants: [makeParticipant(SELF)] }])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r1', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100,
      callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchIce).toHaveBeenCalledTimes(1)
    await client.stop()
  })
})

describe('HuddleRtcClient — initial offer side correctness', () => {
  it('the impolite (lower id) peer creates the initial offer; the polite peer does not', async () => {
    // SELF vs HIGH: SELF < HIGH ⇒ SELF initiates.
    const a = scriptedApi([{ signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }])
    const initiator = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api: a.api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await initiator.start(new FakeStream([new FakeTrack('audio')]) as unknown as MediaStream)
    await vi.advanceTimersByTimeAsync(0)
    expect(createdPcs).toHaveLength(1)
    expect(createdPcs[0].createOffer).toHaveBeenCalledTimes(1)
    expect(a.sent.some(s => s.kind === 'offer' && s.toUser === HIGH)).toBe(true)
    await initiator.stop()

    // Reset and test the polite side: SELF vs LOW where SELF > LOW ⇒ SELF does NOT initiate.
    createdPcs = []
    const b = scriptedApi([{ signals: [], participants: [makeParticipant(SELF), makeParticipant(LOW)] }])
    const responder = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api: b.api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await responder.start(new FakeStream([new FakeTrack('audio')]) as unknown as MediaStream)
    await vi.advanceTimersByTimeAsync(0)
    expect(createdPcs).toHaveLength(1)
    expect(createdPcs[0].createOffer).not.toHaveBeenCalled()
    expect(b.sent.some(s => s.kind === 'offer')).toBe(false)
    await responder.stop()
  })

  it('adds local tracks to each new peer connection', async () => {
    const { api } = scriptedApi([{ signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]) as unknown as MediaStream)
    await vi.advanceTimersByTimeAsync(0)
    expect(createdPcs[0].addTrack).toHaveBeenCalledTimes(2)
    await client.stop()
  })

  it('the initiator sends exactly one offer even when addTrack fires negotiationneeded', async () => {
    // FakePc.addTrack now fires negotiationneeded async (as a real PC does). The
    // makingOffer/signalingState guard must collapse the manual kick + the two
    // addTrack-driven events into a single offer.
    const a = scriptedApi([{ signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api: a.api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]) as unknown as MediaStream)
    await vi.advanceTimersByTimeAsync(0)
    expect(createdPcs[0].createOffer).toHaveBeenCalledTimes(1)
    expect(a.sent.filter(s => s.kind === 'offer' && s.toUser === HIGH)).toHaveLength(1)
    await client.stop()
  })

  it('the polite side sends no initial offer even when its addTrack fires negotiationneeded', async () => {
    // SELF > LOW ⇒ polite, non-initiator. Its addTrack fires negotiationneeded too,
    // but the non-initiator must not open an offer before the connection is up.
    const b = scriptedApi([{ signals: [], participants: [makeParticipant(SELF), makeParticipant(LOW)] }])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api: b.api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]) as unknown as MediaStream)
    await vi.advanceTimersByTimeAsync(0)
    expect(createdPcs[0].createOffer).not.toHaveBeenCalled()
    expect(b.sent.some(s => s.kind === 'offer')).toBe(false)
    await client.stop()
  })

  it('adds recvonly transceivers for the listen-only (no local media) joiner', async () => {
    const { api } = scriptedApi([{ signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(null) // listen-only: no local stream
    await vi.advanceTimersByTimeAsync(0)
    const pc = createdPcs[0]
    expect(pc.addTransceiver).toHaveBeenCalledWith('audio', { direction: 'recvonly' })
    expect(pc.addTransceiver).toHaveBeenCalledWith('video', { direction: 'recvonly' })
    await client.stop()
  })

  it('does not add a recvonly transceiver for a kind that already has a local track', async () => {
    const { api } = scriptedApi([{ signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    // Audio-only local stream → audio is sent, only video needs a recvonly line.
    await client.start(new FakeStream([new FakeTrack('audio')]) as unknown as MediaStream)
    await vi.advanceTimersByTimeAsync(0)
    const pc = createdPcs[0]
    expect(pc.transceivers.map(t => t.kind)).toEqual(['video'])
    await client.stop()
  })
})

describe('HuddleRtcClient — perfect negotiation glare', () => {
  it('polite peer accepts a colliding offer (rollback via setRemoteDescription) and answers', async () => {
    // SELF is polite vs HIGH? No: SELF > LOW so SELF is polite vs LOW, but SELF
    // initiates only when impolite. To drive a genuine collision on the POLITE
    // side we use SELF vs HIGH (SELF impolite → would ignore) is wrong; instead we
    // manufacture an in-progress local offer on the polite peer, then deliver a
    // colliding remote offer in a later poll.
    //   Poll 1 (SELF vs LOW): SELF is polite, does NOT initiate → stable, no offer.
    //   We then put the pc into have-local-offer to simulate a local offer in
    //   flight, and Poll 2 delivers LOW's offer → collision. Polite ⇒ accept.
    const offerFromLow = makeSignal({ from_user: LOW, kind: 'offer', payload: { type: 'offer', sdp: 'remote' } })
    const { api, sent } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(LOW)] },          // poll 1: add LOW (polite, no offer)
      { signals: [offerFromLow], participants: [makeParticipant(SELF), makeParticipant(LOW)] }, // poll 2: colliding offer
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)
    const pc = createdPcs[0]
    expect(pc.createOffer).not.toHaveBeenCalled() // polite peer did not initiate
    // Simulate a local offer already in flight → forces a collision on poll 2.
    pc.signalingState = 'have-local-offer'
    await vi.advanceTimersByTimeAsync(100) // poll 2 delivers the colliding offer
    // Polite peer accepts despite the collision: setRemoteDescription (implicit
    // rollback) then an answer is produced + sent.
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'remote' })
    expect(pc.createAnswer).toHaveBeenCalled()
    expect(sent.some(s => s.kind === 'answer' && s.toUser === LOW)).toBe(true)
    await client.stop()
  })

  it('impolite peer ignores a colliding offer (no answer sent, own offer preserved)', async () => {
    // SELF vs HIGH: SELF < HIGH ⇒ SELF is impolite AND initiates. After the
    // initial offer it is in have-local-offer; a colliding remote offer must be
    // ignored (no setRemoteDescription, no answer).
    const offerFromHigh = makeSignal({ from_user: HIGH, kind: 'offer', payload: { type: 'offer', sdp: 'remote' } })
    const { api, sent } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] },           // poll 1: add HIGH + initiate offer
      { signals: [offerFromHigh], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }, // poll 2: colliding offer
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)
    const pc = createdPcs[0]
    expect(pc.createOffer).toHaveBeenCalledTimes(1) // impolite peer initiated
    expect(pc.signalingState).toBe('have-local-offer')
    await vi.advanceTimersByTimeAsync(100) // poll 2 delivers the colliding offer
    // Impolite peer ignores: no remote-offer applied, no answer.
    expect(pc.setRemoteDescription).not.toHaveBeenCalled()
    expect(sent.some(s => s.kind === 'answer')).toBe(false)
    await client.stop()
  })
})

describe('HuddleRtcClient — inbound offer creates a peer (handleSignal path)', () => {
  it('an offer from an untracked peer is answered, not met with a competing offer (impolite self)', async () => {
    // SELF < HIGH ⇒ SELF would normally initiate. But the offer arrived first, so
    // the peer is created with initiate=false: we must ANSWER, never open our own
    // offer (which we would then ignore as a collision — the Finding 2 bug).
    const offerFromHigh = makeSignal({ from_user: HIGH, kind: 'offer', payload: { type: 'offer', sdp: 'remote' } })
    // Participants list HIGH is NOT yet visible to reconcile() (HIGH polled us
    // before we polled it), so the peer is created purely from the inbound offer.
    const { api, sent } = scriptedApi([
      { signals: [offerFromHigh], participants: [makeParticipant(SELF)] },
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)
    const pc = createdPcs[0]
    // The inbound offer was applied and answered.
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'remote' })
    expect(sent.some(s => s.kind === 'answer' && s.toUser === HIGH)).toBe(true)
    // The incoming offer was NOT ignored, and no self-initiated offer was sent.
    expect(sent.some(s => s.kind === 'offer')).toBe(false)
    await client.stop()
  })
})

describe('HuddleRtcClient — ICE candidate handling', () => {
  it('swallows addIceCandidate errors for an ignored offer; surfaces them otherwise', async () => {
    const onError = vi.fn()
    // SELF vs HIGH (SELF impolite + initiates). Poll 1 adds HIGH + initiates offer.
    // Poll 2 delivers HIGH's colliding offer (ignored) then an ICE candidate that
    // fails to add — the failure must be swallowed because the offer was ignored.
    const offerFromHigh = makeSignal({ from_user: HIGH, kind: 'offer', payload: { type: 'offer', sdp: 'r' } })
    const iceFromHigh = makeSignal({ from_user: HIGH, kind: 'ice', payload: { candidate: 'c' } })
    const { api } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] },
      { signals: [offerFromHigh, iceFromHigh], participants: [makeParticipant(SELF), makeParticipant(HIGH)] },
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn(), onError },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)
    const pc = createdPcs[0]
    expect(pc.signalingState).toBe('have-local-offer') // own offer in flight → next offer collides
    pc.addIceCandidate.mockRejectedValueOnce(new Error('no remote description'))
    await vi.advanceTimersByTimeAsync(100) // poll 2: offer ignored, ice error swallowed
    expect(pc.addIceCandidate).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    await client.stop()
  })

  it('un-stickies ignoreOffer after the round settles, so later ICE failures surface', async () => {
    // Reproduce a collision (ignoreOffer=true), then settle the negotiation via our
    // own offer being answered (no subsequent inbound offer to reset the flag), then
    // deliver an ICE candidate that fails — it must now be surfaced (Finding 4).
    const onError = vi.fn()
    const offerFromHigh = makeSignal({ from_user: HIGH, kind: 'offer', payload: { type: 'offer', sdp: 'r' } })
    const answerFromHigh = makeSignal({ from_user: HIGH, kind: 'answer', payload: { type: 'answer', sdp: 'a' } })
    const iceFromHigh = makeSignal({ from_user: HIGH, kind: 'ice', payload: { candidate: 'c' } })
    const { api } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] },              // poll 1: initiate offer
      { signals: [offerFromHigh], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }, // poll 2: collision → ignoreOffer=true
      { signals: [answerFromHigh], participants: [makeParticipant(SELF), makeParticipant(HIGH)] },// poll 3: our offer answered → reset flag
      { signals: [iceFromHigh], participants: [makeParticipant(SELF), makeParticipant(HIGH)] },   // poll 4: ICE fails → must surface
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn(), onError },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)   // poll 1
    await vi.advanceTimersByTimeAsync(100) // poll 2: ignoreOffer set
    await vi.advanceTimersByTimeAsync(100) // poll 3: answer applied → ignoreOffer cleared
    const pc = createdPcs[0]
    pc.addIceCandidate.mockRejectedValueOnce(new Error('genuine ice failure'))
    await vi.advanceTimersByTimeAsync(100) // poll 4: ICE fails and is surfaced
    expect(onError).toHaveBeenCalled()
    await client.stop()
  })
})

describe('HuddleRtcClient — peer departure + bye', () => {
  it("'bye' signal closes that peer and notifies null stream", async () => {
    const onRemoteStream = vi.fn()
    const bye = makeSignal({ from_user: HIGH, kind: 'bye' })
    const { api } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }, // poll 1: add HIGH
      { signals: [bye], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }, // poll 2: bye
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream, onParticipants: vi.fn() },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)   // poll 1
    expect(createdPcs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100) // poll 2 → bye
    expect(createdPcs[0].close).toHaveBeenCalled()
    expect(onRemoteStream).toHaveBeenCalledWith(HIGH, null)
    await client.stop()
  })

  it('participant departure (gone from poll) closes the peer', async () => {
    const onRemoteStream = vi.fn()
    const { api } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] }, // HIGH present
      { signals: [], participants: [makeParticipant(SELF)] },                        // HIGH gone
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream, onParticipants: vi.fn() },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(createdPcs[0].close).toHaveBeenCalled()
    expect(onRemoteStream).toHaveBeenCalledWith(HIGH, null)
    await client.stop()
  })
})

describe('HuddleRtcClient — poll loop guard', () => {
  it('never runs two concurrent polls (in-flight guard)', async () => {
    const resolvers: Array<() => void> = []
    let concurrent = 0
    let maxConcurrent = 0
    const api: RtcMeshApi = {
      fetchIce: vi.fn(async () => ({ ice_servers: [] as RTCIceServer[] })),
      poll: vi.fn(async (after: number) => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise<void>(res => { resolvers.push(res) })
        concurrent--
        return { signals: [], cursor: after, participants: [] }
      }),
      send: vi.fn(async () => {}),
    }
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 50, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)
    // First poll is now hanging. Advancing the timer further must NOT start a second.
    await vi.advanceTimersByTimeAsync(200)
    expect(maxConcurrent).toBe(1)
    expect(api.poll).toHaveBeenCalledTimes(1)
    // Release and let the chain continue.
    resolvers.forEach(r => r())
    await vi.advanceTimersByTimeAsync(50)
    expect((api.poll as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
    await client.stop()
  })
})

describe('HuddleRtcClient — replaceVideoTrack', () => {
  it('replaces the video track on every peer sender', async () => {
    const { api } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH), makeParticipant('z2-high')] },
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]) as unknown as MediaStream)
    await vi.advanceTimersByTimeAsync(0)
    expect(createdPcs).toHaveLength(2)

    const screenTrack = new FakeTrack('video') as unknown as MediaStreamTrack
    await client.replaceVideoTrack(screenTrack)

    for (const pc of createdPcs) {
      const videoSender = pc.getSenders().find(s => (s.track as unknown as FakeTrack)?.kind === 'video')
      expect(videoSender?.replaceTrack).toHaveBeenCalledWith(screenTrack)
    }
    await client.stop()
  })

  it('adds a new sender when no video sender exists (listen-only screen share)', async () => {
    // Listen-only join: no local stream ⇒ no senders. Sharing the screen must
    // CREATE a sender via addTrack so media is actually transmitted, not silently
    // dropped (Finding 3).
    const { api } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] },
    ])
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(null)
    await vi.advanceTimersByTimeAsync(0)
    const pc = createdPcs[0]
    expect(pc.getSenders()).toHaveLength(0)
    const screenTrack = new FakeTrack('video') as unknown as MediaStreamTrack
    await client.replaceVideoTrack(screenTrack)
    expect(pc.addTrack).toHaveBeenCalledWith(screenTrack)
    expect(pc.getSenders().some(s => (s.track as unknown as FakeTrack)?.kind === 'video')).toBe(true)
    await client.stop()
  })
})

describe('HuddleRtcClient — stop()', () => {
  it('broadcasts bye, stops polling, and closes all peers without stopping local tracks', async () => {
    const { api, sent } = scriptedApi([
      { signals: [], participants: [makeParticipant(SELF), makeParticipant(HIGH)] },
    ])
    const localTrack = new FakeTrack('audio')
    const client = new HuddleRtcClient({
      selfId: SELF, roomId: 'r', api, createPeerConnection: pcFactory(),
      pollIntervalMs: 100, callbacks: { onRemoteStream: vi.fn(), onParticipants: vi.fn() },
    })
    await client.start(new FakeStream([localTrack]) as unknown as MediaStream)
    await vi.advanceTimersByTimeAsync(0)
    const pollsBefore = (api.poll as ReturnType<typeof vi.fn>).mock.calls.length

    await client.stop()
    expect(sent.some(s => s.kind === 'bye' && s.toUser === '')).toBe(true)
    expect(createdPcs[0].close).toHaveBeenCalled()
    // Local tracks are owned by the caller — never stopped by the client.
    expect(localTrack.stop).not.toHaveBeenCalled()
    // No further polls after stop.
    await vi.advanceTimersByTimeAsync(500)
    expect((api.poll as ReturnType<typeof vi.fn>).mock.calls.length).toBe(pollsBefore)
  })
})
