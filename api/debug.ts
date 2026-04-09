export default function handler(req: Request): Response {
  return new Response(
    JSON.stringify({
      hasSlackToken: !!process.env.SLACK_ACCESS_TOKEN,
      hasChannelId: !!process.env.CHANNEL_ID,
      channelId: process.env.CHANNEL_ID,
      nodeVersion: process.version,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
