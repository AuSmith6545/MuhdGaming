// Steam proxy — the one piece of "real server" this project has, because
// Steam's APIs don't allow a website's JS to call them directly and the
// achievements endpoint needs a secret key that can't live in public code.
//
// Routes:
//   GET /appdetails?appid=NNN    -> name, description, image, platforms, tags, price, release date
//   GET /achievements?appid=NNN  -> that game's real Steam achievement list
//   GET /news?appid=NNN          -> that game's recent Steam announcements (patch notes, DLC, etc.)
//
// All read-only, return only public game info (never the API key itself),
// and are cached at the edge for an hour to stay well within Steam's and
// Cloudflare's free-tier limits.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

// Steam almost always sends a ready-made "$19.99" string, but some listings
// carry a price_overview with a real amount and currency and an empty
// final_formatted — build one ourselves rather than surfacing a blank price
// when the number is right there.
function formatPrice(overview) {
  if (!overview) return null;
  if (overview.final_formatted) return overview.final_formatted;
  if (typeof overview.final === "number" && overview.currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: overview.currency }).format(overview.final / 100);
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function cachedFetch(url, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await fetch(url);
  const cacheable = new Response(upstream.body, upstream);
  cacheable.headers.set("Cache-Control", "public, max-age=3600");
  ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
  return cacheable;
}

// True if a *successful* appdetails entry is missing data a real, released,
// non-free listing should have. Steam's storefront API is known to
// sometimes return a thin response the first time an app is looked up
// after a while — success, but no price_overview/release_date — with a
// complete one arriving moments later. cachedFetch above would otherwise
// cache whichever response came first for the next hour, so appdetails
// uses its own fetch below: skip the cache on a miss, retry once if the
// first attempt looks thin, and only persist a response that isn't.
function looksIncomplete(d) {
  if (!d) return true;
  const hasPrice = d.is_free || !!d.price_overview;
  const hasRelease = d.release_date && (d.release_date.date || d.release_date.coming_soon);
  return !hasPrice || !hasRelease;
}

async function fetchAppDetails(appid, ctx) {
  const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&cc=us&l=en`;
  const cache = caches.default;
  const cacheKey = new Request(steamUrl, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  let data = await (await fetch(steamUrl)).json();
  let entry = data[appid];
  if (entry && entry.success && looksIncomplete(entry.data)) {
    const retryData = await (await fetch(steamUrl)).json();
    const retryEntry = retryData[appid];
    if (retryEntry && retryEntry.success && !looksIncomplete(retryEntry.data)) {
      data = retryData;
      entry = retryEntry;
    }
  }

  if (entry && entry.success && !looksIncomplete(entry.data)) {
    const cacheable = new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
    ctx.waitUntil(cache.put(cacheKey, cacheable));
  }

  return data;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const appid = url.searchParams.get("appid");

    if (url.pathname === "/appdetails") {
      if (!appid) return json({ error: "missing appid" }, 400);

      const data = await fetchAppDetails(appid, ctx);
      const entry = data[appid];

      if (!entry || !entry.success) return json({ error: "game not found on Steam" }, 404);

      const d = entry.data;
      return json({
        appid,
        name: d.name,
        description: d.short_description,
        image: d.header_image || d.capsule_imagev5 || d.capsule_image || null,
        platforms: d.platforms,
        categories: (d.categories || []).map((c) => c.description),
        genres: (d.genres || []).map((g) => g.description),
        storeUrl: `https://store.steampowered.com/app/${appid}`,
        price: d.is_free ? "Free to Play" : formatPrice(d.price_overview),
        releaseDate: d.release_date ? (d.release_date.date || (d.release_date.coming_soon ? "Coming soon" : null)) : null,
      });
    }

    if (url.pathname === "/achievements") {
      if (!appid) return json({ error: "missing appid" }, 400);
      if (!env.STEAM_API_KEY) return json({ error: "STEAM_API_KEY not configured on the worker" }, 500);

      const steamUrl = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${env.STEAM_API_KEY}&appid=${encodeURIComponent(appid)}`;
      const res = await cachedFetch(steamUrl, ctx);
      const data = await res.json();
      const achievements = data?.game?.availableGameStats?.achievements || [];

      return json({
        appid,
        achievements: achievements.map((a) => ({
          apiName: a.name,
          title: a.displayName,
          description: a.description || "",
          icon: a.icon,
        })),
        note: achievements.length === 0 ? "this game may not have Steam achievements" : undefined,
      });
    }

    if (url.pathname === "/news") {
      if (!appid) return json({ error: "missing appid" }, 400);

      const steamUrl = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appid)}&count=8&maxlength=300&format=json`;
      const res = await cachedFetch(steamUrl, ctx);
      const data = await res.json();
      const items = data?.appnews?.newsitems || [];

      return json({
        appid,
        news: items
          // Steam's community feed carries fan/curator posts alongside the
          // developer's own announcements — keep it to the latter so a
          // "check for updates" glance isn't buried in unrelated posts.
          .filter((n) => n.feedname === "steam_community_announcements" || n.feed_type === 1)
          .map((n) => ({
            title: n.title,
            url: n.url,
            date: n.date, // unix seconds
          })),
      });
    }

    return json({ error: "not found", routes: ["/appdetails?appid=", "/achievements?appid=", "/news?appid="] }, 404);
  },
};
