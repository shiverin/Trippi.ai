import { importAirtrailFlights } from '../../services/airtrail/airtrailImport';
import { checkPermission } from '../../services/permissions';
import { verifyTripAccess } from '../../services/tripAccess';
import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AirtrailAddonGuard } from './airtrail-addon.guard';
import { Body, Controller, Headers, HttpException, Param, Post, UseGuards } from '@nestjs/common';
import { airtrailImportSchema, type AirtrailImport, type AirtrailImportResult } from '@trippi/shared';

/**
 * POST /api/trips/:tripId/reservations/import/airtrail — turn selected AirTrail
 * flights into reservations. Trip-scoped (reservation_edit) and addon-gated. The
 * flights are re-fetched server-side with the caller's own key.
 */
@Controller('api/trips/:tripId/reservations/import')
@UseGuards(AirtrailAddonGuard, JwtAuthGuard)
export class AirtrailImportController {
  private async requireEdit(tripId: string, user: User): Promise<void> {
    const trip = await verifyTripAccess(tripId, user.id);
    if (!trip) throw new HttpException({ error: 'Trip not found' }, 404);
    if (!checkPermission('reservation_edit', user.role, trip.user_id, user.id, trip.user_id !== user.id)) {
      throw new HttpException({ error: 'No permission' }, 403);
    }
  }

  @Post('airtrail')
  async importAirtrail(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body(new ZodValidationPipe(airtrailImportSchema)) body: AirtrailImport,
    @Headers('x-socket-id') socketId?: string,
  ): Promise<AirtrailImportResult> {
    await this.requireEdit(tripId, user);
    try {
      return await importAirtrailFlights(tripId, user.id, body.flightIds, socketId);
    } catch (err: any) {
      throw new HttpException({ error: err?.message || 'AirTrail import failed' }, err?.status === 400 ? 400 : 502);
    }
  }
}
