import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    hasSlackToken: !!process.env.SLACK_ACCESS_TOKEN,
    hasChannelId: !!process.env.CHANNEL_ID,
    channelId: process.env.CHANNEL_ID,
    nodeVersion: process.version,
  })
}
