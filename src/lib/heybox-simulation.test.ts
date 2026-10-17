import {afterEach, describe, expect, it, vi} from 'vitest'
import {createSimulation, startSimulation, advanceSimulation, pauseSimulation, resumeSimulation, retrySimulation, simulationSummary, SIMULATION_STEPS} from './heybox-simulation'
import {defaultHeyboxSettings} from './heybox-settings'

afterEach(() => vi.unstubAllGlobals())

function finish(state: ReturnType<typeof createSimulation>) {
  for (let i = 0; i < 100 && state.status === 'running'; i++) state = advanceSimulation(state, '2026-10-13T08:00:00Z')
  return state
}

describe('heybox simulation console', () => {
  it('uses configured task rules in the actual simulated flow', () => {
    const state=finish(startSimulation(createSimulation('success',{...defaultHeyboxSettings(),topicKeywords:'不存在的主题'})))
    expect(state.jobs.every(j=>j.status==='skipped')).toBe(true)
    expect(simulationSummary(state).messages).toBe(0)
  })
  it('uses custom templates and includes contact only when explicitly requested, independent of follows', () => {
    const settings={...defaultHeyboxSettings(),publicReply:'自定义 {{用户}} 回复',tutorialMessage:'教程 {{教程链接}}',tutorialUrl:'https://example.invalid/tutorial',contactValue:'TEST_CONTACT_ONLY',contactMessage:'联系 {{联系方式}}'}
    const created=createSimulation('success',settings)
    settings.publicReply='后续修改不应影响这次测试'
    const state=finish(startSimulation(created))
    expect(state.jobs[0].draft).toBe('自定义 测试用户 A 回复')
    expect(state.jobs[0].messageDraft).toBe('教程 https://example.invalid/tutorial')
    expect(state.jobs[0].messageDraft).not.toContain('TEST_CONTACT_ONLY')
    expect(state.jobs[3].messageDraft).toContain('微信：TEST_CONTACT_ONLY')
    expect(state.jobs[2].messageDraft).toBe('')
  })
  it('creates an idle, explicitly simulated run with unique synthetic recipients', () => {
    const state = createSimulation()
    expect(state).toMatchObject({mode: 'simulation', status: 'idle', duplicates: 1})
    expect(state.jobs).toHaveLength(4)
    expect(new Set(state.jobs.map(j => j.id)).size).toBe(4)
    expect(state.logs.every(l => l.mode === 'simulation')).toBe(true)
  })

  it('walks the full flow without making network requests or processing unrelated recipients', () => {
    const fetcher = vi.fn(() => {throw new Error('network prohibited')})
    vi.stubGlobal('fetch', fetcher)
    const state = finish(startSimulation(createSimulation('success')))
    expect(state.status).toBe('completed')
    expect(state.jobs.map(j => j.status)).toEqual(['completed', 'skipped', 'skipped', 'completed'])
    expect(state.jobs[0].completedSteps).toEqual(SIMULATION_STEPS.map(s => s.id))
    expect(state.jobs[2].reason).toContain('其他用户')
    expect(state.logs.filter(l => l.step === 'message' && l.result === 'success')).toHaveLength(2)
    expect(state.logs.filter(l => l.step === 'follow' && l.result === 'success')).toHaveLength(1)
    expect(fetcher).not.toHaveBeenCalled()
    expect(simulationSummary(state)).toMatchObject({completed: 2, skipped: 2, failed: 0, progress: 100, messages: 2})
  })

  it('freezes while paused and continues from the same step', () => {
    const running = advanceSimulation(startSimulation(createSimulation('success')))
    const paused = pauseSimulation(running)
    expect(paused.status).toBe('paused')
    expect(advanceSimulation(paused)).toBe(paused)
    const resumed = resumeSimulation(paused)
    expect(resumed.jobs).toEqual(paused.jobs)
    expect(finish(resumed).status).toBe('completed')
  })

  it('stops on a simulated delivery failure and retries only that unfinished action', () => {
    const failed = finish(startSimulation(createSimulation('retry')))
    expect(failed.status).toBe('failed')
    expect(failed.jobs[3]).toMatchObject({status: 'failed', stepIndex: 6, attempts: 1})
    expect(failed.logs.filter(l => l.step === 'message' && l.result === 'success')).toHaveLength(1)
    expect(advanceSimulation(failed)).toBe(failed)
    const finished = finish(retrySimulation(failed))
    expect(finished.status).toBe('completed')
    expect(finished.logs.filter(l => l.step === 'reply' && l.result === 'success')).toHaveLength(2)
    expect(finished.logs.filter(l => l.step === 'message' && l.result === 'success')).toHaveLength(2)
    expect(finished.jobs[3].attempts).toBe(2)
    expect(new Set(finished.logs.map(l => l.id)).size).toBe(finished.logs.length)
  })

  it('does not restart or duplicate an active or completed run', () => {
    const running = startSimulation(createSimulation('success'))
    expect(startSimulation(running)).toBe(running)
    const completed = finish(running)
    expect(startSimulation(completed)).toBe(completed)
    expect(advanceSimulation(completed)).toBe(completed)
    expect(retrySimulation(completed)).toBe(completed)
  })

  it('keeps completed stages and logs immutable during transitions', () => {
    const initial = createSimulation('success')
    const original = JSON.stringify(initial)
    finish(startSimulation(initial))
    expect(JSON.stringify(initial)).toBe(original)
  })

  it('resets by creating a clean new run without carrying message history', () => {
    const finished = finish(startSimulation(createSimulation('success')))
    const reset = createSimulation('retry')
    expect(reset.status).toBe('idle')
    expect(reset.jobs.every(j => j.completedSteps.length === 0 && j.attempts === 0)).toBe(true)
    expect(reset.logs.length).toBeLessThan(finished.logs.length)
    expect(simulationSummary(reset).messages).toBe(0)
  })
})
