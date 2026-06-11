/**
 * D5 Calls — WebRTC signaling relay.
 *
 * Peers in a call room exchange SDP offers/answers and ICE candidates through
 * the server (the signaling channel) before the media connection forms directly
 * (via TURN/STUN). The call control plane (rooms, participants) already existed;
 * this is the missing relay.
 *
 * A signal is addressed to one peer (to_user) or broadcast (to_user = ''). A
 * monotonic `seq` is the poll cursor: a client fetches signals for itself with
 * seq greater than its last cursor. Only active participants of the room may
 * post or fetch.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export type SignalKind = 'offer' | 'answer' | 'ice' | 'bye'
export const SIGNAL_KINDS: SignalKind[] = ['offer', 'answer', 'ice', 'bye']

export function isSignalKind(v: string): v is SignalKind {
  return (SIGNAL_KINDS as string[]).includes(v)
}

/** Whether the user is currently an active (not-left) participant of the room. */
async function isActiveParticipant(pool: Pool, roomId: string, uid: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM aaelink.call_participants
      WHERE room_id = $1 AND user_id = $2 AND left_at = 0 LIMIT 1`,
    [roomId, uid]
  )
  return rows.length > 0
}

export type PostSignalResult =
  | { ok: true; seq: number; id: string }
  | { ok: false; code: 'room_not_active' | 'not_participant' | 'invalid_kind' }

/**
 * Relay a signal from the caller to one peer (toUser) or all peers (toUser='').
 * The caller must be an active participant of an active room.
 */
export async function postSignal(
  pool: Pool,
  roomId: string,
  fromUid: string,
  toUser: string,
  kind: string,
  payload: unknown
): Promise<PostSignalResult> {
  if (!isSignalKind(kind)) return { ok: false, code: 'invalid_kind' }

  const { rows: room } = await pool.query<{ status: string }>(
    `SELECT status FROM aaelink.call_rooms WHERE id = $1`,
    [roomId]
  )
  if (!room[0] || room[0].status !== 'active') return { ok: false, code: 'room_not_active' }
  if (!(await isActiveParticipant(pool, roomId, fromUid))) return { ok: false, code: 'not_participant' }

  const id = randomUUID()
  const { rows } = await pool.query<{ seq: string }>(
    `INSERT INTO aaelink.call_signals (id, room_id, from_user, to_user, kind, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING seq::text AS seq`,
    [id, roomId, fromUid, String(toUser || ''), kind, JSON.stringify(payload ?? {}), Date.now()]
  )
  return { ok: true, seq: Number(rows[0].seq), id }
}

export interface CallSignal {
  seq: number
  id: string
  from_user: string
  to_user: string
  kind: SignalKind
  payload: unknown
  created_at: number
}

export type FetchSignalsResult =
  | { ok: true; signals: CallSignal[]; cursor: number }
  | { ok: false; code: 'not_participant' }

/**
 * Fetch signals addressed to the caller (direct or broadcast) in a room with
 * seq greater than `afterSeq`, oldest-first. Excludes the caller's own signals.
 * Returns a new cursor (the max seq seen, or the prior cursor when empty).
 */
export async function fetchSignals(
  pool: Pool,
  roomId: string,
  uid: string,
  afterSeq = 0,
  limit = 200
): Promise<FetchSignalsResult> {
  if (!(await isActiveParticipant(pool, roomId, uid))) return { ok: false, code: 'not_participant' }

  const capped = Math.min(Math.max(limit, 1), 500)
  const { rows } = await pool.query<{
    seq: string; id: string; from_user: string; to_user: string
    kind: SignalKind; payload: unknown; created_at: string
  }>(
    `SELECT seq::text AS seq, id, from_user, to_user, kind, payload, created_at::text AS created_at
       FROM aaelink.call_signals
      WHERE room_id = $1
        AND seq > $2
        AND from_user <> $3
        AND (to_user = '' OR to_user = $3)
      ORDER BY seq ASC
      LIMIT $4`,
    [roomId, afterSeq, uid, capped]
  )
  const signals: CallSignal[] = rows.map(r => ({
    seq: Number(r.seq),
    id: r.id,
    from_user: r.from_user,
    to_user: r.to_user,
    kind: r.kind,
    payload: r.payload,
    created_at: Number(r.created_at),
  }))
  const cursor = signals.length ? signals[signals.length - 1].seq : afterSeq
  return { ok: true, signals, cursor }
}

export interface RoomParticipant {
  user_id: string
  role: string
  muted: boolean
  video_on: boolean
  screen_sharing: boolean
  joined_at: number
}

/** Active participants of a room — peer discovery for mesh signaling. */
export async function listRoomParticipants(pool: Pool, roomId: string): Promise<RoomParticipant[]> {
  const { rows } = await pool.query<{
    user_id: string; role: string; muted: boolean; video_on: boolean
    screen_sharing: boolean; joined_at: string
  }>(
    `SELECT user_id, role, muted, video_on, screen_sharing, joined_at::text AS joined_at
       FROM aaelink.call_participants
      WHERE room_id = $1 AND left_at = 0
      ORDER BY joined_at ASC`,
    [roomId]
  )
  return rows.map(r => ({ ...r, joined_at: Number(r.joined_at) }))
}
