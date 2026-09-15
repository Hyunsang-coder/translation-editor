import { expect, test, type Page } from '@playwright/test';
import { injectTauriMockWithProject } from './tauri-mock';

function paragraphs(
  prefix: string,
  language: 'source' | 'target',
  count = 36,
): string {
  return Array.from({ length: count }, (_, index) => {
    const unit = index + 1;
    const text = language === 'source'
      ? `${prefix} source paragraph ${unit}. This is deliberately long enough to wrap onto multiple lines in the editor panel.`
      : `${prefix} 번역 문단 ${unit}입니다. 에디터 패널에서 여러 줄로 줄바꿈될 만큼 충분히 긴 번역문입니다.`;
    return `<p data-translation-unit-id="unit-${unit}">${text}</p>`;
  }).join('');
}

async function seed(page: Page): Promise<void> {
  const now = Date.now();
  await injectTauriMockWithProject(page, {
    id: 'panel-sync-project',
    metadata: {
      title: 'Panel Sync Project',
      domain: 'technical',
      targetLanguage: 'Korean',
      createdAt: now,
      updatedAt: now,
      settings: {
        strictnessLevel: 0.5,
        autoSave: true,
        autoSaveInterval: 5000,
        theme: 'system',
      },
    },
    segments: [{
      groupId: 'segment-1',
      sourceIds: ['source-block'],
      targetIds: ['target-block'],
      isAligned: true,
      order: 0,
    }],
    blocks: {
      'source-block': {
        id: 'source-block',
        type: 'source',
        content: paragraphs('Panel sync', 'source'),
        hash: '',
        metadata: { createdAt: now, updatedAt: now, tags: [] },
      },
      'target-block': {
        id: 'target-block',
        type: 'target',
        content: paragraphs('패널 동기화', 'target'),
        hash: '',
        metadata: { createdAt: now, updatedAt: now, tags: [] },
      },
    },
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

async function panelWidths(page: Page): Promise<{ source: number; target: number }> {
  return page.evaluate(() => {
    const source = document.querySelector("[data-testid='source-editor']")?.getBoundingClientRect().width ?? 0;
    const target = document.querySelector("[data-testid='target-editor']")?.getBoundingClientRect().width ?? 0;
    return { source, target };
  });
}

async function dragResizeHandle(page: Page, deltaX: number): Promise<void> {
  const handle = page.getByTestId('editor-panel-resize-handle');
  const box = await handle.boundingBox();
  if (!box) throw new Error('Panel resize handle is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function toggleCheckbox(
  page: Page,
  testId: 'editor-equal-widths-checkbox' | 'editor-scroll-sync-checkbox',
): Promise<void> {
  await page.getByTestId(testId).evaluate((element) => {
    (element as HTMLInputElement).click();
  });
}

test.describe('Editor panel synchronization preferences', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
  });

  test('같은 너비를 켜면 50:50으로 잠기고 끄면 마지막 수동 비율로 복원한다', async ({ page }) => {
    const equalWidths = page.getByTestId('editor-equal-widths-checkbox');
    await expect(equalWidths).not.toBeChecked();

    await dragResizeHandle(page, 120);
    const resized = await panelWidths(page);
    expect(Math.abs(resized.source - resized.target)).toBeGreaterThan(80);

    await toggleCheckbox(page, 'editor-equal-widths-checkbox');
    await expect(equalWidths).toBeChecked();
    await expect.poll(async () => {
      const widths = await panelWidths(page);
      return Math.abs(widths.source - widths.target);
    }).toBeLessThanOrEqual(2);

    // 잠금 중에는 separator를 드래그해도 폭이 바뀌지 않는다.
    const lockedBefore = await panelWidths(page);
    await dragResizeHandle(page, -100);
    const lockedAfter = await panelWidths(page);
    expect(Math.abs(lockedAfter.source - lockedBefore.source)).toBeLessThanOrEqual(2);

    await toggleCheckbox(page, 'editor-equal-widths-checkbox');
    await expect(equalWidths).not.toBeChecked();
    await expect.poll(async () => {
      const widths = await panelWidths(page);
      return Math.abs(widths.source - widths.target);
    }).toBeGreaterThan(80);
  });

  test('원문을 스크롤하면 대응 번역 문단을 같은 화면 높이로 맞춘다', async ({ page }) => {
    const scrollSync = page.getByTestId('editor-scroll-sync-checkbox');
    await toggleCheckbox(page, 'editor-scroll-sync-checkbox');
    await expect(scrollSync).toBeChecked();

    await page.locator("[data-testid='source-editor'] .ProseMirror").evaluate((element) => {
      const container = element as HTMLElement;
      const anchor = container.querySelector<HTMLElement>('[data-translation-unit-id="unit-20"]');
      if (!anchor) throw new Error('Source anchor not found');
      const containerRect = container.getBoundingClientRect();
      container.scrollTop += anchor.getBoundingClientRect().top - containerRect.top - 24;
      container.dispatchEvent(new Event('scroll'));
    });

    await expect.poll(async () => page.evaluate(() => {
      const source = document.querySelector<HTMLElement>("[data-testid='source-editor'] .ProseMirror");
      const target = document.querySelector<HTMLElement>("[data-testid='target-editor'] .ProseMirror");
      if (!source || !target) return null;
      const sourceRect = source.getBoundingClientRect();
      const sourceUnit = Array.from(
        source.querySelectorAll<HTMLElement>('[data-translation-unit-id]'),
      ).find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > sourceRect.top && rect.top < sourceRect.bottom;
      });
      const id = sourceUnit?.getAttribute('data-translation-unit-id');
      const targetUnit = id
        ? Array.from(target.querySelectorAll<HTMLElement>('[data-translation-unit-id]')).find(
          (element) => element.getAttribute('data-translation-unit-id') === id,
        )
        : null;
      if (!sourceUnit || !targetUnit) return null;
      return Math.abs(
        (sourceUnit.getBoundingClientRect().top - sourceRect.top)
        - (targetUnit.getBoundingClientRect().top - target.getBoundingClientRect().top),
      );
    })).toBeLessThanOrEqual(3);
  });
});
