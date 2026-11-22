// Warcraft Logs (GraphQL v2) and Raider.IO clients.
//
// Warcraft Logs charges "points" per query (by complexity) against an hourly
// budget tied to the account that owns the API client. Every query also asks
// for rateLimitData, and a caller pauses once the hour's spend reaches its
// `budgetShare`, until the hour resets.
//
// One client per server: `createWclClient` holds the token and the hour's
// spend, and each feature (recruiting, the watcher, Top logs, the pull desk)
// takes its own handle with `forConsumer`: its own log, its own share of the
// hour and its own Stop. Background crawls stop at 85% so the pull desk
// (imports, Compare, icons) still has room when someone clicks.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createWclClient = ({
  clientId,
  clientSecret,
  baseUrl = 'https://www.warcraftlogs.com',
  budgetShare = 0.85,
  log = () => {},
  fetchImpl = fetch,
}) => {
  let token = null;
  let tokenExpires = 0;
  let tokenRequest = null;
  // The hour's spend as Warcraft Logs last reported it, shared by every handle.
  const shared = { limitPerHour: null, spentThisHour: 0, resetAt: 0, queries: 0 };
  const configured = Boolean(clientId && clientSecret);

  const fetchToken = async () => {
    const response = await fetchImpl(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(
        `Warcraft Logs sign-in failed (${response.status}). Check GUILD_CLOUD_WCL_CLIENT_ID and GUILD_CLOUD_WCL_CLIENT_SECRET.`,
      );
    }
    token = data.access_token;
    tokenExpires = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    return token;
  };

  // One sign-in at a time, however many handles ask at once.
  const getToken = async () => {
    if (token && Date.now() < tokenExpires - 60000) return token;
    tokenRequest ??= fetchToken().finally(() => {
      tokenRequest = null;
    });
    return tokenRequest;
  };

  const resetInSeconds = () => Math.max(0, Math.round((shared.resetAt - Date.now()) / 1000));

  /**
   * A handle for one feature. `log` gets its pause and retry lines;
   * `budgetShare` is how much of the hour it may spend before it waits;
   * `stop()` ends only this handle's waits and queries.
   */
  const forConsumer = ({ log: say = log, budgetShare: share = budgetShare } = {}) => {
    let stopRequested = false;
    const own = { queries: 0, spentByUs: 0 };
    // Enumerable getters, so `{ ...usage }` and JSON copy today's numbers.
    const usage = Object.defineProperties(
      {},
      {
        limitPerHour: { enumerable: true, get: () => shared.limitPerHour },
        spentThisHour: { enumerable: true, get: () => shared.spentThisHour },
        resetIn: { enumerable: true, get: resetInSeconds },
        queries: { enumerable: true, get: () => own.queries },
        spentByUs: { enumerable: true, get: () => own.spentByUs },
      },
    );

    const waitForBudget = async () => {
      if (!shared.limitPerHour) return;
      if (shared.spentThisHour < shared.limitPerHour * share) return;
      const waitS = Math.max(5, resetInSeconds() + 5);
      say(`Used ${Math.round(shared.spentThisHour)} of ${shared.limitPerHour} points this hour; pausing ${Math.round(waitS / 60)} min.`);
      const until = Date.now() + waitS * 1000;
      while (Date.now() < until) {
        if (stopRequested) throw new Error('Stopped');
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(1000, until - Date.now()));
      }
      // The hour has reset; the next answer brings the real number.
      if (Date.now() >= shared.resetAt) shared.spentThisHour = 0;
    };

    /** Run a GraphQL query. Returns `data`. */
    const query = async (text, variables = {}, { quiet = false } = {}) => {
      if (stopRequested) throw new Error('Stopped');
      await waitForBudget();
      const withRate = text.replace(
        /\}\s*$/,
        ' rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }',
      );

      for (let attempt = 1; ; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const bearer = await getToken();
        // eslint-disable-next-line no-await-in-loop
        const response = await fetchImpl(`${baseUrl}/api/v2/client`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: withRate, variables }),
          signal: AbortSignal.timeout(60000),
        }).catch((error) => ({ ok: false, status: 0, error }));

        if (response.status === 429 || response.status >= 500 || response.status === 0) {
          if (attempt >= 5) {
            throw new Error(`Warcraft Logs request failed (${response.status || response.error?.message}).`);
          }
          const waitMs = response.status === 429 ? 60000 * attempt : 5000 * attempt;
          say(`Warcraft Logs ${response.status === 429 ? 'rate limit' : 'error'} (${response.status}); retrying in ${Math.round(waitMs / 1000)} s.`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(waitMs);
          continue;
        }
        if (response.status === 401) {
          if (token === bearer) token = null;
          if (attempt >= 2) throw new Error('Warcraft Logs rejected the API credentials.');
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(`Warcraft Logs request failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
        }
        const rate = body.data?.rateLimitData;
        if (rate) {
          const before = shared.spentThisHour;
          shared.limitPerHour = rate.limitPerHour;
          shared.spentThisHour = rate.pointsSpentThisHour;
          shared.resetAt = Date.now() + (Number(rate.pointsResetIn) || 0) * 1000;
          // Other handles may have spent some of this too; close enough for
          // "points used" in a crawl's log.
          if (rate.pointsSpentThisHour >= before) own.spentByUs += rate.pointsSpentThisHour - before;
        }
        own.queries += 1;
        shared.queries += 1;
        if (body.errors?.length && !body.data) {
          throw new Error(`Warcraft Logs query error: ${body.errors.map((e) => e.message).join('; ')}`);
        }
        if (body.errors?.length && !quiet) {
          say(`Warcraft Logs warning: ${body.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
        }
        return body.data || {};
      }
    };

    return {
      query,
      usage,
      configured,
      forConsumer,
      stop: () => {
        stopRequested = true;
      },
      resume: () => {
        stopRequested = false;
      },
    };
  };

  return forConsumer();
};

/** A feature's own handle on a shared client, or a client of its own (tests, or no shared one given). */
export const wclHandle = (given, options, { log, budgetShare } = {}) =>
  given
    ? given.forConsumer
      ? given.forConsumer({ ...(log ? { log } : {}), ...(budgetShare ? { budgetShare } : {}) })
      : given
    : createWclClient({ ...options, ...(log ? { log } : {}), ...(budgetShare ? { budgetShare } : {}) });

/**
 * Raider.IO Mythic raid rankings between two world ranks, for one region.
 * Pages are 50 guilds; world rank N is on page floor((N-1)/50).
 */
export const fetchRaiderIoGuilds = async ({
  raid,
  region,
  minRank,
  maxRank,
  baseUrl = 'https://raider.io',
  fetchImpl = fetch,
  log = () => {},
}) => {
  const guilds = [];
  const firstPage = Math.floor((minRank - 1) / 50);
  const lastPage = Math.floor((maxRank - 1) / 50);
  for (let page = firstPage; page <= lastPage; page += 1) {
    const url = `${baseUrl}/api/v1/raiding/raid-rankings?raid=${encodeURIComponent(raid)}&difficulty=mythic&region=world&limit=50&page=${page}`;
    let data = null;
    for (let attempt = 1; attempt <= 4 && !data; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // eslint-disable-next-line no-await-in-loop
        data = await response.json();
      } catch (error) {
        log(`Raider.IO page ${page} failed (${error.message}); retrying.`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(3000 * attempt);
      }
    }
    if (!data) throw new Error(`Raider.IO rankings page ${page} could not be loaded.`);
    const rows = data.raidRankings || [];
    rows.forEach((row) => {
      if (row.rank < minRank || row.rank > maxRank) return;
      const g = row.guild || {};
      const regionSlug = String(
        typeof g.region === 'string' ? g.region : g.region?.slug || g.region?.short_name || '',
      ).toLowerCase();
      if (region && regionSlug !== region.toLowerCase()) return;
      const realm = typeof g.realm === 'string' ? { name: g.realm, slug: g.realm } : g.realm || {};
      const kills = {};
      (row.encountersDefeated || []).forEach((e) => {
        kills[e.slug] = { firstDefeated: e.firstDefeated, lastDefeated: e.lastDefeated };
      });
      const pulled = {};
      (row.encountersPulled || []).forEach((e) => {
        pulled[e.slug] = { numPulls: e.numPulls ?? null, bestPercent: e.bestPercent ?? null };
      });
      guilds.push({
        name: g.name,
        realm: realm.name || '',
        realmSlug: realm.slug || '',
        region: regionSlug,
        worldRank: row.rank,
        regionRank: row.regionRank,
        profileUrl: g.path ? `https://raider.io${g.path}` : null,
        kills,
        pulled,
      });
    });
    if (!rows.length) break;
  }
  return guilds;
};
