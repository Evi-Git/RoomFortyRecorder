// Recruiting scores. Shared by the server (tests) and the recruiting web page
// (served as /recruit/score.mjs), so changing weights re-ranks instantly in
// the browser without another crawl.
//
// A candidate looks like:
// {
//   key, name, server, className, spec,
//   guild: { name, realm, worldRank, regionRank },
//   bosses: {
//     "<boss name>": {
//       pulls, kills, earlyDeaths, excusedDeaths, lateDeaths, deathCauses,
//       mechanics: { <id>: { count, pulls, pullsDone, raidAvg, label, assignedShare } },
//       parse: { best, median, kills }
//     }
//   }
// }

export const DEFAULT_WEIGHTS = { parse: 50, deaths: 30, mechanics: 20 };

const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

const stdev = (values) => {
  const m = mean(values);
  if (m === null || values.length < 2) return 0;
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

/** Raw metrics for one candidate. */
export const metricsFor = (
  candidate,
  { parseKind = 'median', minMechanicPulls = 5 } = {},
) => {
  const bosses = Object.entries(candidate.bosses || {});
  let pulls = 0;
  let earlyDeaths = 0;
  const parses = [];
  const ratios = [];
  const assigned = [];

  bosses.forEach(([bossName, b]) => {
    pulls += b.pulls || 0;
    earlyDeaths += b.earlyDeaths || 0;
    const p = b.parse?.[parseKind] ?? b.parse?.best ?? null;
    if (typeof p === 'number') parses.push(p);
    Object.entries(b.mechanics || {}).forEach(([id, m]) => {
      if (!m || m.pulls < minMechanicPulls) return;
      const rate = m.count / m.pulls;
      if (m.raidAvg > 0) ratios.push(Math.min(rate / m.raidAvg, 3));
      if (m.assignedShare && m.pullsDone / m.pulls >= m.assignedShare) {
        assigned.push(`${m.label || id} (${bossName})`);
      }
    });
  });

  return {
    pulls,
    earlyDeaths,
    deathRate: pulls ? earlyDeaths / pulls : null,
    parse: mean(parses),
    mechanics: mean(ratios),
    assigned,
  };
};

const zScorer = (values) => {
  const present = values.filter((v) => typeof v === 'number');
  const m = mean(present);
  const s = stdev(present);
  return (v) =>
    typeof v !== 'number' || m === null || s === 0 ? 0 : (v - m) / s;
};

/**
 * Score and rank candidates within their group (e.g. one spec).
 *
 * @param {object[]} candidates
 * @param {object} options
 * @param {{parse:number, deaths:number, mechanics:number}} options.weights
 * @param {number} options.minPulls     hide players with fewer counted pulls
 * @param {'median'|'best'} options.parseKind
 * @returns {object[]} candidates with { metrics, z, score, percentile, reasons }
 */
export const rankCandidates = (candidates, options = {}) => {
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const minPulls = options.minPulls ?? 15;
  const rows = candidates
    .map((c) => ({ ...c, metrics: metricsFor(c, options) }))
    .filter((c) => c.metrics.pulls >= minPulls);

  const zParse = zScorer(rows.map((r) => r.metrics.parse));
  const zDeath = zScorer(rows.map((r) => r.metrics.deathRate));
  const zMech = zScorer(rows.map((r) => r.metrics.mechanics));
  const totalWeight = weights.parse + weights.deaths + weights.mechanics || 1;

  rows.forEach((r) => {
    r.z = {
      parse: zParse(r.metrics.parse),
      // Fewer deaths is better.
      deaths: -zDeath(r.metrics.deathRate),
      mechanics: zMech(r.metrics.mechanics),
    };
    r.score =
      (weights.parse * r.z.parse +
        weights.deaths * r.z.deaths +
        weights.mechanics * r.z.mechanics) /
      totalWeight;
  });

  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.percentile =
      rows.length > 1 ? Math.round(100 * (1 - i / (rows.length - 1))) : 100;
    r.reasons = reasonsFor(r);
  });
  return rows;
};

const pct = (v) => `${Math.round(v)}`;

/** Short plain-English reasons, strongest first. */
export const reasonsFor = (row) => {
  const out = [];
  const { metrics, z } = row;
  if (z.parse >= 1)
    out.push(`parses well above the group (${pct(metrics.parse)})`);
  else if (z.parse <= -1)
    out.push(`parses below the group (${pct(metrics.parse)})`);
  if (z.deaths >= 1) out.push('dies early far less than the group');
  else if (z.deaths <= -1) out.push('dies early more than the group');
  if (metrics.assigned.length)
    out.push(`on assigned mechanics: ${metrics.assigned.join(', ')}`);
  else if (z.mechanics >= 1) out.push('does more mechanics than their raid');
  return out;
};
