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
    shows: 'Damage Done',
    continue: true,
    steps: async (t) => tab(t, 'Damage Done'),
  },
  {
    name: 'logs-ulatek-player',
    shows: 'Damage Done: one player drilled into',
    continue: true,
    steps: async (t) => {
      await t.page.locator('table tbody tr').first().click();
      await t.settle(800);
    },
  },
  {
    name: 'logs-ulatek-damage-taken',
    shows: 'Damage Taken',
    continue: true,
    steps: async (t) => tab(t, 'Damage Taken'),
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
      await t.page.getByText('Pull 5', { exact: false }).first().click();
      await t.page.getByText('Pull 3', { exact: false }).first().click({ modifiers: ['Control'] });
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
    shows: 'Analyze tab: a spec with a preset',
    steps: async (t) => {
      await t.nav('Logs');
      await t.logsLoaded();
      await tab(t, 'Analyze');
    },
  },
  {
    name: 'logs-analyze-builder',
    shows: 'Analyze: widget builder open',
    continue: true,
    steps: async (t) => {
      await t.page.getByText(/Add widget|Customi[sz]e|Edit/).first().click();
      await t.settle(800);
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
      await t.settle();
    },
  },
  {
    name: 'settings-game',
    shows: 'Settings > Game tab',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('tab').nth(1).click();
      await t.settle();
    },
  },
  {
    name: 'settings-cloud',
    shows: 'Settings > Cloud tab (signed in, Send my Logs on)',
    continue: true,
    steps: async (t) => {
      await t.page.getByRole('tab').nth(2).click();
      await t.settle();
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
    },
  },
  {
    name: 'fail-server-unreachable',
    shows: 'Guild server unreachable: every pullDesk call answers ECONNREFUSED',
    init: { answers: { pullDesk: { ok: false, error: 'connect ECONNREFUSED' } } },
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
  ].map(([label, key]) => ({
    name: `small-${key}`,
    shows: `${label} at 1100x700`,
    viewport: small,
    steps: async (t) => {
      await t.nav(label);
      await t.settle(1200);
    },
  })),
];
