import { getActiveNoticesForAsync, dismissNoticeAsync } from '../../systemNotices/service';
import { Injectable } from '@nestjs/common';
import type { SystemNoticeDto } from '@trippi/shared';

/**
 * Thin Nest wrapper around the existing system-notices service. The condition
 * evaluation, version gating, sorting and dismissal persistence all stay in the
 * upstream service — this only adapts it for DI, so behaviour is unchanged.
 */
@Injectable()
export class SystemNoticesService {
  async getActiveFor(userId: number): Promise<SystemNoticeDto[]> {
    return (await getActiveNoticesForAsync(userId)) as SystemNoticeDto[];
  }

  dismiss(userId: number, noticeId: string): Promise<boolean> {
    return dismissNoticeAsync(userId, noticeId);
  }
}
