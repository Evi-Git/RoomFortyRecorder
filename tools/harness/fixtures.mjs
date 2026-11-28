// Answers for pullDesk actions that need the outside world (Warcraft Logs,
// Blizzard's journal, Wowhead): small made-up data, never real players. Names
// say "Fixture"; the guild is "Fixture Guild". Without API keys the real
// server answers these with "needs the API keys", so these stand in to let
// the pages render. Everything else goes to the real guild server.
//
//   fixtureAnswer(request, real) -> { ok, data } | undefined
// `real(request)` runs the real PullDesk.handle for actions we only patch.

// ---- helpers ---------------------------------------------------------------
const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};
const HEALER_SPECS = new Set([65, 105, 264, 270, 256, 257, 1468, 1473]);

// Warrior (Arms) cooldowns; other specs reuse them (made-up names below).
const COOLDOWNS = [
  { spellId: 107574, name: 'Fixture Avatar', share: 0.96, medianGap: 90, medianCasts: 3, medianFirst: 2, cooldown: 90 },
  { spellId: 227847, name: 'Fixture Bladestorm', share: 0.88, medianGap: 90, medianCasts: 3, medianFirst: 12, cooldown: 90 },
  { spellId: 262161, name: 'Fixture Warbreaker', share: 0.74, medianGap: 45, medianCasts: 6, medianFirst: 6, cooldown: 45 },
];
const SPELL_NAMES = {
  107574: 'Fixture Avatar',
  227847: 'Fixture Bladestorm',
  262161: 'Fixture Warbreaker',
  1302319: 'Fixture Venom Spray',
  1304424: 'Fixture Extinguish',
};

const castsFor = (rand, duration) => {
  const out = [];
  for (const c of COOLDOWNS) {
    for (let t = c.medianFirst + rand() * 4; t < duration; t += c.medianGap + rand() * 6) {
      out.push([Math.round(t * 10) / 10, c.spellId]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
};

// ---- Top logs --------------------------------------------------------------
const topLogs = () => ({
  configured: true,
  regions: ['world', 'US', 'EU'],
  lastCrawl: Date.UTC(2026, 10, 14, 5, 0, 0),
  status: { running: false, done: 0, total: 0 },
});

const topRankings = (req) => {
  const specId = Number(req.specId);
  const metric = HEALER_SPECS.has(specId) ? 'hps' : 'dps';
  const rand = rng(Number(req.encounterId) * 31 + specId);
  const rows = Array.from({ length: 25 }, (_, i) => {
    const duration = 262 + Math.round(rand() * 70);
    return {
      rank: i + 1,
      name: `Fixture Player ${String(i + 1).padStart(2, '0')}`,
      server: 'Fixture-Realm',
      region: i % 2 ? 'EU' : 'US',
      guild: i % 3 ? 'Fixture Guild' : `Fixture Guild ${i}`,
      amount: Math.round((metric === 'hps' ? 410000 : 640000) * (1 - i * 0.006)),
      duration,
      ilvl: 281 + (i % 4),
      code: `FixtureCode${String(i + 1).padStart(2, '0')}`,
      fight: 1 + (i % 9),
      casts: castsFor(rand, duration),
      phases: [[0, 1], [Math.round(duration * 0.35), 2], [Math.round(duration * 0.7), 3]],
      state: 'ready',
    };
  });
  return {
    encounterId: Number(req.encounterId),
    difficultyId: Number(req.difficultyId),
    specId,
    metric,
    region: req.region || 'world',
    at: Date.UTC(2026, 10, 14, 5, 0, 0),
    rows,
    pending: 0,
    cooldowns: COOLDOWNS,
  };
};

const topTrial = (req) => {
  const rand = rng(String(req.code).length * 977 + Number(req.fight));
  const duration = 281;
  const rate = req.metric === 'hps' ? 410000 : 640000;
  const amounts = [];
  let sum = 0;
  for (let i = 0; i < duration; i += 1) {
    const burst = i % 90 < 20 ? 1.5 : 0.85;
    sum += rate * burst * (0.9 + rand() * 0.2);
    amounts.push(Math.round(sum));
  }
  return {
    state: 'ready',
    track: {
      name: req.name,
      duration,
      amounts,
      casts: castsFor(rand, duration),
      phases: [[0, 1], [98, 2], [196, 3]],
      phaseNames: { 1: 'Fixture Stage One', 2: 'Fixture Stage Two', 3: 'Fixture Stage Three' },
      names: SPELL_NAMES,
      enemy: [[20, 1302319], [75, 1304424], [140, 1302319], [210, 1304424]],
    },
  };
};

// ---- Journal ---------------------------------------------------------------
const ability = (id, title, spellId, text, tags = []) => ({ id, title, text, spellId, tags, depth: 2, children: [] });
const FIXTURE_JOURNAL = (name) => ({
  journalId: 999001,
  name,
  description: `Fixture journal entry for ${name}: made-up text, not Blizzard's.`,
  instance: 'The Fixture Abyss',
  modes: ['heroic', 'mythic'],
  sections: [
    {
      id: 1,
      title: 'Stage One: Fixture Opening',
      text: 'The boss uses its basic fixtures until it reaches 65% health.',
      spellId: null,
      tags: [],
      depth: 1,
      children: [
        ability(11, 'Fixture Venom Spray', 1302319, '', ['deadly']),
        ability(12, 'Fixture Extinguish', 1304424, '', ['mythic']),
      ],
    },
    {
      id: 2,
      title: 'Stage Two: Fixture Finale',
      text: 'Everything speeds up.',
      spellId: null,
      tags: [],
      depth: 1,
      children: [ability(21, 'Fixture Nightfall', 1302727, '', [])],
    },
  ],
});
const FIXTURE_SPELLS = {
  1302319: { name: 'Fixture Venom Spray', text: 'Sprays venom at random raiders for moderate Nature damage. (Fixture text.)', icon: 'inv_misc_questionmark' },
  1304424: { name: 'Fixture Extinguish', text: 'Deals heavy damage to the whole raid. (Fixture text.)', icon: 'inv_misc_questionmark' },
  1302727: { name: 'Fixture Nightfall', text: 'Darkness falls over the room. (Fixture text.)', icon: 'inv_misc_questionmark' },
};

// ---- Talent tree (Logs page, damage prevented) -----------------------------
const talentTree = (req) => ({
  specId: Number(req.specId),
  nodes: {
    1001: [{ rank: 1, options: [{ entryId: 2001, spellId: 990001, name: 'Fixture Resilience', text: 'Reduces damage taken by 3%. (Fixture text.)' }] }],
  },
  // A made-up 5 x 4 class tree and 3 x 3 spec tree (node 1001 is the one
  // with a damage reduction, above); only the layout matters here.
  layout: {
    className: 'Fixture',
    specName: 'Fixture',
    class: Array.from({ length: 20 }, (_, i) => ({
      id: 1001 + i,
      x: (i % 5) * 600,
      y: Math.floor(i / 5) * 600,
      type: i % 3 === 0 ? 'single' : 'PASSIVE',
      maxRank: 1 + (i % 2),
      next: i % 5 < 4 ? [1001 + i + 1] : [],
      entries: [{ entryId: 2001 + i, spellId: 990001 + i, name: i ? `Fixture Talent ${i}` : 'Fixture Resilience' }],
    })),
    spec: Array.from({ length: 9 }, (_, i) => ({
      id: 3001 + i,
      x: (i % 3) * 600,
      y: Math.floor(i / 3) * 600,
      type: 'single',
      maxRank: 1,
      next: [],
      entries: [{ entryId: 4001 + i, spellId: 991001 + i, name: `Fixture Spec Talent ${i}` }],
    })),
    hero: [],
  },
});

// ---- Watched guilds (Dashboard > Compare / Progression) ---------------------
const watched = (state) => {
  const series = (kill) =>
    Array.from({ length: 9 }, (_, i) => ({
      n: i + 1,
      at: Date.UTC(2026, 9, 14 + i, 0, 30, 0),
      night: `2026-10-${14 + i}`,
      percent: Math.max(0, 80 - i * 9),
      kill: kill && i === 8,
    }));
  const boss = (id, name, kill) => ({
    encounterId: id,
    name,
    pulls: 9,
    nights: 3,
    best: kill ? 0 : 12,
    kill: kill ? { pull: 9, at: Date.UTC(2026, 9, 22, 0, 30, 0), night: '2026-10-22' } : null,
    series: series(kill),
  });
  return {
    ...state,
    configured: true,
    settings: {
      ...state.settings,
      guilds: [{ name: 'Fixture Guild', realm: 'Fixture-Realm', region: 'US' }],
    },
    results: {
      zone: { id: 1, name: 'The Fixture Abyss' },
      guilds: [
        {
          name: 'Fixture Guild',
          realm: 'Fixture-Realm',
          region: 'US',
          updatedAt: Date.UTC(2026, 10, 14, 5, 0, 0),
          bosses: { 3492: boss(3492, "Ula'tek", true), 3513: boss(3513, "Kith'ix", false) },
        },
      ],
    },
  };
};

export const fixtureAnswer = async (request, real) => {
  switch (request?.action) {
    case 'topLogs':
      return { ok: true, data: topLogs() };
    case 'topRankings':
      return { ok: true, data: topRankings(request) };
    case 'topTrial':
      return { ok: true, data: topTrial(request) };
    case 'talentTree':
      return { ok: true, data: talentTree(request) };
    case 'journalBoss': {
      const r = await real(request);
      if (!r.ok) return r;
      return {
        ok: true,
        data: {
          ...r.data,
          configured: true,
          error: '',
          journal: FIXTURE_JOURNAL(r.data.encounterName || 'Fixture Boss'),
        },
      };
    }
    case 'journalSpells':
      return { ok: true, data: { spells: FIXTURE_SPELLS, pending: 0 } };
    case 'spellNames': {
      const r = await real(request);
      const names = {};
      for (const id of request.ids ?? []) if (SPELL_NAMES[id]) names[id] = SPELL_NAMES[id];
      return r.ok ? { ok: true, data: { ...r.data, names: { ...names, ...(r.data.names ?? {}) } } } : { ok: true, data: { names } };
    }
    case 'watcher': {
      const r = await real(request);
      return r.ok ? { ok: true, data: watched(r.data) } : r;
    }
    default:
      return undefined;
  }
};
