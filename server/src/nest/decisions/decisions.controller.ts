import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DecisionsService, GroupDecisionInputError } from './decisions.service';
import { Body, Controller, Get, Headers, HttpCode, HttpException, Param, Post, Put, UseGuards } from '@nestjs/common';

type Trip = NonNullable<Awaited<ReturnType<DecisionsService['verifyTripAccess']>>>;

@Controller('api/trips/:tripId/decisions')
@UseGuards(JwtAuthGuard)
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  private async requireTrip(tripId: string, user: User): Promise<Trip> {
    const trip = await this.decisions.verifyTripAccess(tripId, user.id);
    if (!trip) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }
    return trip;
  }

  private async requireEdit(trip: Trip, user: User): Promise<void> {
    if (!(await this.decisions.canEdit(trip, user))) {
      throw new HttpException({ error: 'No permission' }, 403);
    }
  }

  private handleInputError(err: unknown): never {
    if (err instanceof GroupDecisionInputError) {
      throw new HttpException({ error: err.message }, 400);
    }
    throw err;
  }

  @Get()
  async list(@CurrentUser() user: User, @Param('tripId') tripId: string) {
    await this.requireTrip(tripId, user);
    return { decisions: await this.decisions.list(tripId) };
  }

  @Get(':decisionId')
  async get(@CurrentUser() user: User, @Param('tripId') tripId: string, @Param('decisionId') decisionId: string) {
    await this.requireTrip(tripId, user);
    const decision = await this.decisions.get(tripId, decisionId);
    if (!decision) {
      throw new HttpException({ error: 'Decision not found' }, 404);
    }
    return { decision };
  }

  @Post()
  async create(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-socket-id') socketId?: string
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const decision = await this.decisions.create(tripId, user.id, body ?? {});
      this.decisions.broadcast(tripId, 'decision:created', { decision }, socketId);
      return { decision };
    } catch (err) {
      this.handleInputError(err);
    }
  }

  @Put(':decisionId')
  async update(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('decisionId') decisionId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-socket-id') socketId?: string
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const decision = await this.decisions.update(tripId, decisionId, body ?? {});
      if (!decision) {
        throw new HttpException({ error: 'Decision not found' }, 404);
      }
      this.decisions.broadcast(tripId, 'decision:updated', { decision }, socketId);
      return { decision };
    } catch (err) {
      this.handleInputError(err);
    }
  }

  @Post(':decisionId/responses')
  @HttpCode(200)
  async respond(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('decisionId') decisionId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-socket-id') socketId?: string
  ) {
    await this.requireTrip(tripId, user);
    try {
      const decision = await this.decisions.respond(tripId, decisionId, user.id, body ?? {});
      if (!decision) {
        throw new HttpException({ error: 'Decision not found' }, 404);
      }
      this.decisions.broadcast(tripId, 'decision:updated', { decision }, socketId);
      return { decision };
    } catch (err) {
      this.handleInputError(err);
    }
  }

  @Post(':decisionId/finalize')
  @HttpCode(200)
  async finalize(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('decisionId') decisionId: string,
    @Body() body: { option_id?: unknown },
    @Headers('x-socket-id') socketId?: string
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const decision = await this.decisions.finalize(tripId, decisionId, body?.option_id);
      if (!decision) {
        throw new HttpException({ error: 'Decision not found' }, 404);
      }
      this.decisions.broadcast(tripId, 'decision:updated', { decision }, socketId);
      return { decision };
    } catch (err) {
      this.handleInputError(err);
    }
  }
}
