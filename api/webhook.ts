export const config = { runtime: 'edge' }

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
    tags?: Array<{ key: string; value: string }>
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

export async function POST(request: Request): Promise<Response> {
  const slackToken = process.env.SLACK_ACCESS_TOKEN
  const channelId = process.env.CHANNEL_ID
  const sentrySecret = process.env.SENTRY_CLIENT_SECRET

  if (!slackToken || !channelId) {
    return new Response('Missing environment variables', { status: 500 })
  }

  // Verify Sentry webhook signature if secret is configured
  if (sentrySecret) {
    const signature = request.headers.get('sentry-hook-signature')
    if (!signature) {
      return new Response('Missing signature', { status: 401 })
    }

    const rawBody = await request.text()
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(sentrySecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
    const expectedSignature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    if (signature !== expectedSignature) {
      return new Response('Invalid signature', { status: 401 })
    }

    // Parse body from raw text since we already consumed the stream
    const body = JSON.parse(rawBody) as SentryEvent
    return await sendToSlack(body, slackToken, channelId)
  }

  const body = (await request.json()) as SentryEvent
  return await sendToSlack(body, slackToken, channelId)
}

async function sendToSlack(
  body: SentryEvent,
  slackToken: string,
  channelId: string,
): Promise<Response> {
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
    return new Response(`Slack error: ${result.error}`, { status: 502 })
  }

  return new Response('OK', { status: 200 })
}
