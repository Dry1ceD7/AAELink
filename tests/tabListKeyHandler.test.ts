import { describe, expect, it } from 'vitest'
import { tabListKeyAction } from '@/components/a11y/tabListKeyHandler'

describe('tabListKeyAction', () => {
  describe('horizontal orientation', () => {
    it('ArrowRight advances by 1', () => {
      expect(tabListKeyAction('ArrowRight', 0, 3, 'horizontal')).toEqual({ nextIndex: 1 })
    })

    it('ArrowRight wraps from last to first', () => {
      expect(tabListKeyAction('ArrowRight', 2, 3, 'horizontal')).toEqual({ nextIndex: 0 })
    })

    it('ArrowLeft moves backward', () => {
      expect(tabListKeyAction('ArrowLeft', 1, 3, 'horizontal')).toEqual({ nextIndex: 0 })
    })

    it('ArrowLeft wraps from first to last', () => {
      expect(tabListKeyAction('ArrowLeft', 0, 3, 'horizontal')).toEqual({ nextIndex: 2 })
    })

    it('ignores ArrowUp/ArrowDown', () => {
      expect(tabListKeyAction('ArrowUp', 0, 3, 'horizontal')).toBeNull()
      expect(tabListKeyAction('ArrowDown', 0, 3, 'horizontal')).toBeNull()
    })
  })

  describe('vertical orientation', () => {
    it('ArrowDown advances by 1', () => {
      expect(tabListKeyAction('ArrowDown', 0, 3, 'vertical')).toEqual({ nextIndex: 1 })
    })

    it('ArrowUp wraps from first to last', () => {
      expect(tabListKeyAction('ArrowUp', 0, 3, 'vertical')).toEqual({ nextIndex: 2 })
    })

    it('ignores ArrowLeft/ArrowRight', () => {
      expect(tabListKeyAction('ArrowLeft', 0, 3, 'vertical')).toBeNull()
      expect(tabListKeyAction('ArrowRight', 0, 3, 'vertical')).toBeNull()
    })
  })

  describe('Home/End', () => {
    it('Home jumps to first', () => {
      expect(tabListKeyAction('Home', 2, 5, 'horizontal')).toEqual({ nextIndex: 0 })
    })

    it('End jumps to last', () => {
      expect(tabListKeyAction('End', 0, 5, 'horizontal')).toEqual({ nextIndex: 4 })
    })

    it('Home/End work in both orientations', () => {
      expect(tabListKeyAction('Home', 3, 4, 'vertical')).toEqual({ nextIndex: 0 })
      expect(tabListKeyAction('End', 0, 4, 'vertical')).toEqual({ nextIndex: 3 })
    })
  })

  describe('edge cases', () => {
    it('returns null for count <= 0', () => {
      expect(tabListKeyAction('ArrowRight', 0, 0, 'horizontal')).toBeNull()
      expect(tabListKeyAction('ArrowRight', 0, -1, 'horizontal')).toBeNull()
    })

    it('returns null for unhandled keys', () => {
      expect(tabListKeyAction('Enter', 0, 3, 'horizontal')).toBeNull()
      expect(tabListKeyAction('Tab', 0, 3, 'horizontal')).toBeNull()
      expect(tabListKeyAction(' ', 0, 3, 'horizontal')).toBeNull()
    })

    it('single-tab list still cycles via Home/End', () => {
      expect(tabListKeyAction('Home', 0, 1, 'horizontal')).toEqual({ nextIndex: 0 })
      expect(tabListKeyAction('End', 0, 1, 'horizontal')).toEqual({ nextIndex: 0 })
      expect(tabListKeyAction('ArrowRight', 0, 1, 'horizontal')).toEqual({ nextIndex: 0 })
    })
  })
})
