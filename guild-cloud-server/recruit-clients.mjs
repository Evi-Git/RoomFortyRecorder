// Recruiting: Warcraft Logs (GraphQL v2) and Raider.IO clients.
//
// Warcraft Logs charges "points" per query (by complexity) against an hourly
// budget tied to the account that owns the API client. Every query also asks
// for rateLimitData, and the client pauses once it has spent `budgetShare` of
// the hour, until the hour resets.

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
  const usage = { limitPerHour: null, spentThisHour: 0, resetIn: 0, queries: 0, spentByUs: 0 };
  let stopRequested = false;

  const getToken = async () => {
    if (token && Date.now() < tokenExpires - 60000) return token;
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

  const waitForBudget = async () => {
    if (!usage.limitPerHour) return;
    if (usage.spentThisHour < usage.limitPerHour * budgetShare) return;
    const waitS = Math.max(5, usage.resetIn + 5);
    log(`Used ${Math.round(usage.spentThisHour)} of ${usage.limitPerHour} points this hour; pausing ${Math.round(waitS / 60)} min.`);
    const until = Date.now() + waitS * 1000;
    while (Date.now() < until) {
      if (stopRequested) throw new Error('Stopped');
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(15000, until - Date.now()));
    }
    usage.spentThisHour = 0;
  };

  /** Run a GraphQL query. Returns `data`. */
  const query = async (text, variables = {}) => {
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
        log(`Warcraft Logs ${response.status === 429 ? 'rate limit' : 'error'} (${response.status}); retrying in ${Math.round(waitMs / 1000)} s.`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(waitMs);
        continue;
      }
      if (response.status === 401) {
        token = null;
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
        const before = usage.spentThisHour;
        usage.limitPerHour = rate.limitPerHour;
        usage.spentThisHour = rate.pointsSpentThisHour;
        usage.resetIn = rate.pointsResetIn;
        if (rate.pointsSpentThisHour >= before) usage.spentByUs += rate.pointsSpentThisHour - before;
      }
      usage.queries += 1;
      if (body.errors?.length && !body.data) {
        throw new Error(`Warcraft Logs query error: ${body.errors.map((e) => e.message).join('; ')}`);
      }
      if (body.errors?.length) {
        log(`Warcraft Logs warning: ${body.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
      }
      return body.data || {};
    }
  };

  return {
    query,
    usage,
    configured: Boolean(clientId && clientSecret),
    stop: () => {
      stopRequested = true;
    },
    resume: () => {
      stopRequested = false;
    },
  };
};

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
    for (let attempt = 1; attempt <= 3 && !data; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
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
