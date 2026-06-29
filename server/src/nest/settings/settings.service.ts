import * as svc from '../../services/settingsService';
import { Injectable } from '@nestjs/common';

/**
 * Thin Nest wrapper around the existing settings service. Request-time paths use
 * async DB access so oracle-async does not touch the sync sqlite bridge.
 */
@Injectable()
export class SettingsService {
  getUserSettings(userId: number) {
    return svc.getUserSettingsAsync(userId);
  }
  upsertSetting(userId: number, key: string, value: unknown) {
    return svc.upsertSettingAsync(userId, key, value);
  }
  bulkUpsertSettings(userId: number, settings: Record<string, unknown>) {
    return svc.bulkUpsertSettingsAsync(userId, settings);
  }
}
