/**
 * D5 Calls — WebRTC mesh topology helpers.
 *
 * A huddle is a full mesh: every participant holds one RTCPeerConnection to every
 * other participant. Two pure concerns decided here keep the stateful client
 * (lib/calls/rtcClient.ts) trivial to unit-test and free of browser APIs:
 *
 *   1. Perfect-negotiation roles. MDN's collision-free negotiation assigns each
 *      side of a pair a fixed "polite"/"impolite" role and lets exactly ONE side
 *      open the initial offer. Both decisions must be deterministic and agree on
 *      both peers from the two user ids alone — so we derive them by lexicographic
 *      comparison of the (globally unique) user ids.
 *
 *   2. Peer reconciliation. On each signaling poll the client receives the current
 *      active-participant set; it must add connections for newcomers and tear down
 *      connections for departures. That is a plain set-diff against the connections
 *      it already holds, excluding self.
 *
 * No browser globals, no React, no I/O — every function is referentially
 * transparent for direct vitest coverage.
 */

/**
 * Perfect-negotiation politeness for the local peer relative to `peerId`.
 *
 * The polite peer yields on an offer collision (rolls back its own offer and
 * accepts the incoming one); the impolite peer ignores the colliding offer.
 * Rule: self is polite when `selfId > peerId` lexicographically. The comparison
 * is total and antisymmetric over distinct ids, so the two peers always pick
 * opposite roles.
 */
export function isPolite(selfId: string, peerId: string): boolean {
  return selfId > peerId
}

/**
 * Whether the local peer creates the INITIAL offer to `peerId`.
 *
 * Exactly one side opens negotiation; the other waits. We make the impolite peer
 * (`selfId < peerId`) the initiator — the mirror of `isPolite` — so the roles are
 * consistent and no glare occurs on first connect.
 */
export function shouldInitiateOffer(selfId: string, peerId: string): boolean {
  return selfId < peerId
}

/**
 * Set-diff the desired participant set against the peers we already connect to.
 *
 * `participantIds` is the room's current active participants (peer discovery);
 * `currentPeerIds` is the set of peers we hold connections for. Self is excluded
 * from both directions. Returns the peers to connect (`toAdd`) and the stale
 * peers to disconnect (`toRemove`). Duplicates in the inputs are collapsed.
 */
export function reconcilePeers(
  selfId: string,
  participantIds: string[],
  currentPeerIds: string[]
): { toAdd: string[]; toRemove: string[] } {
  const desired = new Set(participantIds.filter((id) => id && id !== selfId))
  const current = new Set(currentPeerIds.filter((id) => id && id !== selfId))

  const toAdd: string[] = []
  for (const id of desired) {
    if (!current.has(id)) toAdd.push(id)
  }

  const toRemove: string[] = []
  for (const id of current) {
    if (!desired.has(id)) toRemove.push(id)
  }

  return { toAdd, toRemove }
}
