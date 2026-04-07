export const config = { runtime: 'edge' }

export function GET(): Response {
  return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
