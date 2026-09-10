import { expect, test, type Page } from '@playwright/test'

/** Spec sizes from issue #6. Compose carries the widest toolbar, so it is the worst case. */
const FULL = { width: 1024, height: 700 }
const COMPACT = { width: 768, height: 600 }

const SLOTS = '[data-project-chip-slot],[data-mode-switcher-slot],[data-toolbar-slot]'

/**
 * Visible is not the same as reachable. The top row stacks three absolutely
 * positioned slots, so one of them can paint over another's buttons and the
 * control is dead while every visibility assertion still passes — that is how
 * the Pen button ended up unclickable at 1024×700.
 */
async function coveredControls(page: Page) {
  return page.evaluate((slots) => {
    const covered: { name: string; by: string }[] = []
    for (const root of document.querySelectorAll(slots)) {
      for (const el of root.querySelectorAll('button, select')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (hit && (el === hit || el.contains(hit))) continue
        const owner = hit?.closest(slots)
        covered.push({
          name: el.getAttribute('title') ?? el.textContent?.trim() ?? el.tagName,
          by:
            [...(owner?.attributes ?? [])].find((a) => a.name.startsWith('data-'))?.name ??
            hit?.tagName ??
            'nothing',
        })
      }
    }
    return covered
  }, SLOTS)
}

async function openCompose(page: Page) {
  await page.goto('/#/build')
  await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async () => {
    const mod = await import('/src/state/useEditorStore.ts')
    mod.useEditorStore.getState().setWorkspaceMode('compose')
  })
  await page.waitForTimeout(500)
}

test.describe('top row controls stay reachable', () => {
  test('every top-row control is hit-testable at full 1024×700', async ({ page }) => {
    await page.setViewportSize(FULL)
    await openCompose(page)
    expect(await coveredControls(page)).toEqual([])
  })

  test('every top-row control is hit-testable at compact 768×600', async ({ page }) => {
    await page.setViewportSize(COMPACT)
    await openCompose(page)
    expect(await coveredControls(page)).toEqual([])
  })

  test('the Pen and the mode switcher survive an open Outliner at 1024×700', async ({ page }) => {
    await page.setViewportSize(FULL)
    await openCompose(page)
    await page.evaluate(async () => {
      const mod = await import('/src/state/useEditorStore.ts')
      mod.useEditorStore.getState().setShowOutliner(true)
    })
    await page.waitForTimeout(500)
    expect(await coveredControls(page)).toEqual([])
  })
})
