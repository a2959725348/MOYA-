import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {applyTheme, initializeTheme} from './theme'

// Browser boundary fixtures keep the theme functions real in Vitest's Node environment.
describe('workbench theme', () => {
  let classes: Set<string>
  let style: {colorScheme: string}
  let metadata: Record<string, string>
  let stored: Map<string, string>
  beforeEach(() => {
    classes = new Set()
    style = {colorScheme: ''}
    metadata = {}
    stored = new Map()
    vi.stubGlobal('document', {
      documentElement: {classList: {toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name)}, style},
      querySelector: () => ({setAttribute: (key: string, value: string) => {metadata[key] = value}}),
    })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {stored.set(key, value)},
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('uses dark DOM and color scheme when no preference exists', () => {
    expect(initializeTheme()).toBe('dark')
    expect(classes.has('dark')).toBe(true)
    expect(style.colorScheme).toBe('dark')
  })
  it('initializes persisted light without activating dark', () => {
    stored.set('workbench-theme', 'light')
    expect(initializeTheme()).toBe('light')
    expect(classes.has('dark')).toBe(false)
    expect(style.colorScheme).toBe('light')
  })
  it('falls back to dark for unsupported preferences', () => {
    stored.set('workbench-theme', 'invalid')
    expect(initializeTheme()).toBe('dark')
    expect(classes.has('dark')).toBe(true)
  })
  it('initializes dark when reading storage is denied', () => {
    vi.stubGlobal('localStorage', {getItem: () => {throw new Error('denied')}, setItem: () => {}})
    expect(initializeTheme()).toBe('dark')
    expect(style.colorScheme).toBe('dark')
  })
  it('applies visible light, updates metadata and preserves it on initialization', () => {
    initializeTheme()
    const darkColor = metadata.content
    applyTheme('light')
    expect(classes.has('dark')).toBe(false)
    expect(style.colorScheme).toBe('light')
    expect(metadata.content).toMatch(/^#[0-9a-f]{6}$/i)
    expect(metadata.content).not.toBe(darkColor)
    expect(stored.get('workbench-theme')).toBe('light')
    expect(initializeTheme()).toBe('light')
  })
  it('still changes the visible theme when writing storage is denied', () => {
    initializeTheme()
    vi.stubGlobal('localStorage', {getItem: () => null, setItem: () => {throw new Error('denied')}})
    expect(() => applyTheme('light')).not.toThrow()
    expect(classes.has('dark')).toBe(false)
    expect(style.colorScheme).toBe('light')
  })
})
