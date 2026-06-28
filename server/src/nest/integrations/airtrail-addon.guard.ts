import { ADDON_IDS } from '../../addons';
import { isAddonEnabled } from '../../services/adminService';
import { CanActivate, HttpException, Injectable } from '@nestjs/common';

/**
 * Gates the AirTrail integration routes on the global `airtrail` addon. When the
 * admin has it disabled the whole group answers 404. Declared before the
 * JwtAuthGuard so the addon check wins over the 401 (same ordering as the
 * Journey addon gate).
 */
@Injectable()
export class AirtrailAddonGuard implements CanActivate {
  canActivate(): boolean {
    if (!isAddonEnabled(ADDON_IDS.AIRTRAIL)) {
      throw new HttpException({ error: 'AirTrail addon is not enabled' }, 404);
    }
    return true;
  }
}
