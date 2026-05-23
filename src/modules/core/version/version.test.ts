/**
 * Version Management - End-to-End Test Cases
 *
 * Test Scenarios:
 * 1. 發布新版本 → 所有租戶接收通知
 * 2. 租戶查詢可用更新
 * 3. 租戶手動升級
 * 4. 自動升級過期版本
 * 5. 多租戶隔離驗證
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prisma } from '../../../shared/prisma.js';
import * as versionService from './version.service.js';

describe('Version Management System', () => {
  const testTenantId = 'test_tenant_001';
  const testVersion = '2.0.0';

  beforeAll(async () => {
    // 清理測試資料
    await prisma.tenantVersionSubscription.deleteMany({
      where: { tenantId: testTenantId },
    });
  });

  afterAll(async () => {
    // 清理測試資料
    await prisma.versionHistory.deleteMany({
      where: { version: { startsWith: '2.' } },
    });
    await prisma.tenantVersionSubscription.deleteMany({
      where: { tenantId: testTenantId },
    });
  });

  describe('publishVersion', () => {
    it('should create new version with 30-day grace period', async () => {
      const result = await versionService.publishVersion({
        version: testVersion,
        features: ['新功能 A', '新功能 B'],
        notes: '重要更新',
      });

      expect(result.version).toBe(testVersion);
      expect(result.isActive).toBe(true);
      expect(result.features).toContain('新功能 A');

      // 驗證寬限期為 30 天
      const now = new Date();
      const expectedDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const diff = Math.abs(result.supportedUntil.getTime() - expectedDate.getTime());
      expect(diff).toBeLessThan(1000); // 誤差 < 1 秒
    });

    it('should fail if version already exists and is active', async () => {
      await expect(
        versionService.publishVersion({
          version: testVersion,
        }),
      ).rejects.toThrow('已存在');
    });
  });

  describe('getTenantUpdates', () => {
    it('should return current and latest version for tenant', async () => {
      // 初始化租戶 subscription
      await prisma.tenantVersionSubscription.create({
        data: {
          id: `vs_test_${Date.now()}`,
          tenantId: testTenantId,
          currentVersion: '1.0.0',
          latestVersion: testVersion,
          upgradeDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          lastCheckedAt: new Date(),
        },
      });

      const updates = await versionService.getTenantUpdates(testTenantId);

      expect(updates.currentVersion).toBe('1.0.0');
      expect(updates.latestVersion).toBe(testVersion);
      expect(updates.canUpgrade).toBe(true);
      expect(updates.daysUntilDeadline).toBeGreaterThan(0);
    });

    it('should calculate days until deadline correctly', async () => {
      const deadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 天後
      await prisma.tenantVersionSubscription.update({
        where: { tenantId: testTenantId },
        data: { upgradeDeadline: deadline },
      });

      const updates = await versionService.getTenantUpdates(testTenantId);
      expect(updates.daysUntilDeadline).toBeLessThanOrEqual(5);
      expect(updates.daysUntilDeadline).toBeGreaterThan(0);
    });
  });

  describe('upgradeVersion', () => {
    it('should upgrade tenant to latest version', async () => {
      const upgraded = await versionService.upgradeVersion(testTenantId, testVersion);

      expect(upgraded.currentVersion).toBe(testVersion);
      expect(upgraded.upgradeDeadline).toBeNull(); // 寬限期已清除
      expect(upgraded.lastUpgradedAt).toBeDefined();
    });

    it('should fail if target version does not exist', async () => {
      await expect(
        versionService.upgradeVersion(testTenantId, '9.9.9'),
      ).rejects.toThrow('不存在');
    });

    it('should fail if target version is inactive', async () => {
      // 創建一個不活躍的版本
      const inactiveVersion = '1.5.0';
      await prisma.versionHistory.create({
        data: {
          id: `ver_inactive_${Date.now()}`,
          version: inactiveVersion,
          supportedUntil: new Date(),
          isActive: false,
        },
      });

      await expect(
        versionService.upgradeVersion(testTenantId, inactiveVersion),
      ).rejects.toThrow('停用');
    });
  });

  describe('autoUpgradeExpiredVersions', () => {
    it('should auto-upgrade tenants with expired deadlines', async () => {
      // 創建一個過期的 subscription
      const newTenantId = `test_expired_${Date.now()}`;
      const expiredDeadline = new Date(Date.now() - 1000); // 已過期

      await prisma.tenantVersionSubscription.create({
        data: {
          id: `vs_expired_${Date.now()}`,
          tenantId: newTenantId,
          currentVersion: '1.0.0',
          latestVersion: testVersion,
          upgradeDeadline: expiredDeadline,
        },
      });

      const results = await versionService.autoUpgradeExpiredVersions();

      expect(results.upgraded).toBeGreaterThanOrEqual(1);
      expect(results.failed).toBe(0);

      // 驗證租戶已升級
      const subscription = await prisma.tenantVersionSubscription.findUnique({
        where: { tenantId: newTenantId },
      });
      expect(subscription?.currentVersion).toBe(testVersion);
    });

    it('should not upgrade tenants without expired deadlines', async () => {
      const futureDeadline = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const activeTenantId = `test_active_${Date.now()}`;

      await prisma.tenantVersionSubscription.create({
        data: {
          id: `vs_active_${Date.now()}`,
          tenantId: activeTenantId,
          currentVersion: '1.0.0',
          latestVersion: testVersion,
          upgradeDeadline: futureDeadline,
        },
      });

      const initialVersion = await prisma.tenantVersionSubscription.findUnique({
        where: { tenantId: activeTenantId },
        select: { currentVersion: true },
      });

      await versionService.autoUpgradeExpiredVersions();

      const finalVersion = await prisma.tenantVersionSubscription.findUnique({
        where: { tenantId: activeTenantId },
        select: { currentVersion: true },
      });

      // 版本應保持不變
      expect(finalVersion?.currentVersion).toBe(initialVersion?.currentVersion);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should isolate versions by tenant', async () => {
      const tenant1 = `test_iso_1_${Date.now()}`;
      const tenant2 = `test_iso_2_${Date.now()}`;

      // 為兩個租戶創建不同的 subscription
      const sub1 = await prisma.tenantVersionSubscription.create({
        data: {
          id: `vs_iso1_${Date.now()}`,
          tenantId: tenant1,
          currentVersion: '1.0.0',
          latestVersion: testVersion,
          upgradeDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const sub2 = await prisma.tenantVersionSubscription.create({
        data: {
          id: `vs_iso2_${Date.now()}`,
          tenantId: tenant2,
          currentVersion: '1.5.0',
          latestVersion: testVersion,
          upgradeDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // 升級 tenant1
      await versionService.upgradeVersion(tenant1, testVersion);

      // 驗證 tenant1 已升級，tenant2 未升級
      const updated1 = await prisma.tenantVersionSubscription.findUnique({
        where: { tenantId: tenant1 },
      });
      const updated2 = await prisma.tenantVersionSubscription.findUnique({
        where: { tenantId: tenant2 },
      });

      expect(updated1?.currentVersion).toBe(testVersion);
      expect(updated2?.currentVersion).toBe('1.5.0'); // 未改變
    });
  });
});
