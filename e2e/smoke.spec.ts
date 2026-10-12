import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const SHOT_DIR = process.env.SKIN_E2E_SHOT_DIR ?? 'test-results/shots';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function assertPng64(bytes: Buffer): void {
  expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  expect(bytes.readUInt32BE(16)).toBe(64);
  expect(bytes.readUInt32BE(20)).toBe(64);
}

async function readConversationId(page: import('@playwright/test').Page): Promise<string> {
  const conversationId = await page.evaluate(() => {
    const raw = window.localStorage.getItem('pixel-foundry-session-v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { conversation?: { conversation_id?: string } };
    return parsed.conversation?.conversation_id ?? null;
  });
  expect(conversationId).toBeTruthy();
  return conversationId as string;
}

/**
 * Standalone 纵向链路（自包含 Fake Provider 栈，公共契约 0.1.0-alpha.1 端点）：
 * 创建 → 渲染 → 3D 候选预览 → 候选对比 → 刷新恢复（详情+消息） → 确认 → 公共端点下载 → 删除。
 * 桌面与移动两个视口各覆盖一次完整流程；截图存 SKIN_E2E_SHOT_DIR（默认 test-results/shots）。
 *
 * SKIN_E2E_PROVIDER=image 时整栈切换为 image-concept 模式（固定概念图 + 固定蓝图
 * fixture 全离线），fake 全量流程跳过，由文末的 image 模式全链冒烟覆盖。
 */
const imageMode = process.env.SKIN_E2E_PROVIDER === 'image';

test.describe('Standalone 桌面全流程', () => {
  test.skip(imageMode, 'image 模式运行时由独立的 image 冒烟覆盖');

  test('创建→调整→对比→预览→刷新恢复→确认→下载→删除', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'MC Plan Skin' })).toBeVisible();
    await expect(page.locator('.badge-ok')).toHaveText('正常', { timeout: 30_000 });
    await page.screenshot({ path: `${SHOT_DIR}/desktop-01-welcome.png`, fullPage: true });

    await page.getByLabel('皮肤描述').fill('一位戴着蓝色围巾的雪地探险家');
    await page.getByRole('button', { name: '开始创作' }).click();

    await expect(page.getByTestId('conversation-state')).toContainText('状态：active', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('message-list')).toContainText('雪地探险家');

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

    // 刷新恢复：会话与消息经公共详情接口重建，任务与候选经本地快照+任务接口重建
    await page.reload();
    await expect(page.getByTestId('conversation-state')).toContainText('状态：active', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('message-list')).toContainText('雪地探险家');
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

    // 公共下载端点：下载事件 + Content-Type + PNG 魔数 + IHDR 64×64
    const downloadUrl = await page.getByTestId('download-final').getAttribute('href');
    expect(downloadUrl).toContain('/api/v1/conversations/');
    const probe = await page.request.get(downloadUrl as string);
    expect(probe.status()).toBe(200);
    expect(probe.headers()['content-type']).toContain('image/png');
    assertPng64(await probe.body());

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-final').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const downloadedBytes = await readFile(downloadedPath as string);
    assertPng64(downloadedBytes);
    await page.screenshot({ path: `${SHOT_DIR}/desktop-06-finalized.png`, fullPage: true });

    // 会话删除：级联行与字节，刷新后不复活
    const conversationId = await readConversationId(page);
    await page.getByTestId('delete-conversation').click();
    await expect(page.getByText('会话与全部候选、成品数据已删除。')).toBeVisible();

    const deletedDetail = await page.request.get(`/api/v1/conversations/${conversationId}`);
    expect(deletedDetail.status()).toBe(404);
    const deletedDownload = await page.request.get(downloadUrl as string);
    expect(deletedDownload.status()).toBe(404);

    await page.reload();
    await expect(page.getByTestId('conversation-state')).toHaveCount(0);
    await expect(page.getByTestId('message-list')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始创作' })).toBeVisible();
  });
});

test.describe('Standalone image 模式全链冒烟（固定概念图 + 固定蓝图 fixture，全离线）', () => {
  test.skip(!imageMode, '仅 SKIN_E2E_PROVIDER=image 运行');

  test('image 徽标→创建→两跳渲染→3D 预览→确认→下载→删除', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'MC Plan Skin' })).toBeVisible();
    await expect(page.locator('.badge-ok')).toHaveText('正常', { timeout: 30_000 });

    // Web 徽标与提示明确区分“真实图像生成”模式
    await expect(page.locator('.provider-chip.provider-image')).toContainText('真实图像生成');
    await page.screenshot({ path: `${SHOT_DIR}/image-01-welcome.png`, fullPage: true });

    await page.getByLabel('皮肤描述').fill('来自冻原的雪地探险家，蓝色围巾');
    await page.getByRole('button', { name: '开始创作' }).click();
    await expect(page.getByTestId('conversation-state')).toContainText('状态：active', {
      timeout: 20_000,
    });
    await expect(page.getByText('真实图像生成已启用')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/image-02-workbench.png`, fullPage: true });

    // 两跳管线（固定概念图 → 固定蓝图 → 确定性渲染）产出的候选同样走全量校验
    await page.getByRole('button', { name: /请求(真实)?渲染/ }).click();
    await expect(page.getByTestId('render-0')).toHaveClass(/render-succeeded/, {
      timeout: 60_000,
    });

    const preview = page.getByTestId('skin-preview-3d').first();
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toHaveAttribute('data-animation', 'walk');
    await expect(page.locator('.workspace-mode.provider-image')).toHaveText('IMAGE PIPELINE');
    await page.screenshot({ path: `${SHOT_DIR}/image-03-preview.png`, fullPage: true });

    await page.getByLabel('成品标题').fill('Concept Bridge Explorer');
    const confirmButton = page.locator('[data-testid^="confirm-"]').first();
    await confirmButton.click();
    await expect(page.locator('.finalize-status')).toHaveClass(/finalize-succeeded/, {
      timeout: 60_000,
    });

    // 公共下载端点：image 模式候选与 fake/llm 同一业务链路（合法 64×64 PNG）
    const downloadUrl = await page.getByTestId('download-final').getAttribute('href');
    expect(downloadUrl).toContain('/api/v1/conversations/');
    const probe = await page.request.get(downloadUrl as string);
    expect(probe.status()).toBe(200);
    expect(probe.headers()['content-type']).toContain('image/png');
    assertPng64(await probe.body());

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-final').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    await page.screenshot({ path: `${SHOT_DIR}/image-04-finalized.png`, fullPage: true });

    // 删除级联与不复活语义与 fake 模式一致
    const conversationId = await readConversationId(page);
    await page.getByTestId('delete-conversation').click();
    await expect(page.getByText('会话与全部候选、成品数据已删除。')).toBeVisible();
    const deletedDetail = await page.request.get(`/api/v1/conversations/${conversationId}`);
    expect(deletedDetail.status()).toBe(404);
    const deletedDownload = await page.request.get(downloadUrl as string);
    expect(deletedDownload.status()).toBe(404);

    await page.reload();
    await expect(page.getByTestId('conversation-state')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始创作' })).toBeVisible();
  });
});

test.describe('Standalone 移动端全流程', () => {
  test.skip(imageMode, 'image 模式运行时由独立的 image 冒烟覆盖');

  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('移动端创建→渲染→预览→确认→下载→删除', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'MC Plan Skin' })).toBeVisible();
    await expect(page.locator('.badge-ok')).toHaveText('正常', { timeout: 30_000 });
    await page.screenshot({ path: `${SHOT_DIR}/mobile-01-welcome.png`, fullPage: true });

    await page.getByLabel('皮肤描述').fill('移动端验证：戴蓝色围巾的雪地探险家');
    await page.getByRole('button', { name: '开始创作' }).click();

    await expect(page.getByTestId('conversation-state')).toContainText('状态：active', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('message-list')).toContainText('雪地探险家');
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

    // 公共下载端点验证（Content-Type + 64×64 PNG）后触发真实下载
    const downloadUrl = await page.getByTestId('download-final').getAttribute('href');
    const probe = await page.request.get(downloadUrl as string);
    expect(probe.status()).toBe(200);
    expect(probe.headers()['content-type']).toContain('image/png');
    assertPng64(await probe.body());

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-final').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    await page.screenshot({ path: `${SHOT_DIR}/mobile-04-finalized.png`, fullPage: true });

    // 删除后详情 404、刷新回到欢迎态（不复活）
    const conversationId = await readConversationId(page);
    await page.getByTestId('delete-conversation').click();
    await expect(page.getByText('会话与全部候选、成品数据已删除。')).toBeVisible();
    const deletedDetail = await page.request.get(`/api/v1/conversations/${conversationId}`);
    expect(deletedDetail.status()).toBe(404);

    await page.reload();
    await expect(page.getByTestId('conversation-state')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始创作' })).toBeVisible();
  });
});
