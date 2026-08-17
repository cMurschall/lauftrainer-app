import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureConnectorSession, connectorStatus, disconnectConnector } from './connectorService'

describe('connectorService', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('captures connector_session from the URL into localStorage', () => {
    window.history.replaceState(
      {},
      '',
      '/?connector=strava&connector_session=dddddddd-dddd-4ddd-8ddd-dddddddddddd&keep=1',
    )
    captureConnectorSession()
    expect(JSON.parse(localStorage.getItem('lauftrainer-connector-sessions') || '{}')).toEqual({
      strava: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    })
    expect(window.location.search).toBe('?keep=1')
  })

  it('migrates legacy polar session when reading status headers', async () => {
    localStorage.setItem('lauftrainer-polar-session', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(JSON.parse(headers.get('X-Connector-Sessions') || '{}')).toEqual({
        polar: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      })
      return new Response(
        JSON.stringify({ connectors: [{ id: 'polar', name: 'Polar', connected: true, active: true }] }),
        {
          status: 200,
        },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const status = await connectorStatus()
    expect(status[0].connected).toBe(true)
    expect(JSON.parse(localStorage.getItem('lauftrainer-connector-sessions') || '{}').polar).toBe(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    )
  })

  it('clears local session after disconnect', async () => {
    localStorage.setItem(
      'lauftrainer-connector-sessions',
      JSON.stringify({ polar: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ disconnected: true }), { status: 200 })),
    )
    await disconnectConnector('polar')
    expect(JSON.parse(localStorage.getItem('lauftrainer-connector-sessions') || '{}')).toEqual({})
  })
})
