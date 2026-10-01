import { expect, test } from '@playwright/test';

test('创作首页加载、显示 standalone 模式并连通 API', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MC Plan Skin' })).toBeVisible();
  // Web 通过真实 HTTP 调用 API liveness，等待健康徽章变为“正常”
  await expect(page.locator('.badge-ok')).toHaveText('正常', { timeout: 30_000 });
  await expect(page.getByText('standalone')).toBeVisible();
});
