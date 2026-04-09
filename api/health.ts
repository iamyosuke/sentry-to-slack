export const config = { runtime: 'edge' }

export default function handler(): Response {
  return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
