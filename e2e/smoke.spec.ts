import { expect, test } from '@playwright/test';

/** Standalone 纵向链路：创建 → 渲染 → 3D 候选预览 → 确认。 */
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

  const preview = page.getByTestId('skin-preview-3d').first();
  await expect(preview).toBeVisible();
  await preview.scrollIntoViewIfNeeded();
  const initialYaw = await preview.getAttribute('data-yaw');
  const bounds = await preview.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 72, bounds.y + bounds.height / 2);
    await page.mouse.up();
  }
  await expect.poll(() => preview.getAttribute('data-yaw')).not.toBe(initialYaw);
  await page.getByRole('button', { name: '重置预览视角' }).first().click();
  await expect(preview).toHaveAttribute('data-yaw', '-28.0');

  await page.getByLabel('成品标题').fill('雪地探险家');
  const confirmButton = page.locator('[data-testid^="confirm-"]').first();
  await confirmButton.click();

  await expect(page.getByTestId('finalize-status')).toContainText('succeeded', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('finalize-done')).toBeVisible();
});
