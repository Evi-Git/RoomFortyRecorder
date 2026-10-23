// Pull desk summaries: a raid night per boss, and a boss across nights.
// Pure functions over stored reports (see pulldesk-analyze.mjs), so they can
// be tested without a server.
//
// Input everywhere: [{ summary, report }] where `summary` is the pull's index
// entry (night, pullNumber, totalPullNumber, result, bossPercent, duration,
// startedAt) and `report` its analyzed report (may be null if not ready).

// Count only the first N deaths of a pull against people, like the
// recruiting page: later deaths are usually the wipe snowballing.
const EARLY_DEATHS = 2;

const round1 = (v) => Math.round(v * 10) / 10;
const median = (values) => {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Why a pull ended, in a few words, or null for a kill. */
export const wipeCause = (summary, report) => {
  if (summary.result === 'kill' || report?.result === 'kill') return null;
  if (!report) return 'Not analyzed';
  const mass = report.wipe?.massDeath;
  if (mass?.spellName) return `${mass.spellName} (raid-wide)`;
  const first = report.deaths?.[0];
  if (first?.killingBlow?.spellName) return first.killingBlow.spellName;
  if (report.deaths?.length) return 'Unknown';
  return (summary.duration || report.duration || 0) < 20 ? 'Reset' : 'No deaths';
};

const RAID_WIDE = ' (raid-wide)';

/** Spell IDs by ability name, from killing blows and raid-wide wipes. */
const spellIdsOf = (pulls) => {
  const ids = {};
  pulls.forEach(({ report }) => {
    (report?.deaths || []).forEach((d) => {
      const kb = d.killingBlow;
      if (kb?.spellName && kb.spellId && !ids[kb.spellName]) ids[kb.spellName] = kb.spellId;
    });
    const mass = report?.wipe?.massDeath;
    if (mass?.spellName && mass.spellId && !ids[mass.spellName]) ids[mass.spellName] = mass.spellId;
  });
  return ids;
};

/**
 * Per ability (by name): how many pulls it ended, how many raiders it
 * killed, and how many of those were early deaths. For the Journal view.
 */
export const abilityStats = (pulls) => {
  const stats = {};
  const entry = (name, spellId) => {
    stats[name] ??= { name, spellId: spellId || null, wipes: 0, deaths: 0, earlyDeaths: 0 };
    if (!stats[name].spellId && spellId) stats[name].spellId = spellId;
    return stats[name];
  };
  pulls.forEach(({ summary, report }) => {
    if (!report) return;
    (report.deaths || []).forEach((d, i) => {
      const kb = d.killingBlow;
      if (!kb?.spellName) return;
      const e = entry(kb.spellName, kb.spellId);
      e.deaths += 1;
      if (i < EARLY_DEATHS) e.earlyDeaths += 1;
    });
    const cause = wipeCause(summary, report);
    if (cause && cause !== 'Reset' && cause !== 'No deaths' && cause !== 'Unknown' && cause !== 'Not analyzed') {
      const name = cause.endsWith(RAID_WIDE) ? cause.slice(0, -RAID_WIDE.length) : cause;
      entry(name, report.wipe?.massDeath?.spellId).wipes += 1;
    }
  });
  return Object.values(stats).sort((a, b) => b.wipes - a.wipes || b.deaths - a.deaths);
};

const countBy = (items) => {
  const counts = new Map();
  items.filter(Boolean).forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

/**
 * One boss on one night (or any set of pulls).
 * @param {{ summary: object, report: object|null }[]} pulls
 */
export const summarizePulls = (pulls) => {
  const ordered = [...pulls].sort((a, b) => (a.summary.startedAt || a.summary.createdAt || 0) - (b.summary.startedAt || b.summary.createdAt || 0));
  const first = ordered[0]?.summary || {};
  const percents = ordered
    .filter((p) => p.summary.result !== 'kill')
    .map((p) => p.summary.bossPercent)
    .filter((v) => typeof v === 'number');
  const kills = ordered.filter((p) => p.summary.result === 'kill').length;
  const durations = ordered.map((p) => p.summary.duration).filter((v) => typeof v === 'number');

  const raiders = new Map();
  const raider = (name, role) => {
    if (!raiders.has(name)) {
      raiders.set(name, {
        name,
        role: role || '',
        pulls: 0,
        deaths: 0,
        earlyDeaths: 0,
        firstDeaths: 0,
        planChecked: 0,
        planMissed: 0,
        planOff: 0,
        avoidableHits: 0,
        avoidableDamage: 0,
        defensives: 0,
        potions: 0,
        healthstones: 0,
        earlyDeathCauses: {},
      });
    }
    const r = raiders.get(name);
    if (!r.role && role) r.role = role;
    return r;
  };

  ordered.forEach(({ report }) => {
    if (!report) return;
    (report.roster || []).forEach((p) => {
      if (p.specId > 0 || !report.roster.some((x) => x.specId > 0)) raider(p.name, p.role).pulls += 1;
    });
    (report.deaths || []).forEach((death, i) => {
      const r = raider(death.name, death.role);
      r.deaths += 1;
      if (i === 0) r.firstDeaths += 1;
      if (i < EARLY_DEATHS) {
        r.earlyDeaths += 1;
        const cause = death.killingBlow?.spellName || 'Unknown';
        r.earlyDeathCauses[cause] = (r.earlyDeathCauses[cause] || 0) + 1;
      }
    });
    (report.plan?.items || []).forEach((item) => {
      if (item.status === 'dead') return;
      const r = raider(item.name);
      r.planChecked += 1;
      if (item.status === 'missed') r.planMissed += 1;
      if (item.status === 'late' || item.status === 'early') r.planOff += 1;
    });
    (report.avoidable || []).forEach((row) => {
      const r = raider(row.name);
      r.avoidableHits += row.hits || 0;
      r.avoidableDamage += row.damage || 0;
    });
    (report.defensives?.players || []).forEach((p) => {
      const r = raider(p.name, p.role);
      r.defensives += (p.personal || 0) + (p.external || 0);
      r.potions += p.potions || 0;
      r.healthstones += p.healthstones || 0;
    });
  });

  const pullsList = ordered.map(({ summary, report }) => ({
    id: summary.id,
    night: summary.night,
    pullNumber: summary.pullNumber,
    totalPullNumber: summary.totalPullNumber,
    result: summary.result,
    bossPercent: summary.bossPercent,
    duration: summary.duration,
    deaths: report?.deaths?.length ?? summary.deaths ?? null,
    cause: wipeCause(summary, report),
    source: summary.source || 'app',
  }));

  const spellIds = spellIdsOf(ordered);
  return {
    encounterId: first.encounterId,
    encounterName: first.encounterName,
    difficultyId: first.difficultyId,
    // Ability name -> spell ID, so the app can show a card for any name.
    spellIds,
    pulls: ordered.length,
    kills,
    bestPercent: kills ? 0 : percents.length ? Math.min(...percents) : null,
    medianPercent: median(percents),
    combatSeconds: Math.round(durations.reduce((a, b) => a + b, 0)),
    longestPull: durations.length ? round1(Math.max(...durations)) : null,
    firstPullAt: ordered[0]?.summary.startedAt || null,
    lastPullAt: ordered.at(-1)?.summary.startedAt || null,
    causes: countBy(pullsList.map((p) => p.cause)).map((c) => ({
      ...c,
      spellId: spellIds[c.name.endsWith(RAID_WIDE) ? c.name.slice(0, -RAID_WIDE.length) : c.name] ?? null,
    })),
    raiders: [...raiders.values()]
      .filter((r) => r.pulls > 0)
      .sort((a, b) => b.earlyDeaths - a.earlyDeaths || a.name.localeCompare(b.name)),
    pullsList,
  };
};

/**
 * A raid night: one summary per boss (and difficulty) pulled that night.
 */
export const summarizeNight = (pulls) => {
  const byBoss = new Map();
  pulls.forEach((p) => {
    const key = `${p.summary.encounterId}:${p.summary.difficultyId}`;
    byBoss.set(key, [...(byBoss.get(key) || []), p]);
  });
  return [...byBoss.values()]
    .map(summarizePulls)
    .sort((a, b) => (a.firstPullAt || 0) - (b.firstPullAt || 0));
};

/**
 * A boss across nights: one row per night, the pull-by-pull boss % line,
 * and each raider's early deaths per pull night by night.
 */
export const summarizeProgression = (pulls) => {
  const byNight = new Map();
  pulls.forEach((p) => {
    byNight.set(p.summary.night, [...(byNight.get(p.summary.night) || []), p]);
  });
  const nights = [...byNight.keys()].sort();
  const perNight = nights.map((night) => {
    const s = summarizePulls(byNight.get(night));
    return {
      night,
      pulls: s.pulls,
      kills: s.kills,
      bestPercent: s.bestPercent,
      medianPercent: s.medianPercent,
      combatSeconds: s.combatSeconds,
      topCause: s.causes[0] || null,
      causes: s.causes,
      raiders: s.raiders,
    };
  });

  const all = summarizePulls(pulls);
  let n = 0;
  const series = all.pullsList.map((p) => {
    n += 1;
    return {
      n,
      night: p.night,
      percent: p.result === 'kill' ? 0 : p.bossPercent,
      kill: p.result === 'kill',
      id: p.id,
      source: p.source,
    };
  });
  const firstKill = series.find((p) => p.kill) || null;

  // Raider trend: early deaths per pull per night.
  const trend = {};
  perNight.forEach(({ night, raiders }) => {
    raiders.forEach((r) => {
      trend[r.name] = trend[r.name] || { name: r.name, role: r.role, nights: {} };
      trend[r.name].nights[night] = {
        pulls: r.pulls,
        earlyDeaths: r.earlyDeaths,
        rate: r.pulls ? r.earlyDeaths / r.pulls : 0,
      };
    });
  });

  return {
    encounterId: all.encounterId,
    encounterName: all.encounterName,
    difficultyId: all.difficultyId,
    pulls: all.pulls,
    kills: all.kills,
    nights: perNight.map(({ raiders, ...rest }) => rest),
    series,
    firstKill: firstKill ? { pull: firstKill.n, night: firstKill.night } : null,
    causes: all.causes,
    spellIds: all.spellIds,
    raiders: all.raiders,
    trend: Object.values(trend),
  };
};
