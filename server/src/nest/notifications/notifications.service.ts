import {
  getNotificationsAsync,
  getUnreadCountAsync,
  markReadAsync,
  markUnreadAsync,
  markAllReadAsync,
  deleteNotificationAsync,
  deleteAllAsync,
  respondToBooleanAsync,
} from '../../services/inAppNotifications';
import { getPreferencesMatrixAsync, setPreferencesAsync } from '../../services/notificationPreferencesService';
import {
  testSmtp,
  testWebhook,
  testNtfy,
  getAdminWebhookUrlAsync,
  getUserWebhookUrlAsync,
  getUserNtfyConfigAsync,
  getAdminNtfyConfigAsync,
} from '../../services/notifications';
import { Injectable } from '@nestjs/common';
import type { ChannelTestResult } from '@trippi/shared';

type NtfyConfig = Awaited<ReturnType<typeof getAdminNtfyConfigAsync>>;
type RespondResult = Awaited<ReturnType<typeof respondToBooleanAsync>>;
type PreferencesMatrix = Awaited<ReturnType<typeof getPreferencesMatrixAsync>>;

/**
 * Thin Nest wrapper around the existing notification services. Channel delivery
 * (including the WebSocket push in inAppNotifications) and the preference
 * persistence all stay in the upstream services, so behaviour — including
 * real-time delivery — is unchanged. The webhook/ntfy fallback resolution that
 * the legacy route does inline is exposed here as small accessors so the
 * controller can reproduce it exactly.
 */
@Injectable()
export class NotificationsService {
  getPreferences(userId: number, role: string): Promise<PreferencesMatrix> {
    return getPreferencesMatrixAsync(userId, role, 'user');
  }

  setPreferences(userId: number, body: Parameters<typeof setPreferencesAsync>[1]): Promise<void> {
    return setPreferencesAsync(userId, body);
  }

  testSmtp(to: string): Promise<ChannelTestResult> {
    return testSmtp(to);
  }

  testWebhook(url: string): Promise<ChannelTestResult> {
    return testWebhook(url);
  }

  testNtfy(cfg: { topic: string; server?: string | null; token?: string | null }): Promise<ChannelTestResult> {
    return testNtfy(cfg);
  }

  userWebhookUrl(userId: number): Promise<string | null> {
    return getUserWebhookUrlAsync(userId);
  }

  adminWebhookUrl(): Promise<string | null> {
    return getAdminWebhookUrlAsync();
  }

  userNtfyConfig(userId: number): Promise<NtfyConfig | null> {
    return getUserNtfyConfigAsync(userId);
  }

  adminNtfyConfig(): Promise<NtfyConfig> {
    return getAdminNtfyConfigAsync();
  }

  // Returns the native service shape (NotificationRow[] is a superset of the
  // client-facing InAppListResult contract); the controller surfaces it as-is.
  listInApp(userId: number, options: { limit?: number; offset?: number; unreadOnly?: boolean }) {
    return getNotificationsAsync(userId, options);
  }

  unreadCount(userId: number): Promise<number> {
    return getUnreadCountAsync(userId);
  }

  markRead(id: number, userId: number): Promise<boolean> {
    return markReadAsync(id, userId);
  }

  markUnread(id: number, userId: number): Promise<boolean> {
    return markUnreadAsync(id, userId);
  }

  markAllRead(userId: number): Promise<number> {
    return markAllReadAsync(userId);
  }

  deleteOne(id: number, userId: number): Promise<boolean> {
    return deleteNotificationAsync(id, userId);
  }

  deleteAll(userId: number): Promise<number> {
    return deleteAllAsync(userId);
  }

  respond(id: number, userId: number, response: 'positive' | 'negative'): Promise<RespondResult> {
    return respondToBooleanAsync(id, userId, response);
  }
}
