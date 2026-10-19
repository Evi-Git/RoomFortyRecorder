// Recruiting: turns one guild's Warcraft Logs data for a boss into
// per-player numbers (pulls, early deaths, mechanics). Pure functions only,
// so they can be tested without the API.
//
// Inputs come straight from the Warcraft Logs v2 API:
//   fights      report.fights { id, encounterID, startTime, endTime, kill,
//               wipeCalledTime, friendlyPlayers }  (times in ms, report-relative)
//   actors      masterData.actors(type: "Player") { id, name, server, subType }
//   abilities   masterData.abilities { gameID, name }
//   specs       Map actorId -> spec name, from playerDetails
//   deaths      events(dataType: Deaths)
//   debuffs     events(dataType: Debuffs) for the boss's debuff mechanics
//   interrupts  events(dataType: Interrupts)

// Default rules for the current tier. Editable from the recruiting page.
export const DEFAULT_BOSSES = [
  {
    name: 'The Coiled Altar',
    // Deaths to these don't count against anyone (one or two players cause
    // them and the first victims are random).
    excusedDeaths: ['Venom Rupture'],
    mechanics: [
      {
        id: 'orbs',
        label: 'Venom orbs',
        kind: 'debuff',
        abilities: ['Volatile Venom', 'Mutagenic Venom'],
      },
      {
        id: 'kicks',
        label: 'Wail of Terror kicks',
        kind: 'interrupt',
        abilities: ['Wail of Terror'],
      },
    ],
  },
  {
    name: "Ula'tek",
    excusedDeaths: [],
    mechanics: [
      {
        id: 'eggs',
        label: 'Eggs before 2:30',
        kind: 'debuff',
        abilities: ['Noxious Shell'],
        // Only the assigned egg soaks count; later eggs are free-for-all.
        beforeSeconds: 150,
        // Picking up an egg in at least this share of pulls = on the soak team.
        assignedShare: 0.5,
      },
    ],
  },
];

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// "Kel'Thuzad" -> "kelthuzad", "Area 52" -> "area-52" (Warcraft Logs slugs).
export const serverSlug = (server) =>
  String(server || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const playerKey = (name, server) => `${name}-${serverSlug(server)}`;

// Field names have varied between API versions; read whichever is present.
const deathAbility = (event) =>
  event.killingAbilityGameID ?? event.killingAbility?.guid ?? event.abilityGameID ?? null;
const interruptedAbility = (event) =>
  event.extraAbilityGameID ?? event.extraAbility?.guid ?? null;
const eventAbility = (event) => event.abilityGameID ?? event.ability?.guid ?? null;
const eventTarget = (event) => event.targetID ?? event.target?.id ?? null;
const eventSource = (event) => event.sourceID ?? event.source?.id ?? null;

/**
 * Per-player numbers for one boss in one report.
 *
 * @param {object} input
 * @param {object} input.boss            one of DEFAULT_BOSSES
 * @param {object[]} input.fights        only this boss's Mythic pulls to count
 * @param {object[]} input.actors
 * @param {object[]} input.abilities
 * @param {Map<number,string>} input.specs
 * @param {object[]} input.deaths
 * @param {object[]} input.debuffs
 * @param {object[]} input.interrupts
 * @param {number} input.deathCutoff     count only the first N deaths per pull
 * @returns {{ players: Record<string, object>, pulls: number, mechanicPulls: Record<string, number> }}
 */
export const analyzeBossReport = ({
  boss,
  fights,
  actors,
  abilities,
  specs,
  deaths = [],
  debuffs = [],
  interrupts = [],
  deathCutoff = 2,
}) => {
  const abilityName = new Map((abilities || []).map((a) => [a.gameID, a.name]));
  const actorById = new Map((actors || []).map((a) => [a.id, a]));
  const fightById = new Map(fights.map((f) => [f.id, f]));
  const excused = new Set((boss.excusedDeaths || []).map(norm));

  const players = {};
  const playerFor = (actorId) => {
    const actor = actorById.get(actorId);
    if (!actor || !actor.name) return null;
    const key = playerKey(actor.name, actor.server);
    if (!players[key]) {
      players[key] = {
        key,
        name: actor.name,
        server: actor.server || '',
        className: actor.subType || '',
        spec: specs?.get(actorId) || '',
        pulls: 0,
        kills: 0,
        earlyDeaths: 0,
        excusedDeaths: 0,
        lateDeaths: 0,
        deathCauses: {},
        mechanics: {},
      };
    }
    if (!players[key].spec && specs?.get(actorId)) players[key].spec = specs.get(actorId);
    return players[key];
  };

  // Who was in each pull.
  fights.forEach((fight) => {
    (fight.friendlyPlayers || []).forEach((id) => {
      const player = playerFor(id);
      if (!player) return;
      player.pulls += 1;
      if (fight.kill) player.kills += 1;
    });
  });

  // Deaths: per pull, in order. Excused abilities and deaths after the wipe
  // was called don't count and don't use up the cutoff.
  const deathsByFight = new Map();
  deaths.forEach((event) => {
    if (event.type && event.type !== 'death') return;
    const fight = fightById.get(event.fight);
    if (!fight) return;
    deathsByFight.set(fight.id, [...(deathsByFight.get(fight.id) || []), event]);
  });
  deathsByFight.forEach((list, fightId) => {
    const fight = fightById.get(fightId);
    let counted = 0;
    list
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((event) => {
        const player = playerFor(eventTarget(event));
        if (!player) return;
        const cause = abilityName.get(deathAbility(event)) || 'Unknown';
        if (excused.has(norm(cause))) {
          player.excusedDeaths += 1;
          return;
        }
        if (fight.wipeCalledTime && event.timestamp >= fight.wipeCalledTime) {
          player.lateDeaths += 1;
          return;
        }
        if (counted < deathCutoff) {
          counted += 1;
          player.earlyDeaths += 1;
          player.deathCauses[cause] = (player.deathCauses[cause] || 0) + 1;
        } else {
          player.lateDeaths += 1;
        }
      });
  });

  // Mechanics. "Eligible" pulls are the ones where the mechanic happened to
  // anyone (inside its time window), so short wipes don't count against
  // people.
  const mechanicPulls = {};
  (boss.mechanics || []).forEach((mechanic) => {
    const wanted = new Set(mechanic.abilities.map(norm));
    const source = mechanic.kind === 'interrupt' ? interrupts : debuffs;
    const perFight = new Map(); // fightId -> Map(playerKey -> count)

    source.forEach((event) => {
      const fight = fightById.get(event.fight);
      if (!fight) return;
      let actorId;
      if (mechanic.kind === 'interrupt') {
        if (event.type && event.type !== 'interrupt') return;
        if (!wanted.has(norm(abilityName.get(interruptedAbility(event))))) return;
        actorId = eventSource(event);
      } else {
        if (event.type && event.type !== 'applydebuff') return;
        if (!wanted.has(norm(abilityName.get(eventAbility(event))))) return;
        actorId = eventTarget(event);
      }
      if (
        mechanic.beforeSeconds &&
        event.timestamp - fight.startTime > mechanic.beforeSeconds * 1000
      ) {
        return;
      }
      const player = playerFor(actorId);
      if (!player) return;
      const counts = perFight.get(fight.id) || new Map();
      counts.set(player.key, (counts.get(player.key) || 0) + 1);
      perFight.set(fight.id, counts);
    });

    mechanicPulls[mechanic.id] = perFight.size;
    perFight.forEach((counts, fightId) => {
      const fight = fightById.get(fightId);
      (fight.friendlyPlayers || []).forEach((id) => {
        const player = playerFor(id);
        if (!player) return;
        const m = player.mechanics[mechanic.id] || { count: 0, pulls: 0, pullsDone: 0 };
        const n = counts.get(player.key) || 0;
        m.count += n;
        m.pulls += 1;
        if (n > 0) m.pullsDone += 1;
        player.mechanics[mechanic.id] = m;
      });
    });
  });

  return { players, pulls: fights.length, mechanicPulls };
};

/** Add one report's per-player numbers into a running total for a guild. */
export const mergeBossTotals = (total, part) => {
  const result = total || { players: {}, pulls: 0, mechanicPulls: {} };
  result.pulls += part.pulls;
  Object.entries(part.mechanicPulls).forEach(([id, n]) => {
    result.mechanicPulls[id] = (result.mechanicPulls[id] || 0) + n;
  });
  Object.values(part.players).forEach((p) => {
    const t = result.players[p.key];
    if (!t) {
      result.players[p.key] = JSON.parse(JSON.stringify(p));
      return;
    }
    if (!t.spec && p.spec) t.spec = p.spec;
    ['pulls', 'kills', 'earlyDeaths', 'excusedDeaths', 'lateDeaths'].forEach((f) => {
      t[f] += p[f];
    });
    Object.entries(p.deathCauses).forEach(([cause, n]) => {
      t.deathCauses[cause] = (t.deathCauses[cause] || 0) + n;
    });
    Object.entries(p.mechanics).forEach(([id, m]) => {
      const tm = t.mechanics[id] || { count: 0, pulls: 0, pullsDone: 0 };
      tm.count += m.count;
      tm.pulls += m.pulls;
      tm.pullsDone += m.pullsDone;
      t.mechanics[id] = tm;
    });
  });
  return result;
};

/**
 * Guild averages per mechanic (count per eligible pull, averaged over the
 * players who were there), used to judge a player against their own raid.
 */
export const raidAverages = (totals, boss) => {
  const averages = {};
  (boss.mechanics || []).forEach((mechanic) => {
    const rates = Object.values(totals.players)
      .map((p) => p.mechanics[mechanic.id])
      .filter((m) => m && m.pulls > 0)
      .map((m) => m.count / m.pulls);
    averages[mechanic.id] = rates.length
      ? rates.reduce((a, b) => a + b, 0) / rates.length
      : 0;
  });
  return averages;
};

/**
 * Pick the pulls that count: Mythic pulls of this boss up to and including
 * the guild's first kill (progression + first kill, no farm).
 *
 * @param {{ reportStart: number, fights: object[] }[]} reports
 * @returns {Map<string, Set<number>>} report code -> fight IDs to analyze
 */
export const progressionFights = (reports) => {
  let firstKill = Infinity;
  reports.forEach((report) => {
    report.fights.forEach((fight) => {
      if (fight.kill) firstKill = Math.min(firstKill, report.reportStart + fight.startTime);
    });
  });
  const selected = new Map();
  reports.forEach((report) => {
    const ids = report.fights
      .filter((fight) => report.reportStart + fight.startTime <= firstKill)
      .map((fight) => fight.id);
    if (ids.length) selected.set(report.code, new Set(ids));
  });
  return { selected, firstKill: Number.isFinite(firstKill) ? firstKill : null };
};

/** Spec name per actor from report.playerDetails JSON. */
export const specsFromPlayerDetails = (details) => {
  const specs = new Map();
  const data = details?.data?.playerDetails || details?.playerDetails || details || {};
  ['tanks', 'healers', 'dps'].forEach((role) => {
    (data[role] || []).forEach((player) => {
      const top = [...(player.specs || [])].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
      const spec = top?.spec || player.spec || '';
      if (player.id !== undefined && spec) specs.set(player.id, spec);
    });
  });
  return specs;
};

/** Best and median parse from character.encounterRankings JSON, for a spec. */
export const parseSummary = (rankings, specName) => {
  const ranks = (rankings?.ranks || []).filter(
    (r) => !specName || !r.spec || norm(r.spec) === norm(specName),
  );
  const percents = ranks
    .map((r) => r.rankPercent)
    .filter((v) => typeof v === 'number')
    .sort((a, b) => a - b);
  if (!percents.length) {
    return {
      best: typeof rankings?.bestRank?.rankPercent === 'number' ? rankings.bestRank.rankPercent : null,
      median: typeof rankings?.medianPerformance === 'number' ? rankings.medianPerformance : null,
      kills: rankings?.totalKills ?? 0,
    };
  }
  const mid = Math.floor(percents.length / 2);
  const median =
    percents.length % 2 ? percents[mid] : (percents[mid - 1] + percents[mid]) / 2;
  return {
    best: percents[percents.length - 1],
    median,
    kills: percents.length,
  };
};
