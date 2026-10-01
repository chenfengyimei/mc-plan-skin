import { expect, test } from '@playwright/test';

/**
 * Standalone 最小纵向链路冒烟（不含预览与下载——公共契约缺口已记录）：
 * 打开网站 → 描述 → 创建会话 → 请求渲染 → worker 处理 → 候选确认 → 会话完成。
 */
test('Standalone 最小纵向链路：创建→渲染→确认', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MC Plan Skin' })).toBeVisible();
  await expect(page.locator('.badge-ok')).toHaveText('正常', { timeout: 30_000 });

  await page.getByLabel('皮肤描述').fill('一位戴着蓝色围巾的雪地探险家');
  await page.getByRole('button', { name: '开始创作' }).click();

  await expect(page.getByTestId('conversation-state')).toContainText('状态：active', {
    timeout: 20_000,
  });

  await page.getByRole('button', { name: /请求渲染/ }).click();
  await expect(page.getByTestId('render-0')).toContainText('succeeded', { timeout: 60_000 });

  await page.getByLabel('成品标题').fill('雪地探险家');
  const confirmButton = page.locator('[data-testid^="confirm-"]').first();
  await confirmButton.click();

  await expect(page.getByTestId('finalize-status')).toContainText('succeeded', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('finalize-done')).toBeVisible();
});
