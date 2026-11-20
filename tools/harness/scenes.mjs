// Declarative scenes for shots.mjs.
//
//   { name, shows, steps: async (t) => {...},
//     init?: { config, answers },   // mock start-up options (see mock.ts)
//     viewport?: { width, height }, // default 1440x900
//     continue?: true,              // keep the page from the previous scene
//     wait?: ms }                   // extra settle time before the shot
//
// A scene without `continue` opens a fresh page (fresh storage, fresh mock).
// `t` is from helpers.mjs: t.nav('Logs'), t.click('Pull 3'), t.text('...'),
// t.answer('pullDesk:serverHealth', {...}), t.emit('updateAvailable'), t.page.
// A scene that throws is recorded as an error and the run goes on.

const OCT21 = '2026-10-21';
const NIGHT_TRIGGER = /Nov 10/;

// Pull desk and Logs pages for the made-up night of 21 Oct (real pull logs).
const openLogsOct21 = async (t) => {
  await t.nav('Logs');
  await t.logsLoaded();
  await t.pickNight(OCT21, 'Nov 10');
  await t.settle();
};

const ulatek = async (t) => {
  await t.page.getByRole('option', { name: "Ula'tek" }).click();
  await t.logsLoaded();
};

const tab = async (t, name) => {
  await t.page.getByText(name, { exact: true }).first().click();
  await t.logsLoaded();
};

const small = { width: 1100, height: 700 };
const smallest = { width: 1024, height: 640 };

// A made-up night for the Dashboard: a kill, two wipes and a reset, with
// deaths, a boss health curve, prep and meters (the test logs have none).
const dashFixture = () => {
  const roster = [
    { guid: 'P-1', name: 'Smoggw', specId: 73, role: 'tank' },
    { guid: 'P-2', name: 'Azraelus', specId: 65, role: 'healer' },
    { guid: 'P-3', name: 'Evipaladin', specId: 70, role: 'dps' },
    { guid: 'P-4', name: 'Milkbagman', specId: 62, role: 'dps' },
  ];
  const night = '2026-10-21';
  const mk = (i, result, bossPercent, duration, deaths, startedAt) => ({
    id: `fx${i}`, encounterId: 3182, encounterName: "Kith'ix", difficultyId: 16, night,
    pullNumber: i, totalPullNumber: i, createdAt: startedAt, startedAt, uploadedBy: 'Shadeaux',
    status: 'done', result, duration, bossPercent, deaths, wipeText: null,
    plan: i === 3 ? { ontime: 3, late: 1, early: 0, missed: 2, dead: 0 } : null,
    avoidableHits: i === 3 ? 6 : 0, error: null,
  });
  const base = Date.parse('2026-10-21T23:00:00');
  const pulls = [
    mk(4, 'kill', 0, 292, 2, base + 3e6),
    mk(3, 'wipe', 38, 159, 5, base + 2e6),
    mk(2, 'wipe', 71, 6, 0, base + 1.5e6),
    mk(1, 'wipe', 55, 201, 3, base + 1e6),
  ];
  const hit = (t, spellName, amount, overkill) => ({ t, spellId: 1, spellName, source: 'Kith\'ix', amount, overkill });
  const report = {
    id: 'fx4', encounterId: 3182, encounterName: "Kith'ix", difficultyId: 16, difficulty: 'Mythic',
    result: 'kill', duration: 292, bossPercent: 0, pullNumber: 4, totalPullNumber: 4,
    startedAt: base + 3e6, uploadedBy: 'Shadeaux', roster,
    bossHpCurve: [[0, 100], [40, 90], [80, 74], [120, 60], [160, 41], [200, 28], [240, 12], [292, 0]],
    deaths: [
      { t: 119, name: 'Smoggw', role: 'tank', killingBlow: hit(119, 'Void Slam', 612000, 88000), lastHits: [hit(118, 'Void Slam', 612000, 88000)],
        available: [{ ability: 'Shield Wall', kind: 'personal', status: 'ready', readyIn: 0, lastUsed: null, usedCount: 0 }, { ability: 'Rallying Cry', kind: 'raid', status: 'ready', readyIn: 0, lastUsed: null, usedCount: 0 }] },
      { t: 203, name: 'Milkbagman', role: 'dps', killingBlow: hit(203, 'Dark Eruption', 240000, 0), lastHits: [], available: [] },
    ],
    defensives: { players: [], raid: [], warlockInRaid: false },
    wipe: null,
    plan: { parsed: 0, phaseSkipped: 0, unmatched: 0, items: [], summary: { ontime: 0, late: 0, early: 0, missed: 0, dead: 0 } },
    avoidable: [
      { name: 'Evipaladin', hits: 3, damage: 90000, bySpell: {}, spells: [{ spellId: 11, spellName: 'Void Pool', hits: 3, damage: 90000 }] },
      { name: 'Milkbagman', hits: 2, damage: 40000, bySpell: {}, spells: [{ spellId: 11, spellName: 'Void Pool', hits: 1, damage: 20000 }, { spellId: 12, spellName: 'Cleave', hits: 1, damage: 20000 }] },
    ],
    prep: {
      players: roster.map((p, i) => ({ name: p.name, specId: p.specId, food: i === 3 ? null : 'Feast', flask: 'Flask', augment: null, vantus: null, weaponOil: null, prepot: true, potsUsed: 1, potsPossible: 1, enchants: [], gems: [], enchantsMissing: 0, gemsMissing: 0 })),
      raidBuffs: [],
    },
  };
  const row = (name, specId, total) => ({ name, specId, total, abilities: [] });
  return {
    'pullDesk:list': { ok: true, data: { pulls } },
    'pullDesk:report': { ok: true, data: report },
    'pullDesk:meters': { ok: true, data: { v: 2, bucketSeconds: 5, duration: 292, damage: roster.map((p, i) => row(p.name, p.specId, 90e6 - i * 12e6)), healing: [], taken: [], mitigation: [] } },
  };
};


export const scenes = [
  // ---- Shell ---------------------------------------------------------------
  {
    name: 'sidebar-expanded',
    shows: 'Start-up view: sidebar expanded, Raids list, recorder waiting for WoW',
    steps: async (t) => t.text('Raids'),
  },
  {
    name: 'sidebar-folded',
    shows: 'Sidebar folded to the icon rail',
    steps: async (t) => {
      await t.page.locator('svg.lucide-panel-left-close').locator('xpath=..').click();
      await t.settle();
    },
  },

  // ---- Recordings ----------------------------------------------------------
  {
    name: 'rec-raids-list',
    shows: 'Recordings > Raids: kills and wipes, disk and cloud',
    steps: async (t) => {
      await t.nav('Raids');
      await t.text("Ula'tek");
    },
  },
  {
    name: 'rec-raids-selected',
    shows: 'A raid recording selected: player (no video file: its own error state), timeline, chat',
    continue: true,
    steps: async (t) => {
      await t.page.locator('tr', { hasText: "Ula'tek" }).first().click();
      await t.settle(800);
    },
  },
  {
    name: 'rec-raids-multiselect',
    shows: 'Raids with three rows selected (Ctrl-click): selection count and the protected, tagged row',
    continue: true,
    steps: async (t) => {
      await t.page.locator('tr', { hasText: "Ula'tek" }).first().click();
      await t.page.locator('tr', { hasText: 'Heroic' }).first().click({ modifiers: ['Control'] });
      await t.page.locator('tr', { hasText: "Kith'ix" }).first().click({ modifiers: ['Control'] });
      await t.settle(600);
    },
  },
  {
    name: 'rec-raids-protected',
    shows: 'Raids sorted by date, oldest first: the protected, tagged Heroic kill with a brass lock',
    steps: async (t) => {
      await t.nav('Raids');
      await t.text("Ula'tek");
      await t.page.getByRole('columnheader', { name: 'Date' }).click();
      await t.settle(800);
      await t.page.locator('tr', { hasText: 'Heroic' }).first().scrollIntoViewIfNeeded();
    },
  },
  {
    name: 'rec-search-dropdown',
    shows: 'Raids with the search suggestions open: the list sits above the sticky table header',
    steps: async (t) => {
      await t.nav('Raids');
      await t.text("Ula'tek");
      await t.page.getByRole('combobox', { name: 'Search boss or player' }).click();
      await t.page.keyboard.type('k');
      await t.settle(600);
    },
  },
  {
    name: 'smallest-tall-player',
    shows: 'Raids: player dragged tall at 1440x900, then the window shrunk to 1024x640 (filter row and table stay on screen)',
    steps: async (t) => {
      await t.nav('Raids');
      await t.text("Ula'tek");
      const grip = t.page.locator('svg.lucide-grip-horizontal').first();
      const box = await grip.boundingBox();
      await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await t.page.mouse.down();
      await t.page.mouse.move(box.x + box.width / 2, box.y + 250, { steps: 10 });
      await t.page.mouse.up();
      await t.settle(500);
      await t.page.setViewportSize({ width: 1024, height: 640 });
      await t.settle(1200);
    },
  },
  {
    name: 'rec-date-picker',
    shows: 'The date filter open (Nov-style range, "Any date" when empty)',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('group', { name: 'Date filter' }).locator('input').click();
      await t.settle(600);
    },
  },
  {
    name: 'rec-mythicplus',
    shows: 'Recordings > Mythic+',
    steps: async (t) => {
      await t.nav('Mythic+');
      await t.text('Windrunner');
    },
  },
  {
    name: 'rec-clips',
    shows: 'Recordings > Clips',
    steps: async (t) => {
      await t.nav('Clips');
      await t.settle();
    },
  },
  {
    name: 'rec-manual',
    shows: 'Recordings > Manual',
    steps: async (t) => {
      await t.nav('Manual');
      await t.settle();
    },
  },
  {
    name: 'rec-empty-category',
    shows: 'Manual with no recordings (empty state)',
    steps: async (t) => {
      await t.emit('setDiskVideos', []);
      await t.emit('setCloudVideos', []);
      await t.nav('Manual');
      await t.settle();
    },
  },
  ...[
    ['Raids', 'raids'],
    ['Mythic+', 'mythicplus'],
    ['Clips', 'clips'],
  ].map(([label, key]) => ({
    name: `rec-small-${key}`,
    shows: `${label} at 1100x700`,
    viewport: small,
    steps: async (t) => {
      await t.nav(label);
      await t.settle(1000);
    },
  })),
  {
    name: 'smallest-mythicplus',
    shows: 'Mythic+ at 1024x640 (filter bar wraps to two rows)',
    viewport: smallest,
    steps: async (t) => {
      await t.nav('Mythic+');
      await t.settle(1200);
    },
  },
  {
    name: 'smallest-clips',
    shows: 'Clips at 1024x640',
    viewport: smallest,
    steps: async (t) => {
      await t.nav('Clips');
      await t.settle(1200);
    },
  },
  {
    name: 'instant-replay',
    shows: 'Instant replay page with a buffer file open (no real video)',
    steps: async (t) => {
      await t.emit('updateInstantReplayState', {
        path: 'D:\\Recordings\\buffer\\replay.mp4',
        category: 'Raids',
        deaths: [],
      });
      await t.nav('Instant Replay');
      await t.settle(800);
    },
  },

  // ---- Watch live ----------------------------------------------------------
  {
    name: 'watch-live-list',
    shows: 'Watch live: two fixture streams',
    steps: async (t) => {
      await t.nav('Watch live');
      await t.text('Fixture-Aldra');
    },
  },
  {
    name: 'watch-live-no-picture',
    shows: 'Opening a stream: no WebRTC server here, so the page shows its own connect error',
    continue: true,
    steps: async (t) => {
      await t.click('Fixture-Aldra', { exact: false });
      await t.text('not running', { timeout: 30000 });
    },
  },

  // ---- Dashboard -----------------------------------------------------------
  {
    name: 'dash-pulls-list',
    shows: 'Dashboard > Pulls, latest night (10 Nov)',
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.text('Kill');
    },
  },
  {
    name: 'dash-pulls-oct21',
    shows: 'Dashboard > Pulls on the 21 Oct night: five Kith\'ix pulls',
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.pickNight(OCT21, 'Nov 10');
      await t.settle(800);
    },
  },
  {
    name: 'dash-pull-report',
    shows: 'A wipe\'s report: deaths, defensives, cooldown plan',
    continue: true,
    steps: async (t) => {
      await t.page.getByText('#3', { exact: false }).first().click();
      await t.settle(800);
    },
  },
  {
    name: 'dash-fixture-report',
    shows: 'Dashboard > Pulls with a made-up night: wipes, a kill, a reset; deaths, boss health, stat tiles',
    init: { answers: dashFixture() },
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.text('Smoggw');
      await t.settle(600);
    },
  },
  {
    name: 'dash-fixture-small',
    shows: 'The made-up night at 1100x700',
    viewport: small,
    init: { answers: dashFixture() },
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.text('Smoggw');
      await t.settle(600);
    },
  },
  {
    name: 'dash-fixture-resets',
    shows: 'Same night with Show resets on; Meters section',
    init: { answers: dashFixture() },
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.text('Smoggw');
      await t.page.getByLabel(/Show resets/).check();
      await t.settle(500);
    },
  },
  {
    name: 'dash-night-summary',
    shows: 'Dashboard > Night summary',
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.click('Night summary');
      await t.settle(1000);
    },
  },
  {
    name: 'dash-progression',
    shows: 'Dashboard > Progression',
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.click('Progression');
      await t.settle(1000);
    },
  },
  {
    name: 'dash-reclears',
    shows: 'Dashboard > Reclears',
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.click('Reclears');
      await t.settle(1000);
    },
  },
  {
    name: 'dash-compare',
    shows: 'Dashboard > Compare',
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.click('Compare');
      await t.settle(1000);
    },
  },
  {
    name: 'dash-journal',
    shows: 'Dashboard > Journal (fixture boss)',
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.click('Journal');
      await t.settle(1000);
    },
  },

  // ---- Logs ----------------------------------------------------------------
  {
    name: 'logs-night-picker',
    shows: 'Logs: night picker open on October',
    steps: async (t) => {
      await t.nav('Logs');
      await t.logsLoaded();
      await t.page.getByText('Nov 10').first().click();
      await t.page.locator('[role="dialog"] button').first().click();
      await t.settle();
    },
  },
  {
    name: 'logs-boss-strip',
    shows: 'Logs on 21 Oct: boss strip (K, U), five Kith\'ix pulls',
    continue: true,
    steps: async (t) => {
      await t.page.locator('[role="dialog"] >> text=/^21$/').first().click();
      await t.logsLoaded();
    },
  },
  {
    name: 'logs-ulatek-summary',
    shows: "Ula'tek kill: Summary tab",
    continue: true,
    steps: async (t) => {
      await ulatek(t);
      await tab(t, 'Summary');
    },
  },
  {
    name: 'logs-ulatek-damage-done',
    shows: 'Damage done',
    continue: true,
    steps: async (t) => tab(t, 'Damage done'),
  },
  {
    name: 'logs-ulatek-player',
    shows: 'Damage Done: one player drilled into (their abilities)',
    continue: true,
    steps: async (t) => {
      await t.page.locator('table tbody tr').first().getByRole('button').first().click();
      await t.settle(800);
    },
  },
  {
    name: 'logs-ulatek-damage-taken',
    shows: 'Damage taken',
    continue: true,
    steps: async (t) => tab(t, 'Damage taken'),
  },
  {
    name: 'logs-ulatek-healing',
    shows: 'Healing',
    continue: true,
    steps: async (t) => tab(t, 'Healing'),
  },
  {
    name: 'logs-ulatek-prevented',
    shows: 'Healing with Mitigations on (damage prevented)',
    continue: true,
    steps: async (t) => {
      await t.page.getByText('Mitigations', { exact: true }).first().click();
      await t.settle(1500);
    },
  },
  {
    name: 'logs-ulatek-buffs',
    shows: 'Buffs',
    continue: true,
    steps: async (t) => tab(t, 'Buffs'),
  },
  {
    name: 'logs-ulatek-debuffs',
    shows: 'Debuffs',
    continue: true,
    steps: async (t) => tab(t, 'Debuffs'),
  },
  {
    name: 'logs-ulatek-deaths',
    shows: 'Deaths',
    continue: true,
    steps: async (t) => tab(t, 'Deaths'),
  },
  {
    name: 'logs-ulatek-death-recap',
    shows: 'Deaths with a recap open',
    continue: true,
    steps: async (t) => {
      await t.page.locator('table tbody tr').first().click();
      await t.settle(800);
    },
  },
  {
    name: 'logs-ulatek-interrupts',
    shows: 'Interrupts',
    continue: true,
    steps: async (t) => tab(t, 'Interrupts'),
  },
  {
    name: 'logs-ulatek-dispels',
    shows: 'Dispels',
    continue: true,
    steps: async (t) => tab(t, 'Dispels'),
  },
  {
    name: 'logs-ulatek-resources',
    shows: 'Resources',
    continue: true,
    steps: async (t) => tab(t, 'Resources'),
  },
  {
    name: 'logs-ulatek-casts',
    shows: 'Casts',
    continue: true,
    steps: async (t) => tab(t, 'Casts'),
  },
  {
    name: 'logs-ulatek-timelines',
    shows: 'Timelines view',
    continue: true,
    steps: async (t) => {
      await t.page.getByText('Timelines', { exact: true }).first().click();
      await t.settle(1500);
    },
  },
  {
    name: 'logs-ulatek-events',
    shows: 'Events view',
    continue: true,
    steps: async (t) => {
      await t.page.getByText('Events', { exact: true }).first().click();
      await t.settle(1500);
    },
  },
  {
    name: 'logs-ulatek-queries',
    shows: 'Queries view',
    continue: true,
    steps: async (t) => {
      await t.page.getByText('Queries', { exact: true }).first().click();
      await t.settle(1000);
    },
  },
  {
    name: 'logs-ulatek-enemies',
    shows: 'Enemies side (Damage Taken)',
    continue: true,
    steps: async (t) => {
      await t.page.getByText('Tables', { exact: true }).first().click();
      await t.page.getByRole('button', { name: 'Enemies', exact: true }).first().click();
      await t.logsLoaded();
    },
  },
  {
    name: 'logs-two-pulls',
    shows: "Two Kith'ix pulls picked (added up)",
    steps: async (t) => {
      await openLogsOct21(t);
      await t.page.getByRole('option', { name: "Kith'ix" }).click();
      await t.logsLoaded();
      await t.page.getByRole('button', { name: /^Pull 5,/ }).click();
      await t.page.getByRole('button', { name: /^Pull 3,/ }).click({ modifiers: ['Control'] });
      await t.logsLoaded();
    },
  },
  {
    name: 'logs-compare',
    shows: 'Compare side by side',
    continue: true,
    steps: async (t) => {
      await t.click('Compare side by side');
      await t.logsLoaded();
    },
  },
  {
    name: 'logs-analyze',
    shows: 'Analyze tab: the starting widgets for a spec',
    steps: async (t) => {
      await t.nav('Logs');
      await t.logsLoaded();
      await tab(t, 'Analyze');
    },
  },
  {
    name: 'logs-analyze-preset',
    shows: "Analyze: after 'Share as guild preset' the header says the guild's preset (undone afterwards)",
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('button', { name: /Share as guild preset/ }).click();
      await t.text('Shared with the guild');
      await t.settle(800);
    },
    after: async (page) => {
      await page.getByRole('button', { name: /Remove guild preset/ }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'logs-analyze-builder',
    shows: 'Analyze: the widget builder open',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('button', { name: /Add widget/ }).first().click();
      const builder = t.page.locator('aside').last();
      await builder.waitFor({ timeout: 10000 });
      await builder.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await t.settle(600);
    },
  },

  // ---- Top logs ------------------------------------------------------------
  {
    name: 'toplogs',
    shows: 'Top logs (fixture rankings, "Fixture Guild")',
    steps: async (t) => {
      await t.nav('Top logs');
      await t.settle(1500);
    },
  },
  {
    name: 'toplogs-time-trial',
    shows: 'Time trial: a fixture track against our pull',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('button', { name: /Race me/ }).first().click();
      await t.page.waitForTimeout(2500);
      await t.settle(1500);
    },
  },

  // ---- Settings ------------------------------------------------------------
  {
    name: 'settings-application',
    shows: 'Settings > Application tab',
    steps: async (t) => {
      await t.nav('General');
      await t.page.getByRole('tab', { name: 'Application', exact: true }).click();
      await t.settle();
    },
  },
  {
    name: 'settings-game',
    shows: 'Settings > Game tab',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('tab', { name: 'Game', exact: true }).click();
      await t.settle();
    },
  },
  {
    name: 'settings-cloud',
    shows: 'Settings > Cloud tab (signed in, Send my Logs on)',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('tab', { name: 'Cloud', exact: true }).click();
      await t.settle();
    },
  },
  {
    name: 'settings-cloud-lower',
    shows: 'Settings > Cloud tab scrolled to the bottom (filters, character filter)',
    continue: true,
    steps: async (t) => {
      await t.page.evaluate(() => {
        document
          .querySelectorAll('[data-radix-scroll-area-viewport]')
          .forEach((e) => { e.scrollTop = e.scrollHeight; });
      });
      await t.settle(400);
    },
  },
  {
    name: 'settings-game-lower',
    shows: 'Settings > Game tab scrolled to the bottom (Mythic+, manual recording)',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('tab', { name: 'Game', exact: true }).click();
      await t.page.evaluate(() => {
        document
          .querySelectorAll('[data-radix-scroll-area-viewport]')
          .forEach((e) => { e.scrollTop = e.scrollHeight; });
      });
      await t.settle(400);
    },
  },
  {
    name: 'scene-editor',
    shows: 'Scene editor page (recorder preview is native: blank here)',
    steps: async (t) => {
      await t.nav('Scene');
      await t.settle(800);
    },
  },
  {
    name: 'admin',
    shows: 'Admin / permissions (owner)',
    steps: async (t) => {
      await t.nav('Admin');
      await t.settle(1000);
    },
  },
  {
    name: 'admin-members',
    shows: 'Admin > Members list (owner row and a signed-out row disabled)',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('heading', { name: 'Members' }).scrollIntoViewIfNeeded();
      await t.settle();
    },
  },
  {
    name: 'admin-sign-out-confirm',
    shows: 'Admin > Members: confirm signing a member out',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('row', { name: /Fixture Raider/ }).getByRole('button', { name: 'Sign out' }).click();
      await t.text('Sign out Fixture Raider?');
      await t.settle();
    },
  },

  // ---- Dialogs and notices -------------------------------------------------
  {
    name: 'bug-report-dialog',
    shows: 'Bug report dialog',
    steps: async (t) => {
      await t.page.locator('svg.lucide-bug').locator('xpath=..').click();
      await t.settle();
    },
  },
  {
    name: 'diagnostics-dialog',
    shows: 'Diagnostics (log files) dialog',
    steps: async (t) => {
      await t.page.locator('svg.lucide-file-text').locator('xpath=..').click();
      await t.settle();
    },
  },
  {
    name: 'update-notifier',
    shows: 'An update downloaded: toast and sidebar button',
    steps: async (t) => {
      await t.emit('updateStatus', { state: 'ready', version: '1.9.126' });
      await t.emit('updateAvailable');
      await t.text('update', { timeout: 10000 });
    },
  },

  // ---- Failure variants ----------------------------------------------------
  {
    name: 'fail-signed-out',
    shows: 'Signed out: Dashboard says to sign in',
    init: {
      config: { cloudSessionToken: '', cloudDiscordName: '' },
      answers: {
        pullDesk: { ok: false, signedOut: true, error: 'Sign in with Discord in Cloud settings to use the pull desk.' },
        liveListStreams: { allowed: false, signedIn: false, streams: [] },
      },
    },
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.settle(1000);
      await t.page.getByText('Cloud:').hover();
      await t.settle(800);
    },
  },
  {
    name: 'status-offline',
    shows: 'Sidebar card: guild server unreachable, retrying with a countdown',
    init: {
      signIn: { state: 'offline', attempt: 2, nextRetryIn: 25000 },
    },
    steps: async (t) => {
      await t.settle(500);
      await t.page.getByText('Cloud:').hover();
      await t.settle(800);
    },
  },
  {
    name: 'status-expired',
    shows: 'Sidebar card: sign-in expired, with the server reason',
    init: {
      signIn: { state: 'expired', reason: 'Invalid or expired Discord session' },
    },
    steps: async (t) => {
      await t.page.getByText('Cloud:').hover();
      await t.settle(800);
    },
  },
  {
    name: 'status-refused',
    shows: 'Sidebar card: signed in but not allowed (role check)',
    init: {
      signIn: { state: 'refused', reason: 'You no longer have a Room Forty raider role.' },
    },
    steps: async (t) => {
      await t.page.getByText('Cloud:').hover();
      await t.settle(800);
    },
  },
  {
    name: 'status-connecting',
    shows: 'Sidebar card: checking the sign-in',
    init: { signIn: { state: 'connecting' } },
    steps: async (t) => {
      await t.settle(500);
    },
  },
  {
    name: 'fail-server-unreachable',
    shows: 'Guild server unreachable: every pullDesk call answers ECONNREFUSED',
    init: {
      signIn: { state: 'offline', attempt: 1, nextRetryIn: 25000 },
      answers: { pullDesk: { ok: false, error: 'connect ECONNREFUSED' } },
    },
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.settle(1000);
    },
  },
  {
    name: 'fail-server-unreachable-logs',
    shows: 'Guild server unreachable: Logs page',
    init: { answers: { pullDesk: { ok: false, error: 'connect ECONNREFUSED' } } },
    steps: async (t) => {
      await t.nav('Logs');
      await t.settle(1000);
    },
  },
  {
    name: 'fail-server-older',
    shows: 'Guild server older than the app: update card bottom right',
    init: { answers: { 'pullDesk:serverHealth': { ok: true, data: { server: '1.9.100', app: '1.9.125' } } } },
    steps: async (t) => {
      await t.text('guild server needs an update');
    },
  },
  {
    name: 'fail-empty-night',
    shows: 'Dashboard with no pulls at all',
    init: {
      answers: {
        'pullDesk:list': { ok: true, data: { pulls: [] } },
        'pullDesk:nights': { ok: true, data: { nights: [] } },
      },
    },
    steps: async (t) => {
      await t.nav('Dashboard');
      await t.settle(1000);
    },
  },
  {
    name: 'fail-no-full-log',
    shows: 'Logs for a pull whose full log was never uploaded',
    init: {
      answers: { 'pullDesk:fullLog': { ok: false, error: 'The guild server said no (404).' } },
    },
    steps: async (t) => {
      await t.nav('Logs');
      await t.settle(1500);
    },
  },

  // ---- Small window (1100x700) --------------------------------------------
  ...[
    ['Raids', 'raids'],
    ['Dashboard', 'dashboard'],
    ['Logs', 'logs'],
    ['Top logs', 'toplogs'],
    ['General', 'settings'],
    ['Watch live', 'watch-live'],
  ].flatMap(([label, key]) => [
    {
      name: `small-${key}`,
      shows: `${label} at 1100x700`,
      viewport: small,
      steps: async (t) => {
        await t.nav(label);
        await t.settle(1200);
      },
    },
    // The other two Settings tabs, straight after the first one.
    ...(key === 'settings'
      ? [
          ['Game', 'game'],
          ['Cloud', 'cloud'],
        ].map(([tabLabel, tabKey]) => ({
          name: `small-settings-${tabKey}`,
          shows: `Settings > ${tabLabel} tab at 1100x700`,
          viewport: small,
          continue: true,
          steps: async (t) => {
            await t.page
              .getByRole('tab', { name: tabLabel, exact: true })
              .click();
            await t.settle(800);
          },
        }))
      : []),
  ]),

  // ---- Smallest window (1024x640, the app's minimum) ----------------------
  ...[
    ['Raids', 'raids'],
    ['Dashboard', 'dashboard'],
    ['Logs', 'logs'],
    ['General', 'settings'],
  ].map(([label, key]) => ({
    name: `smallest-${key}`,
    shows: `${label} at 1024x640`,
    viewport: smallest,
    steps: async (t) => {
      await t.nav(label);
      await t.settle(1200);
    },
  })),
  // Unfolded at 1024x640: the user's own choice sticks at this width.
  ...[
    ['Raids', 'raids'],
    ['Mythic+', 'mythicplus'],
  ].map(([label, key]) => ({
    name: `smallest-unfolded-${key}`,
    shows: `${label} at 1024x640 with the sidebar unfolded`,
    viewport: smallest,
    steps: async (t) => {
      await t.page.locator('svg.lucide-panel-left-open').locator('xpath=..').click();
      await t.settle();
      await t.nav(label);
      await t.settle(1200);
    },
  })),
  {
    name: 'smallest-then-wide-raids',
    shows: 'Raids after a narrow moment, back at 1440x900: the player is 500 again',
    viewport: smallest,
    steps: async (t) => {
      await t.nav('Raids');
      await t.settle(800);
      await t.page.setViewportSize({ width: 1440, height: 900 });
      await t.settle(1200);
    },
  },
];
