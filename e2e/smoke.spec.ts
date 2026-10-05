import { expect, test } from '@playwright/test';

const SHOT_DIR = process.env.SKIN_E2E_SHOT_DIR ?? 'test-results/shots';

/**
 * Standalone 纵向链路（自包含 Fake Provider 栈）：创建 → 渲染 → 3D 候选预览 →
 * 候选对比 → 刷新恢复 → 确认 → 下载。桌面与移动两个视口各覆盖一次完整流程；
 * 截图存 SKIN_E2E_SHOT_DIR（默认 test-results/shots，均不入库）。
 */
test.describe('Standalone 桌面全流程', () => {
  test('创建→调整→对比→预览→刷新恢复→确认→下载', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'MC Plan Skin' })).toBeVisible();
    await expect(page.locator('.badge-ok')).toHaveText('正常', { timeout: 30_000 });
    await page.screenshot({ path: `${SHOT_DIR}/desktop-01-welcome.png`, fullPage: true });

    await page.getByLabel('皮肤描述').fill('一位戴着蓝色围巾的雪地探险家');
    await page.getByRole('button', { name: '开始创作' }).click();

    await expect(page.getByTestId('conversation-state')).toContainText('状态：active', {
      timeout: 20_000,
    });

    await page.getByRole('button', { name: /请求(真实)?渲染/ }).click();
    await expect(page.getByTestId('render-0')).toHaveClass(/render-succeeded/, { timeout: 60_000 });
    await page.screenshot({ path: `${SHOT_DIR}/desktop-02-workbench.png`, fullPage: true });

    // 第二次实际渲染：制造多候选，验证候选切换与并排对比
    await page.getByRole('button', { name: /请求(真实)?渲染/ }).click();
    await expect(page.getByTestId('render-1')).toHaveClass(/render-succeeded/, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: '并排对比候选' })).toBeVisible();
    await page.getByRole('button', { name: '并排对比候选' }).click();
    await expect(page.getByTestId('candidate-compare')).toBeVisible();
    await expect(page.getByTestId('skin-preview-3d')).toHaveCount(2);
    await page.screenshot({ path: `${SHOT_DIR}/desktop-03-compare.png`, fullPage: true });
    await page.getByRole('button', { name: '返回单候选检查' }).click();

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
    await page.screenshot({ path: `${SHOT_DIR}/desktop-04-preview.png`, fullPage: true });

    // 刷新恢复：会话、队列、候选与 3D 预览从本地快照 + 公共任务查询接口重建
    await page.reload();
    await expect(page.getByTestId('conversation-state')).toContainText('状态：active', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('render-0')).toHaveClass(/render-succeeded/);
    await expect(page.getByTestId('render-1')).toHaveClass(/render-succeeded/);
    await expect(page.getByTestId('candidate-list').locator('li')).toHaveCount(2);
    const restoredPreview = page.getByTestId('skin-preview-3d').first();
    await expect(restoredPreview).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOT_DIR}/desktop-05-restored.png`, fullPage: true });

    await page.getByLabel('成品标题').fill('雪地探险家');
    const confirmButton = page.locator('[data-testid^="confirm-"]').first();
    await confirmButton.click();

    await expect(page.locator('.finalize-status')).toHaveClass(/finalize-succeeded/, {
      timeout: 60_000,
    });
    await expect(page.getByTestId('finalize-done')).toBeVisible();

    // 确认后的下载入口：拿到已通过最终校验的 64×64 PNG
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-final').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    await page.screenshot({ path: `${SHOT_DIR}/desktop-06-finalized.png`, fullPage: true });
  });
});

test.describe('Standalone 移动端全流程', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('移动端创建→渲染→预览→确认→下载', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'MC Plan Skin' })).toBeVisible();
    await expect(page.locator('.badge-ok')).toHaveText('正常', { timeout: 30_000 });
    await page.screenshot({ path: `${SHOT_DIR}/mobile-01-welcome.png`, fullPage: true });

    await page.getByLabel('皮肤描述').fill('移动端验证：戴蓝色围巾的雪地探险家');
    await page.getByRole('button', { name: '开始创作' }).click();

    await expect(page.getByTestId('conversation-state')).toContainText('状态：active', {
      timeout: 20_000,
    });
    await page.screenshot({ path: `${SHOT_DIR}/mobile-02-workbench.png`, fullPage: true });

    await page.getByRole('button', { name: /请求(真实)?渲染/ }).click();
    await expect(page.getByTestId('render-0')).toHaveClass(/render-succeeded/, { timeout: 60_000 });

    const preview = page.getByTestId('skin-preview-3d').first();
    await expect(preview).toBeVisible();
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toHaveAttribute('data-animation', 'walk');

    // 触摸/指针拖拽旋转在窄屏下同样可用
    const bounds = await preview.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) {
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 + 48, bounds.y + bounds.height / 2);
      await page.mouse.up();
    }
    await expect.poll(() => preview.getAttribute('data-yaw')).not.toBe('-28.0');
    await page.screenshot({ path: `${SHOT_DIR}/mobile-03-preview.png`, fullPage: true });

    await page.getByLabel('成品标题').fill('Mobile Explorer');
    const confirmButton = page.locator('[data-testid^="confirm-"]').first();
    await confirmButton.scrollIntoViewIfNeeded();
    await confirmButton.click();

    await expect(page.locator('.finalize-status')).toHaveClass(/finalize-succeeded/, {
      timeout: 60_000,
    });

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-final').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    await page.screenshot({ path: `${SHOT_DIR}/mobile-04-finalized.png`, fullPage: true });
  });
});
