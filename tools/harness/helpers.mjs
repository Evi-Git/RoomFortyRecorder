// Helpers handed to scene steps (see scenes.mjs). All waits are on visible
// text or data-state, not sleeps.
const T = 20000;

export const makeHelpers = (page) => {
  const sidebar = () => page.locator('div.shrink-0[class*="border-card/60"]').first();
  const h = {
    page,
    /** Click the first visible element with exactly this text. */
    async click(text, opts = {}) {
      const root = opts.in ? page.locator(opts.in) : page;
      const loc = typeof text === 'string' ? root.getByText(text, { exact: opts.exact ?? true }) : root.getByText(text);
      await loc.nth(opts.nth ?? 0).click({ timeout: opts.timeout ?? T });
      await h.settle();
    },
    /** Click a sidebar item by its visible text. */
    async nav(text) {
      // Menu items are role=button; their name can carry a badge ("Raids 7").
      const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await sidebar().getByRole('button', { name: new RegExp(`^${esc}( |$)`) }).first().click({ timeout: T });
      await h.settle();
    },
    async role(role, name, opts = {}) {
      await page.getByRole(role, { name, exact: opts.exact ?? true }).nth(opts.nth ?? 0).click({ timeout: T });
      await h.settle();
    },
    async text(text, opts = {}) {
      await page.getByText(text, { exact: opts.exact ?? false }).first().waitFor({ timeout: opts.timeout ?? T });
    },
    async gone(text, opts = {}) {
      await page.getByText(text, { exact: false }).first().waitFor({ state: 'hidden', timeout: opts.timeout ?? T });
    },
    /** Wait until nothing is loading, then let the layout settle. */
    async settle(ms = 350) {
      await page.waitForTimeout(100);
      await page
        .locator('[data-state="loading"]:visible')
        .first()
        .waitFor({ state: 'hidden', timeout: 120000 })
        .catch(() => {});
      await page.waitForTimeout(ms);
    },
    /** Wait for the Logs explorer to finish loading a pull. */
    async logsLoaded() {
      await h.settle(100);
      // A table, or an empty/failed state; some tabs show neither (charts).
      await page
        .waitForSelector('table tbody tr, [data-state="failed"], [data-state="empty"]', { timeout: 8000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    },
    /** Pick a night in the (open or closed) calendar popover: 'YYYY-MM-DD'. */
    async pickNight(iso, trigger) {
      const [y, m, d] = iso.split('-').map(Number);
      await page.getByText(trigger, { exact: false }).first().click({ timeout: T });
      const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
      for (let i = 0; i < 24; i++) {
        if (await page.getByText(`${month} ${y}`, { exact: true }).first().isVisible().catch(() => false)) break;
        const shown = await page.locator('[role="dialog"]').locator('text=/^[A-Z][a-z]+ \\d{4}$/').first().innerText();
        const cur = new Date(`${shown} 1 UTC`);
        const back = cur.getTime() > Date.UTC(y, m - 1, 1);
        // The month arrows flank the heading: first and second buttons in the popover.
        const arrows = page.locator('[role="dialog"] button');
        await arrows.nth(back ? 0 : 1).click();
        await page.waitForTimeout(100);
      }
      await page.locator(`[role="dialog"] >> text=/^${d}$/`).first().click({ timeout: T });
      await page.waitForTimeout(500);
    },
    async key(k) {
      await page.keyboard.press(k);
      await h.settle(200);
    },
    /** Push a state change as the main process would. */
    emit: (channel, ...args) => page.evaluate(([c, a]) => window.__harness.emit(c, ...a), [channel, args]),
    /** Override a mock answer with a JSON value (channel or 'pullDesk:action'). */
    answer: (key, value) => page.evaluate(([k, v]) => window.__harness.answer(k, v), [key, value]),
  };
  return h;
};
