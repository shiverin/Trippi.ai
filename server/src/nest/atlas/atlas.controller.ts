import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AtlasService } from './atlas.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RegionGeo } from '@trippi/shared';

import type { Response } from 'express';

/**
 * /api/addons/atlas — visited countries/regions, region GeoJSON, bucket list.
 *
 * Byte-identical to the legacy Express route (server/src/routes/atlas.ts): all
 * endpoints require auth; country/region codes are upper-cased; /regions is
 * always no-store while /regions/geo is cached for a day only on a non-empty
 * result; the mark POSTs answer 200 (not Nest's default 201); and the bespoke
 * 400/404 bodies are reproduced exactly. No addon gate — the legacy route has
 * none, so adding one would break clients when the addon is off.
 */
@Controller('api/addons/atlas')
@UseGuards(JwtAuthGuard)
export class AtlasController {
  constructor(private readonly atlas: AtlasService) {}

  @Get('stats')
  async stats(@CurrentUser() user: User) {
    return this.atlas.stats(user.id);
  }

  @Get('regions')
  @Header('Cache-Control', 'no-cache, no-store')
  async regions(@CurrentUser() user: User) {
    return this.atlas.visitedRegions(user.id);
  }

  @Get('regions/geo')
  async regionGeo(
    @Query('countries') countries: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegionGeo> {
    const list = (countries || '').split(',').filter(Boolean);
    if (list.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }
    const geo = await this.atlas.regionGeo(list);
    // Cache only a non-empty result, matching the legacy route (the empty
    // short-circuit above sends no Cache-Control header).
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return geo;
  }

  @Get('countries/geo')
  @Header('Cache-Control', 'public, max-age=86400')
  countryGeo(): RegionGeo {
    return this.atlas.countryGeo();
  }

  @Get('country/:code')
  async countryPlaces(@CurrentUser() user: User, @Param('code') code: string) {
    return this.atlas.countryPlaces(user.id, code.toUpperCase());
  }

  @Post('country/:code/mark')
  @HttpCode(200)
  async markCountry(@CurrentUser() user: User, @Param('code') code: string): Promise<{ success: boolean }> {
    await this.atlas.markCountry(user.id, code.toUpperCase());
    return { success: true };
  }

  @Delete('country/:code/mark')
  async unmarkCountry(@CurrentUser() user: User, @Param('code') code: string): Promise<{ success: boolean }> {
    await this.atlas.unmarkCountry(user.id, code.toUpperCase());
    return { success: true };
  }

  @Post('region/:code/mark')
  @HttpCode(200)
  async markRegion(
    @CurrentUser() user: User,
    @Param('code') code: string,
    @Body('name') name?: string,
    @Body('country_code') countryCode?: string,
  ): Promise<{ success: boolean }> {
    if (!name || !countryCode) {
      throw new HttpException({ error: 'name and country_code are required' }, 400);
    }
    await this.atlas.markRegion(user.id, code.toUpperCase(), name, countryCode.toUpperCase());
    return { success: true };
  }

  @Delete('region/:code/mark')
  async unmarkRegion(@CurrentUser() user: User, @Param('code') code: string): Promise<{ success: boolean }> {
    await this.atlas.unmarkRegion(user.id, code.toUpperCase());
    return { success: true };
  }

  @Get('bucket-list')
  async bucketList(@CurrentUser() user: User) {
    return { items: await this.atlas.bucketList(user.id) };
  }

  @Post('bucket-list')
  async createBucketItem(
    @CurrentUser() user: User,
    @Body()
    body: {
      name?: string;
      lat?: number | null;
      lng?: number | null;
      country_code?: string | null;
      notes?: string | null;
      target_date?: string | null;
    },
  ): Promise<{ item: unknown }> {
    if (!body.name?.trim()) {
      throw new HttpException({ error: 'Name is required' }, 400);
    }
    const { name, lat, lng, country_code, notes, target_date } = body;
    return { item: await this.atlas.createBucketItem(user.id, { name, lat, lng, country_code, notes, target_date }) };
  }

  @Put('bucket-list/:id')
  async updateBucketItem(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      notes?: string;
      lat?: number | null;
      lng?: number | null;
      country_code?: string | null;
      target_date?: string | null;
    },
  ): Promise<{ item: unknown }> {
    const { name, notes, lat, lng, country_code, target_date } = body;
    const item = await this.atlas.updateBucketItem(user.id, id, { name, notes, lat, lng, country_code, target_date });
    if (!item) {
      throw new HttpException({ error: 'Item not found' }, 404);
    }
    return { item };
  }

  @Delete('bucket-list/:id')
  async deleteBucketItem(@CurrentUser() user: User, @Param('id') id: string): Promise<{ success: boolean }> {
    if (!(await this.atlas.deleteBucketItem(user.id, id))) {
      throw new HttpException({ error: 'Item not found' }, 404);
    }
    return { success: true };
  }
}
