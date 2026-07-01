import { asyncDb } from '../db/asyncDatabase';

export const DEFAULT_ALLOWED_EXTENSIONS = 'jpg,jpeg,png,gif,webp,heic,pdf,doc,docx,xls,xlsx,txt,csv,pkpass';

export async function getAllowedExtensionsAsync(): Promise<string> {
  try {
    const row = await asyncDb
      .prepare("SELECT value FROM app_settings WHERE key = 'allowed_file_types'")
      .get<{ value: string }>();
    return row?.value || DEFAULT_ALLOWED_EXTENSIONS;
  } catch {
    return DEFAULT_ALLOWED_EXTENSIONS;
  }
}
