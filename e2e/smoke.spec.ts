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

  await page.getByRole('button', { name: /请求(真实)?渲染/ }).click();
  await expect(page.getByTestId('render-0')).toHaveClass(/render-succeeded/, { timeout: 60_000 });

  const preview = page.getByTestId('skin-preview-3d').first();
  await expect(preview).toBeVisible();
  await preview.scrollIntoViewIfNeeded();

  await expect(preview).toHaveAttribute('data-animation', 'walk');
  await page.getByRole('button', { name: '播放跑步动作' }).first().click();
  await expect(preview).toHaveAttribute('data-animation', 'run');
  await expect
    .poll(() =>
      preview
        .locator('.skin-cuboid-right-arm')
        .evaluate((element) => getComputedStyle(element).animationName),
    )
    .toContain('skin-run-forward');

  await page.getByRole('button', { name: '暂停动作' }).first().click();
  await expect(preview).toHaveAttribute('data-playing', 'false');
  await expect
    .poll(() =>
      preview
        .locator('.skin-cuboid-right-arm')
        .evaluate((element) => getComputedStyle(element).animationPlayState),
    )
    .toBe('paused');
  await page.getByRole('button', { name: '播放动作' }).first().click();
  await page.getByRole('slider', { name: '动画速度' }).first().fill('1.6');
  await expect(preview).toHaveAttribute('data-speed', '1.6');
  await page.getByRole('slider', { name: '预览缩放' }).first().fill('1.16');
  await expect(preview).toHaveAttribute('data-zoom', '1.16');

  await page.getByRole('button', { name: '开启自动旋转' }).first().click();
  await expect(preview).toHaveAttribute('data-auto-rotate', 'true');
  const autoRotateYaw = await preview.getAttribute('data-yaw');
  await expect.poll(() => preview.getAttribute('data-yaw')).not.toBe(autoRotateYaw);

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
  await expect(preview).toHaveAttribute('data-auto-rotate', 'false');
  await page.getByRole('button', { name: '重置预览视角' }).first().click();
  await expect(preview).toHaveAttribute('data-yaw', '-28.0');
  await expect(preview).toHaveAttribute('data-zoom', '1.00');

  await page.getByLabel('成品标题').fill('雪地探险家');
  const confirmButton = page.locator('[data-testid^="confirm-"]').first();
  await confirmButton.click();

  await expect(page.locator('.finalize-status')).toHaveClass(/finalize-succeeded/, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('finalize-done')).toBeVisible();
});
