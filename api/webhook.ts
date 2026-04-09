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
  }
}

function buildBlocks(body: SentryEvent): Record<string, unknown>[] {
  const level = body.event?.level ?? 'unknown'
  const title = body.event?.metadata?.title ?? 'No title'
  const project = body.project ?? 'unknown'
  const environment = body.event?.environment ?? 'unknown'
  const message = body.event?.logentry?.formatted ?? ''
  const culprit = body.culprit ?? ''
  const user = body.event?.user?.email ?? 'anonymous'
  const issueUrl = body.url ?? ''
  const emoji = level === 'error' ? '🔴' : level === 'warning' ? '🟡' : '🔵'

  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${issueUrl ? `<${issueUrl}|${title}>` : title}*` },
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
      text: { type: 'mrkdwn', text: [message, culprit ? `\`${culprit}\`` : ''].filter(Boolean).join('\n') },
    })
  }

  blocks.push({ type: 'divider' })
  return blocks
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const slackToken = process.env.SLACK_ACCESS_TOKEN
  const channelId = process.env.CHANNEL_ID

  if (!slackToken || !channelId) {
    return new Response(JSON.stringify({ error: 'Missing env vars', hasToken: !!slackToken, hasChannel: !!channelId }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = (await request.json()) as SentryEvent
    const blocks = buildBlocks(body)

    const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
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

    const result = (await slackRes.json()) as { ok: boolean; error?: string }

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
