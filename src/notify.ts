import { execFile } from 'node:child_process';
import { platform } from 'node:os';

export interface NotifyConfig {
  enabled: boolean;
  webhookUrl?: string;
}

export interface Notifier {
  notify(event: NotifyEvent, details: NotifyDetails): void;
}

export type NotifyEvent =
  | 'session.complete'
  | 'review.approved'
  | 'review.fixes'
  | 'pr.created'
  | 'error.pause'
  | 'error.exit'
  | 'human.needed'
  | 'consensus.reached'
  | 'planning.done';

export interface NotifyDetails {
  title: string;
  body: string;
  sessionId?: string;
  topic?: string;
}

const DEDUP_WINDOW_MS = 5000;

export function createNotifier(config: NotifyConfig): Notifier {
  if (!config.enabled) {
    return { notify() {} };
  }

  const recentEvents = new Map<string, number>();

  return {
    notify(event: NotifyEvent, details: NotifyDetails) {
      const now = Date.now();
      const lastSent = recentEvents.get(event);
      if (lastSent && now - lastSent < DEDUP_WINDOW_MS) return;
      recentEvents.set(event, now);

      sendDesktopNotification(details.title, details.body);

      if (config.webhookUrl) {
        sendWebhook(config.webhookUrl, {
          event,
          ...details,
          timestamp: new Date().toISOString(),
        });
      }
    },
  };
}

export function eventToMessage(event: NotifyEvent, context: { topic?: string; turn?: number; url?: string; loop?: number; max?: number }): NotifyDetails {
  const topic = context.topic ?? 'session';
  switch (event) {
    case 'session.complete':
      return { title: 'DEF Session Complete', body: `Session finished: ${topic}` };
    case 'review.approved':
      return { title: 'Review Approved', body: `Implementation approved for: ${topic}` };
    case 'review.fixes':
      return { title: 'Review: Fixes Needed', body: `Reviewer requested fixes (${context.loop ?? '?'}/${context.max ?? '?'}) for: ${topic}` };
    case 'pr.created':
      return { title: 'PR Created', body: `Draft PR created: ${context.url ?? topic}` };
    case 'error.pause':
      return { title: 'DEF Error - Paused', body: `Session paused after error on turn ${context.turn ?? '?'}: ${topic}` };
    case 'error.exit':
      return { title: 'DEF Error - Exiting', body: `Session exiting after error on turn ${context.turn ?? '?'}: ${topic}` };
    case 'human.needed':
      return { title: 'Human Input Needed', body: `Agent needs human input on: ${topic}` };
    case 'consensus.reached':
      return { title: 'Consensus Reached', body: `Agents reached consensus on: ${topic}` };
    case 'planning.done':
      return { title: 'Planning Complete', body: `Planning phase finished for: ${topic}` };
  }
}

export function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function sendDesktopNotification(title: string, body: string): void {
  const os = platform();
  try {
    if (os === 'darwin') {
      execFile('osascript', ['-e', `display notification "${shellEscape(body)}" with title "${shellEscape(title)}"`], { timeout: 5000 }, () => {});
    } else if (os === 'linux') {
      execFile('notify-send', [title, body], { timeout: 5000 }, () => {});
    } else if (os === 'win32') {
      const script = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);
        $textNodes = $template.GetElementsByTagName('text');
        $textNodes.Item(0).AppendChild($template.CreateTextNode('${shellEscape(title)}')) | Out-Null;
        $textNodes.Item(1).AppendChild($template.CreateTextNode('${shellEscape(body)}')) | Out-Null;
        $toast = [Windows.UI.Notifications.ToastNotification]::new($template);
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DEF CLI').Show($toast);
      `.trim();
      execFile('powershell', ['-NoProfile', '-Command', script], { timeout: 5000 }, () => {});
    }
  } catch {
    // Silent failure — notifications are best-effort
  }
}

function sendWebhook(url: string, payload: Record<string, unknown>): void {
  const isSlack = url.includes('hooks.slack.com');
  const body = isSlack
    ? JSON.stringify({
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: String(payload.title) } },
          { type: 'section', text: { type: 'mrkdwn', text: String(payload.body) } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `Event: \`${payload.event}\` | ${payload.timestamp}` }] },
        ],
      })
    : JSON.stringify(payload);

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
