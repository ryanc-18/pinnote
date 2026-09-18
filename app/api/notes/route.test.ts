import { describe, expect, it, vi } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: null })),
}))

const { POST } = await import('./route')

describe('POST /api/notes', () => {
  it('returns 401 when unauthenticated', async () => {
    const request = new Request('http://localhost/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test note' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
  })
})
