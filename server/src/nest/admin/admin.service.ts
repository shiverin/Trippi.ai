import { invalidateMcpSessions } from '../../mcp';
import * as svc from '../../services/adminService';
import { getPreferencesMatrixAsync, setAdminPreferencesAsync } from '../../services/notificationPreferencesService';
import { adminResetPasskeysAsync } from '../../services/passkeyService';
import { getAdminUserDefaultsAsync, setAdminUserDefaultsAsync } from '../../services/settingsService';
import { Injectable } from '@nestjs/common';

/**
 * Thin Nest wrapper around the existing admin service (+ the settings,
 * MCP-session and notification-preference helpers the legacy route used). All
 * business logic, audit-relevant return shapes and the addon/MCP invalidation
 * reuse the legacy code unchanged.
 */
@Injectable()
export class AdminService {
  // Users
  listUsers() {
    return svc.listUsersAsync();
  }
  createUser(body: unknown) {
    return svc.createUserAsync(body as Parameters<typeof svc.createUserAsync>[0]);
  }
  updateUser(id: string, body: unknown) {
    return svc.updateUserAsync(id, body as Parameters<typeof svc.updateUserAsync>[1]);
  }
  deleteUser(id: string, actingUserId: number) {
    return svc.deleteUserAsync(id, actingUserId);
  }
  resetUserPasskeys(id: string) {
    return adminResetPasskeysAsync(Number(id));
  }

  getStats() {
    return svc.getStatsAsync();
  }
  getPermissions() {
    return svc.getPermissionsAsync();
  }
  savePermissions(permissions: Parameters<typeof svc.savePermissionsAsync>[0]) {
    return svc.savePermissionsAsync(permissions);
  }
  getAuditLog(query: { limit?: string; offset?: string }) {
    return svc.getAuditLogAsync(query);
  }

  getOidcSettings() {
    return svc.getOidcSettingsAsync();
  }
  updateOidcSettings(body: unknown) {
    return svc.updateOidcSettingsAsync(body as Parameters<typeof svc.updateOidcSettingsAsync>[0]);
  }
  saveDemoBaseline() {
    return svc.saveDemoBaseline();
  }

  getGithubReleases(perPage: string, page: string) {
    return svc.getGithubReleases(perPage, page);
  }
  checkVersion() {
    return svc.checkVersion();
  }

  // Invites
  listInvites() {
    return svc.listInvitesAsync();
  }
  createInvite(userId: number, body: unknown) {
    return svc.createInviteAsync(userId, body as Parameters<typeof svc.createInviteAsync>[1]);
  }
  deleteInvite(id: string) {
    return svc.deleteInviteAsync(id);
  }

  // Feature toggles
  getBagTracking() {
    return svc.getBagTrackingAsync();
  }
  updateBagTracking(enabled: unknown) {
    return svc.updateBagTrackingAsync(enabled as boolean);
  }
  getPlacesPhotos() {
    return svc.getPlacesPhotosAsync();
  }
  updatePlacesPhotos(enabled: boolean) {
    return svc.updatePlacesPhotosAsync(enabled);
  }
  getPlacesAutocomplete() {
    return svc.getPlacesAutocompleteAsync();
  }
  updatePlacesAutocomplete(enabled: boolean) {
    return svc.updatePlacesAutocompleteAsync(enabled);
  }
  getPlacesDetails() {
    return svc.getPlacesDetailsAsync();
  }
  updatePlacesDetails(enabled: boolean) {
    return svc.updatePlacesDetailsAsync(enabled);
  }
  getCollabFeatures() {
    return svc.getCollabFeaturesAsync();
  }
  updateCollabFeatures(body: unknown) {
    return svc.updateCollabFeaturesAsync(body as Parameters<typeof svc.updateCollabFeaturesAsync>[0]);
  }

  // Packing templates
  listPackingTemplates() {
    return svc.listPackingTemplatesAsync();
  }
  getPackingTemplate(id: string) {
    return svc.getPackingTemplateAsync(id);
  }
  createPackingTemplate(name: unknown, userId: number) {
    return svc.createPackingTemplateAsync(name as string, userId);
  }
  updatePackingTemplate(id: string, body: unknown) {
    return svc.updatePackingTemplateAsync(id, body as Parameters<typeof svc.updatePackingTemplateAsync>[1]);
  }
  deletePackingTemplate(id: string) {
    return svc.deletePackingTemplateAsync(id);
  }
  createTemplateCategory(templateId: string, name: unknown) {
    return svc.createTemplateCategoryAsync(templateId, name as string);
  }
  updateTemplateCategory(templateId: string, catId: string, body: unknown) {
    return svc.updateTemplateCategoryAsync(
      templateId,
      catId,
      body as Parameters<typeof svc.updateTemplateCategoryAsync>[2],
    );
  }
  deleteTemplateCategory(templateId: string, catId: string) {
    return svc.deleteTemplateCategoryAsync(templateId, catId);
  }
  createTemplateItem(templateId: string, catId: string, name: unknown) {
    return svc.createTemplateItemAsync(templateId, catId, name as string);
  }
  updateTemplateItem(itemId: string, body: unknown) {
    return svc.updateTemplateItemAsync(itemId, body as Parameters<typeof svc.updateTemplateItemAsync>[1]);
  }
  deleteTemplateItem(itemId: string) {
    return svc.deleteTemplateItemAsync(itemId);
  }

  // Addons + tokens + sessions
  listAddons() {
    return svc.listAddonsAsync();
  }
  updateAddon(id: string, body: unknown) {
    return svc.updateAddonAsync(id, body as Parameters<typeof svc.updateAddonAsync>[1]);
  }
  listMcpTokens() {
    return svc.listMcpTokensAsync();
  }
  deleteMcpToken(id: string) {
    return svc.deleteMcpTokenAsync(id);
  }
  listOAuthSessions() {
    return svc.listOAuthSessionsAsync();
  }
  revokeOAuthSession(id: string) {
    return svc.revokeOAuthSessionAsync(id);
  }
  rotateJwtSecret() {
    return svc.rotateJwtSecret();
  }

  invalidateMcpSessions() {
    invalidateMcpSessions();
  }

  // Settings + notification preference helpers (non-admin-service modules)
  getAdminUserDefaults() {
    return getAdminUserDefaultsAsync();
  }
  setAdminUserDefaults(body: Record<string, unknown>) {
    return setAdminUserDefaultsAsync(body);
  }
  getPreferencesMatrix(userId: number, role: string) {
    return getPreferencesMatrixAsync(userId, role, 'admin');
  }
  setAdminPreferences(userId: number, body: unknown) {
    return setAdminPreferencesAsync(userId, body as Parameters<typeof setAdminPreferencesAsync>[1]);
  }
}
