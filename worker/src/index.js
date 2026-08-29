// Steam proxy — the one piece of "real server" this project has, because
// Steam's APIs don't allow a website's JS to call them directly and the
// achievements endpoint needs a secret key that can't live in public code.
//
// Routes:
//   GET /appdetails?appid=NNN    -> name, description, image, platforms, tags
//   GET /achievements?appid=NNN  -> that game's real Steam achievement list
//
// Both are read-only, return only public game info (never the API key
// itself), and are cached at the edge for an hour to stay well within
// Steam's and Cloudflare's free-tier limits.

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

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const appid = url.searchParams.get("appid");

    if (url.pathname === "/appdetails") {
      if (!appid) return json({ error: "missing appid" }, 400);

      const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&cc=us&l=en`;
      const res = await cachedFetch(steamUrl, ctx);
      const data = await res.json();
      const entry = data[appid];

      if (!entry || !entry.success) return json({ error: "game not found on Steam" }, 404);

      const d = entry.data;
      return json({
        appid,
        name: d.name,
        description: d.short_description,
        image: d.header_image,
        platforms: d.platforms,
        categories: (d.categories || []).map((c) => c.description),
        genres: (d.genres || []).map((g) => g.description),
        storeUrl: `https://store.steampowered.com/app/${appid}`,
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

    return json({ error: "not found", routes: ["/appdetails?appid=", "/achievements?appid="] }, 404);
  },
};
