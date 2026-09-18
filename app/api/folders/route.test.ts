import { describe, expect, it, vi } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: null })),
}))

const { GET, POST } = await import('./route')

describe('/api/folders', () => {
  it('GET returns 401 when unauthenticated', async () => {
    const response = await GET()

    expect(response.status).toBe(401)
  })

  it('POST returns 401 when unauthenticated', async () => {
    const request = new Request('http://localhost/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test folder' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
  })
})
