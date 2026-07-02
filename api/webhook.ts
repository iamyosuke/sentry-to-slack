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
      project?: string | number
      web_url?: string
      metadata?: { type?: string; value?: string }
      message?: string
      logentry?: { formatted?: string }
      user?: { email?: string; username?: string }
      tags?: Array<[string, string] | { key?: string; value?: string }>
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
    metadata?: { title?: string; type?: string; value?: string }
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

function escapeMrkdwn(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function safeSlackLink(url: string, label: string): string {
  const cleanUrl = url.trim()
  if (!cleanUrl || /[\s|<>]/.test(cleanUrl)) return escapeMrkdwn(label)
  return `<${cleanUrl}|${escapeMrkdwn(label)}>`
}

function escapeInlineCode(value: string): string {
  return escapeMrkdwn(value).replace(/`/g, "'")
}

function stringifyValue(value: string | number | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined
  return String(value)
}

function tagValue(
  tags: Array<[string, string] | { key?: string; value?: string }> | undefined,
  key: string
): string | undefined {
  const tag = tags?.find((entry) => Array.isArray(entry) ? entry[0] === key : entry.key === key)
  if (!tag) return undefined
  return Array.isArray(tag) ? tag[1] : tag.value
}

function firstMeaningful(...values: Array<string | undefined | null>): string | undefined {
  return values
    .map((value) => value?.trim())
    .find((value) => value && value !== '<unknown>' && value.toLowerCase() !== 'unknown')
}

function summarizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.pathname || parsed.hostname
  } catch {
    return undefined
  }
}

function buildTitle(input: {
  title?: string
  metadataTitle?: string
  metadataType?: string
  metadataValue?: string
  message?: string
  culprit?: string
  url?: string
}): string {
  const base = firstMeaningful(
    input.title,
    input.metadataTitle,
    input.metadataValue,
    input.message
  )

  if (base) {
    const type = firstMeaningful(input.metadataType)
    return type && !base.includes(type) ? `${type}: ${base}` : base
  }

  const culprit = firstMeaningful(input.culprit)
  if (culprit) return culprit

  const path = summarizeUrl(input.url)
  return path ? `Sentry issue on ${path}` : 'Sentry issue'
}

function parseAlertPayload(body: SentryAlertPayload): SlackMessage {
  const event = body.data?.event
  return {
    title: buildTitle({
      title: event?.title,
      metadataType: event?.metadata?.type,
      metadataValue: event?.metadata?.value,
      message: event?.message ?? event?.logentry?.formatted,
      culprit: event?.culprit,
      url: event?.web_url,
    }),
    level: event?.level ?? 'unknown',
    project: firstMeaningful(tagValue(event?.tags, 'project'), stringifyValue(event?.project)) ?? 'unknown',
    environment: event?.environment ?? tagValue(event?.tags, 'environment') ?? 'unknown',
    message: event?.metadata?.value ?? '',
    culprit: event?.culprit ?? '',
    user: event?.user?.email ?? event?.user?.username ?? 'anonymous',
    issueUrl: event?.web_url ?? '',
    rule: body.data?.triggered_rule ?? '',
  }
}

function parseLegacyPayload(body: SentryLegacyPayload): SlackMessage {
  return {
    title: buildTitle({
      metadataTitle: body.event?.metadata?.title,
      metadataType: body.event?.metadata?.type,
      metadataValue: body.event?.metadata?.value,
      message: body.event?.logentry?.formatted,
      culprit: body.culprit,
      url: body.url,
    }),
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
  const title = msg.issueUrl ? safeSlackLink(msg.issueUrl, msg.title) : escapeMrkdwn(msg.title)

  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${title}*` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Project:*\n${escapeMrkdwn(msg.project)}` },
        { type: 'mrkdwn', text: `*Environment:*\n${escapeMrkdwn(msg.environment)}` },
        { type: 'mrkdwn', text: `*Level:*\n${escapeMrkdwn(msg.level)}` },
        { type: 'mrkdwn', text: `*User:*\n${escapeMrkdwn(msg.user)}` },
      ],
    },
  ]

  const details = [
    msg.message ? escapeMrkdwn(msg.message) : '',
    msg.culprit ? `\`${escapeInlineCode(msg.culprit)}\`` : '',
  ].filter(Boolean).join('\n')
  if (details) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: details },
    })
  }

  if (msg.rule) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Rule: ${escapeMrkdwn(msg.rule)}` }],
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
        text: `Sentry: ${escapeMrkdwn(msg.title)}`,
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
