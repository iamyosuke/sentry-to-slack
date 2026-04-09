import type { VercelRequest, VercelResponse } from '@vercel/node'

interface SentryEvent {
  project: string
  url?: string
  culprit?: string
  event?: {
    level?: string
    logentry?: { formatted?: string }
    user?: { email?: string }
    environment?: string
    metadata?: { title?: string }
  }
}

interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  fields?: Array<{ type: string; text: string }>
}

function buildSlackBlocks(body: SentryEvent): SlackBlock[] {
  const level = body.event?.level ?? 'unknown'
  const title = body.event?.metadata?.title ?? 'No title'
  const project = body.project ?? 'unknown'
  const environment = body.event?.environment ?? 'unknown'
  const message = body.event?.logentry?.formatted ?? ''
  const culprit = body.culprit ?? ''
  const user = body.event?.user?.email ?? 'anonymous'
  const issueUrl = body.url ?? ''

  const emoji = level === 'error' ? '🔴' : level === 'warning' ? '🟡' : '🔵'

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${issueUrl ? `<${issueUrl}|${title}>` : title}*`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Project:*\n${project}` },
        { type: 'mrkdwn', text: `*Environment:*\n${environment}` },
        { type: 'mrkdwn', text: `*Level:*\n${level}` },
        { type: 'mrkdwn', text: `*User:*\n${user}` },
      ],
    },
  ]

  if (message || culprit) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [message, culprit ? `\`${culprit}\`` : ''].filter(Boolean).join('\n'),
      },
    })
  }

  blocks.push({ type: 'divider' })

  return blocks
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const slackToken = process.env.SLACK_ACCESS_TOKEN
  const channelId = process.env.CHANNEL_ID

  if (!slackToken || !channelId) {
    res.status(500).send('Missing environment variables')
    return
  }

  const body = req.body as SentryEvent
  const blocks = buildSlackBlocks(body)

  const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${slackToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: channelId,
      blocks,
      text: `Sentry: ${body.event?.metadata?.title ?? 'New event'}`,
    }),
  })

  const result = (await slackResponse.json()) as { ok: boolean; error?: string }

  if (!result.ok) {
    console.error('Slack API error:', result.error)
    res.status(502).send(`Slack error: ${result.error}`)
    return
  }

  res.status(200).send('OK')
}
