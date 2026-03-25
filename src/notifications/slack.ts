/**
 * Slack webhook notification plugin.
 */

import type { NotificationPlugin, NotificationEvent } from './index.js';

export class SlackPlugin implements NotificationPlugin {
  type = 'slack';
  private webhook: string;

  constructor(webhook: string) {
    this.webhook = webhook;
  }

  async send(
    event: NotificationEvent,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<boolean> {
    const payload = this.buildPayload(event, message, details);
    return this.postToWebhook(payload);
  }

  async test(): Promise<boolean> {
    const payload = {
      text: ':white_check_mark: bpro notification test — connection successful!',
    };
    return this.postToWebhook(payload);
  }

  private buildPayload(
    event: NotificationEvent,
    message: string,
    details?: Record<string, unknown>,
  ): Record<string, unknown> {
    const iconMap: Record<string, string> = {
      'snapshot.complete': ':camera:',
      'audit.complete': ':mag:',
      'report.generated': ':bar_chart:',
      'plan.imported': ':clipboard:',
      'agent.task.complete': ':robot_face:',
    };

    const icon = iconMap[event] ?? ':bell:';
    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *bpro — ${event}*\n${message}`,
        },
      },
    ];

    if (details && Object.keys(details).length > 0) {
      const fields = Object.entries(details).slice(0, 10).map(([k, v]) => ({
        type: 'mrkdwn',
        text: `*${k}:* ${String(v)}`,
      }));
      blocks.push({ type: 'section', fields });
    }

    return { blocks };
  }

  private async postToWebhook(payload: Record<string, unknown>): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const resp = await fetch(this.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      return resp.ok;
    } catch {
      return false;
    }
  }
}
