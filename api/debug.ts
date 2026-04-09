export const config = { runtime: 'edge' }

export default function handler(): Response {
  return new Response(
    JSON.stringify({
      hasSlackToken: !!process.env.SLACK_ACCESS_TOKEN,
      hasChannelId: !!process.env.CHANNEL_ID,
      channelIdLength: process.env.CHANNEL_ID?.length,
      tokenPrefix: process.env.SLACK_ACCESS_TOKEN?.slice(0, 10),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
