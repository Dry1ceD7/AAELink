export type TabOrientation = 'horizontal' | 'vertical'

export interface TabListKeyAction {
  nextIndex: number
}

export function tabListKeyAction(
  key: string,
  currentIndex: number,
  count: number,
  orientation: TabOrientation
): TabListKeyAction | null {
  if (count <= 0) return null

  const prevKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'

  if (key === prevKey) {
    return { nextIndex: (currentIndex - 1 + count) % count }
  }
  if (key === nextKey) {
    return { nextIndex: (currentIndex + 1) % count }
  }
  if (key === 'Home') {
    return { nextIndex: 0 }
  }
  if (key === 'End') {
    return { nextIndex: count - 1 }
  }
  return null
}
