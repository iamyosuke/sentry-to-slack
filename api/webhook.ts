export const config = { runtime: 'edge' }

// Sentry Internal Integration Alert Rule payload
interface SentryAlertPayload {
  action?: string
  data?: {
    event?: {
      title?: string
      level?: string
      culprit?: string
      environment?: string
      web_url?: string
      metadata?: { type?: string; value?: string }
      user?: { email?: string; username?: string }
      tags?: Array<[string, string]>
    }
    triggered_rule?: string
  }
}

// Legacy webhook / simple test payload
interface SentryLegacyPayload {
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

interface SlackMessage {
  title: string
  level: string
  project: string
  environment: string
  message: string
  culprit: string
  user: string
  issueUrl: string
  rule: string
}

function parseAlertPayload(body: SentryAlertPayload): SlackMessage {
  const event = body.data?.event
  return {
    title: event?.title ?? 'No title',
    level: event?.level ?? 'unknown',
    project: event?.tags?.find(([k]) => k === 'project')?.[1] ?? 'unknown',
    environment: event?.environment ?? event?.tags?.find(([k]) => k === 'environment')?.[1] ?? 'unknown',
    message: event?.metadata?.value ?? '',
    culprit: event?.culprit ?? '',
    user: event?.user?.email ?? event?.user?.username ?? 'anonymous',
    issueUrl: event?.web_url ?? '',
    rule: body.data?.triggered_rule ?? '',
  }
}

function parseLegacyPayload(body: SentryLegacyPayload): SlackMessage {
  return {
    title: body.event?.metadata?.title ?? 'No title',
    level: body.event?.level ?? 'unknown',
    project: body.project ?? 'unknown',
    environment: body.event?.environment ?? 'unknown',
    message: body.event?.logentry?.formatted ?? '',
    culprit: body.culprit ?? '',
    user: body.event?.user?.email ?? 'anonymous',
    issueUrl: body.url ?? '',
    rule: '',
  }
}

function buildBlocks(msg: SlackMessage): Record<string, unknown>[] {
  const emoji = msg.level === 'error' ? '🔴' : msg.level === 'warning' ? '🟡' : '🔵'

  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${msg.issueUrl ? `<${msg.issueUrl}|${msg.title}>` : msg.title}*` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Project:*\n${msg.project}` },
        { type: 'mrkdwn', text: `*Environment:*\n${msg.environment}` },
        { type: 'mrkdwn', text: `*Level:*\n${msg.level}` },
        { type: 'mrkdwn', text: `*User:*\n${msg.user}` },
      ],
    },
  ]

  const details = [msg.message, msg.culprit ? `\`${msg.culprit}\`` : ''].filter(Boolean).join('\n')
  if (details) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: details },
    })
  }

  if (msg.rule) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Rule: ${msg.rule}` }],
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
    return new Response(JSON.stringify({ error: 'Missing env vars' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const raw = await request.json()
    const hookResource = request.headers.get('sentry-hook-resource')

    // Detect payload format: Alert Rule (Internal Integration) vs Legacy
    const msg = hookResource === 'event_alert' || raw.action === 'triggered'
      ? parseAlertPayload(raw as SentryAlertPayload)
      : parseLegacyPayload(raw as SentryLegacyPayload)

    const blocks = buildBlocks(msg)

    const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slackToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        blocks,
        text: `Sentry: ${msg.title}`,
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
