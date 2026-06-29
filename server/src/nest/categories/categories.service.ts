import {
  listCategoriesAsync,
  getCategoryByIdAsync,
  createCategoryAsync,
  updateCategoryAsync,
  deleteCategoryAsync,
} from '../../services/categoryService';
import { Injectable } from '@nestjs/common';
import type { Category } from '@trippi/shared';

/**
 * Thin Nest wrapper around the existing category service. The SQL and the
 * default colour/icon fallbacks stay in categoryService, so behaviour is
 * unchanged.
 */
@Injectable()
export class CategoriesService {
  async list(): Promise<Category[]> {
    return (await listCategoriesAsync()) as Category[];
  }

  async getById(id: string | number): Promise<Category | undefined> {
    return (await getCategoryByIdAsync(id)) as Category | undefined;
  }

  async create(userId: number, name: string, color?: string, icon?: string): Promise<Category> {
    return (await createCategoryAsync(userId, name, color, icon)) as Category;
  }

  async update(id: string | number, name?: string, color?: string, icon?: string): Promise<Category> {
    return (await updateCategoryAsync(id, name, color, icon)) as Category;
  }

  async remove(id: string | number): Promise<void> {
    await deleteCategoryAsync(id);
  }
}
