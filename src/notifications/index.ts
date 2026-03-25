/**
 * Notification plugin system — event-driven notifications.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadYaml, saveYaml } from '../utils/yaml.js';

/** Supported event types. */
export type NotificationEvent =
  | 'snapshot.complete'
  | 'audit.complete'
  | 'report.generated'
  | 'plan.imported'
  | 'agent.task.complete';

/** Base notification plugin interface. */
export interface NotificationPlugin {
  type: string;
  send(event: NotificationEvent, message: string, details?: Record<string, unknown>): Promise<boolean>;
  test(): Promise<boolean>;
}

/** Notification config entry stored in config.yaml. */
export interface NotificationEntry {
  type: 'slack';
  webhook: string;
  events: string[];
  added_at: string;
}

/** Notifications section in config. */
export interface NotificationsConfig {
  notifications?: NotificationEntry[];
}

/**
 * Load notification entries from .bpro/config.yaml.
 */
export function loadNotifications(bproPath: string): NotificationEntry[] {
  const configPath = path.join(bproPath, 'config.yaml');
  const config = loadYaml<NotificationsConfig>(configPath);
  return config?.notifications ?? [];
}

/**
 * Save notification entries to .bpro/config.yaml.
 */
export function saveNotifications(bproPath: string, entries: NotificationEntry[]): void {
  const configPath = path.join(bproPath, 'config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  const config = loadYaml<Record<string, unknown>>(configPath) ?? {};
  config.notifications = entries;
  saveYaml(configPath, config);
}

/**
 * Emit a notification event to all registered plugins that listen for it.
 */
export async function emitEvent(
  bproPath: string,
  event: NotificationEvent,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const entries = loadNotifications(bproPath);
  if (entries.length === 0) return;

  const { SlackPlugin } = await import('./slack.js');

  for (const entry of entries) {
    if (!entry.events.includes(event)) continue;

    let plugin: NotificationPlugin | null = null;
    if (entry.type === 'slack') {
      plugin = new SlackPlugin(entry.webhook);
    }

    if (plugin) {
      try {
        await plugin.send(event, message, details);
      } catch {
        // Notification failure should not break the main flow
      }
    }
  }
}
