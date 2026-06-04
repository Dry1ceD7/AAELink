/**
 * Unit tests for lib/calls/rtcMesh.ts — pure mesh-topology helpers.
 */
import { describe, it, expect } from 'vitest'
import { isPolite, shouldInitiateOffer, reconcilePeers } from '@/lib/calls/rtcMesh'

describe('isPolite', () => {
  it('self is polite when its id sorts after the peer id', () => {
    expect(isPolite('b', 'a')).toBe(true)
    expect(isPolite('a', 'b')).toBe(false)
  })

  it('the two peers always pick opposite roles', () => {
    const x = 'user-001'
    const y = 'user-999'
    expect(isPolite(x, y)).toBe(!isPolite(y, x))
  })
})

describe('shouldInitiateOffer', () => {
  it('the impolite (lower-id) peer initiates the offer', () => {
    expect(shouldInitiateOffer('a', 'b')).toBe(true)
    expect(shouldInitiateOffer('b', 'a')).toBe(false)
  })

  it('exactly one side of a pair initiates', () => {
    const x = 'alpha'
    const y = 'omega'
    expect(shouldInitiateOffer(x, y)).toBe(!shouldInitiateOffer(y, x))
  })

  it('the initiator is exactly the impolite peer (mirror of isPolite)', () => {
    expect(shouldInitiateOffer('a', 'b')).toBe(!isPolite('a', 'b'))
    expect(shouldInitiateOffer('b', 'a')).toBe(!isPolite('b', 'a'))
  })
})

describe('reconcilePeers', () => {
  it('excludes self from both add and remove', () => {
    const { toAdd, toRemove } = reconcilePeers('self', ['self', 'a'], ['self'])
    expect(toAdd).toEqual(['a'])
    expect(toRemove).toEqual([])
  })

  it('adds new participants not yet connected', () => {
    const { toAdd, toRemove } = reconcilePeers('self', ['a', 'b', 'c'], ['a'])
    expect(toAdd.sort()).toEqual(['b', 'c'])
    expect(toRemove).toEqual([])
  })

  it('removes departed peers no longer in the participant set', () => {
    const { toAdd, toRemove } = reconcilePeers('self', ['a'], ['a', 'b', 'c'])
    expect(toAdd).toEqual([])
    expect(toRemove.sort()).toEqual(['b', 'c'])
  })

  it('handles simultaneous add + remove', () => {
    const { toAdd, toRemove } = reconcilePeers('self', ['a', 'd'], ['a', 'b'])
    expect(toAdd).toEqual(['d'])
    expect(toRemove).toEqual(['b'])
  })

  it('is a no-op when sets already match', () => {
    const { toAdd, toRemove } = reconcilePeers('self', ['a', 'b'], ['b', 'a'])
    expect(toAdd).toEqual([])
    expect(toRemove).toEqual([])
  })

  it('collapses duplicates and ignores empty ids', () => {
    const { toAdd, toRemove } = reconcilePeers('self', ['a', 'a', '', 'b'], ['b', 'b'])
    expect(toAdd).toEqual(['a'])
    expect(toRemove).toEqual([])
  })
})
