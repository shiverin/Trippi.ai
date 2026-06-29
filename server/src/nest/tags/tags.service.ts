import {
  listTagsAsync,
  createTagAsync,
  getTagByIdAndUserAsync,
  updateTagAsync,
  deleteTagAsync,
} from '../../services/tagService';
import { Injectable } from '@nestjs/common';
import type { Tag } from '@trippi/shared';

/**
 * Thin Nest wrapper around the existing tag service. Ownership scoping and the
 * default colour fallback stay in tagService, so behaviour is unchanged.
 */
@Injectable()
export class TagsService {
  async list(userId: number): Promise<Tag[]> {
    return (await listTagsAsync(userId)) as Tag[];
  }

  async getByIdAndUser(id: string | number, userId: number): Promise<Tag | undefined> {
    return (await getTagByIdAndUserAsync(id, userId)) as Tag | undefined;
  }

  async create(userId: number, name: string, color?: string): Promise<Tag> {
    return (await createTagAsync(userId, name, color)) as Tag;
  }

  async update(id: string | number, name?: string, color?: string): Promise<Tag> {
    return (await updateTagAsync(id, name, color)) as Tag;
  }

  async remove(id: string | number): Promise<void> {
    await deleteTagAsync(id);
  }
}
