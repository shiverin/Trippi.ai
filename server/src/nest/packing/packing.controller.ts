import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PackingService } from './packing.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

/**
 * /api/trips/:tripId/packing — trip-scoped packing list (items, bags, templates,
 * assignees).
 *
 * Byte-identical to the legacy Express route (server/src/routes/packing.ts):
 * every handler verifies trip access (404 "Trip not found"); mutations check the
 * 'packing_edit' permission (403 "No permission"); status codes match (201 on the
 * creates, 200 elsewhere — note POST /apply-template stays 200); and the bespoke
 * 400/404 bodies are reproduced. Mutations broadcast over WebSocket with the
 * forwarded X-Socket-Id. /reorder is declared before /:id so it wins over the param.
 */
@Controller('api/trips/:tripId/packing')
@UseGuards(JwtAuthGuard)
export class PackingController {
  constructor(private readonly packing: PackingService) {}

  /** Loads the trip or throws the legacy 404; returns it for the permission check. */
  private async requireTrip(tripId: string, user: User) {
    const trip = await this.packing.verifyTripAccess(tripId, user.id);
    if (!trip) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }
    return trip;
  }

  private requireEdit(trip: NonNullable<Awaited<ReturnType<PackingService['verifyTripAccess']>>>, user: User): void {
    if (!this.packing.canEdit(trip!, user)) {
      throw new HttpException({ error: 'No permission' }, 403);
    }
  }

  @Get()
  async list(@CurrentUser() user: User, @Param('tripId') tripId: string) {
    await this.requireTrip(tripId, user);
    return { items: await this.packing.listItems(tripId) };
  }

  @Post('import')
  async importItems(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body('items') items: unknown,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpException({ error: 'items must be a non-empty array' }, 400);
    }
    const created = await this.packing.bulkImport(tripId, items);
    for (const item of created) {
      this.packing.broadcast(tripId, 'packing:created', { item }, socketId);
    }
    return { items: created, count: created.length };
  }

  @Post()
  async create(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body() body: { name?: string; category?: string; checked?: boolean },
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    if (!body.name) {
      throw new HttpException({ error: 'Item name is required' }, 400);
    }
    const item = await this.packing.createItem(tripId, {
      name: body.name,
      category: body.category,
      checked: body.checked,
    });
    this.packing.broadcast(tripId, 'packing:created', { item }, socketId);
    return { item };
  }

  @Put('reorder')
  async reorder(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body('orderedIds') orderedIds: number[],
    @Headers('x-socket-id') _socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    await this.packing.reorderItems(tripId, orderedIds);
    return { success: true };
  }

  @Put(':id')
  async update(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    const { name, checked, category, weight_grams, bag_id, quantity } = body as Record<string, never>;
    const updated = await this.packing.updateItem(
      tripId,
      id,
      { name, checked, category, weight_grams, bag_id, quantity },
      Object.keys(body),
    );
    if (!updated) {
      throw new HttpException({ error: 'Item not found' }, 404);
    }
    this.packing.broadcast(tripId, 'packing:updated', { item: updated }, socketId);
    return { item: updated };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    if (!(await this.packing.deleteItem(tripId, id))) {
      throw new HttpException({ error: 'Item not found' }, 404);
    }
    this.packing.broadcast(tripId, 'packing:deleted', { itemId: Number(id) }, socketId);
    return { success: true };
  }

  @Get('bags')
  async listBags(@CurrentUser() user: User, @Param('tripId') tripId: string) {
    await this.requireTrip(tripId, user);
    return { bags: await this.packing.listBags(tripId) };
  }

  @Post('bags')
  async createBag(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body() body: { name?: string; color?: string },
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    if (!body.name?.trim()) {
      throw new HttpException({ error: 'Name is required' }, 400);
    }
    const bag = await this.packing.createBag(tripId, { name: body.name, color: body.color });
    this.packing.broadcast(tripId, 'packing:bag-created', { bag }, socketId);
    return { bag };
  }

  @Put('bags/:bagId')
  async updateBag(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('bagId') bagId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    const { name, color, weight_limit_grams, user_id } = body as Record<string, never>;
    const updated = await this.packing.updateBag(
      tripId,
      bagId,
      { name, color, weight_limit_grams, user_id },
      Object.keys(body),
    );
    if (!updated) {
      throw new HttpException({ error: 'Bag not found' }, 404);
    }
    this.packing.broadcast(tripId, 'packing:bag-updated', { bag: updated }, socketId);
    return { bag: updated };
  }

  @Delete('bags/:bagId')
  async deleteBag(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('bagId') bagId: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    if (!(await this.packing.deleteBag(tripId, bagId))) {
      throw new HttpException({ error: 'Bag not found' }, 404);
    }
    this.packing.broadcast(tripId, 'packing:bag-deleted', { bagId: Number(bagId) }, socketId);
    return { success: true };
  }

  @Get('templates')
  async listTemplates(@CurrentUser() user: User, @Param('tripId') tripId: string) {
    await this.requireTrip(tripId, user);
    return { templates: await this.packing.listTemplates() };
  }

  @Post('apply-template/:templateId')
  @HttpCode(200)
  async applyTemplate(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('templateId') templateId: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    const added = await this.packing.applyTemplate(tripId, templateId);
    if (!added) {
      throw new HttpException({ error: 'Template not found or empty' }, 404);
    }
    this.packing.broadcast(tripId, 'packing:template-applied', { items: added }, socketId);
    return { items: added, count: added.length };
  }

  @Put('bags/:bagId/members')
  async setBagMembers(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('bagId') bagId: string,
    @Body('user_ids') userIds: unknown,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    const members = await this.packing.setBagMembers(tripId, bagId, Array.isArray(userIds) ? userIds : []);
    if (!members) {
      throw new HttpException({ error: 'Bag not found' }, 404);
    }
    this.packing.broadcast(tripId, 'packing:bag-members-updated', { bagId: Number(bagId), members }, socketId);
    return { members };
  }

  @Post('save-as-template')
  async saveAsTemplate(@CurrentUser() user: User, @Param('tripId') tripId: string, @Body('name') name?: string) {
    await this.requireTrip(tripId, user);
    if (user.role !== 'admin') {
      throw new HttpException({ error: 'Admin access required' }, 403);
    }
    if (!name?.trim()) {
      throw new HttpException({ error: 'Template name is required' }, 400);
    }
    const template = await this.packing.saveAsTemplate(tripId, user.id, name.trim());
    if (!template) {
      throw new HttpException({ error: 'No items to save' }, 400);
    }
    return { template };
  }

  @Get('category-assignees')
  async categoryAssignees(@CurrentUser() user: User, @Param('tripId') tripId: string) {
    await this.requireTrip(tripId, user);
    return { assignees: await this.packing.getCategoryAssignees(tripId) };
  }

  @Put('category-assignees/:categoryName')
  async updateCategoryAssignees(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('categoryName') categoryName: string,
    @Body('user_ids') userIds: number[],
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    this.requireEdit(trip, user);
    const category = decodeURIComponent(categoryName);
    const rows = await this.packing.updateCategoryAssignees(tripId, category, userIds);
    this.packing.broadcast(tripId, 'packing:assignees', { category, assignees: rows }, socketId);
    this.packing.notifyTagged(tripId, user, category, userIds);
    return { assignees: rows };
  }
}
