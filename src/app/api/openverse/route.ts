import { NextResponse } from "next/server";

// Use the current API domain
const OPENVERSE = "https://api.openverse.org/v1/images";

// If Edge seems flaky for you, switch to Node by uncommenting the next line:
// export const runtime = "nodejs";
export const runtime = "edge";
export const dynamic = "force-dynamic";

// Small helper: timeout + gentle retry for 5xx (NOT for 429)
async function fetchWithRetry(url: string, opts: RequestInit, tries = 2): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000); // 8s timeout
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });

    // If rate limited, DO NOT retry (return immediately so client can cool down)
    if (r.status === 429) return r;

    // Retry once on transient 5xx
    if (r.status >= 500 && r.status < 600 && tries > 1) {
      await new Promise(res => setTimeout(res, 700));
      return fetchWithRetry(url, opts, tries - 1);
    }
    return r;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Required / common params
  const q = searchParams.get("q") ?? "lonely horizon";
  const page = searchParams.get("page") ?? "1";

  // Flexible license handling
  const license = searchParams.get("license") || "";
  const license_type = searchParams.get("license_type") || "all-cc";

  // Optional passthroughs
  const color = searchParams.get("color") || "";
  const source = searchParams.get("source") || "";

  const u = new URL(OPENVERSE);
  u.searchParams.set("q", q);
  u.searchParams.set("page", page);
  // Fewer requests → ask for more items per call (fallback if not honored)
  u.searchParams.set("page_size", "20");

  if (license) u.searchParams.set("license", license);
  else if (license_type) u.searchParams.set("license_type", license_type);
  if (color) u.searchParams.set("color", color);
  if (source) u.searchParams.set("source", source);

  const r = await fetchWithRetry(u.toString(), {
    headers: { "User-Agent": "MoodBoard/1.0 (contact: you@example.com)" },
    cache: "no-store",
  });

  // Handle rate limit explicitly (shows cooldown to the client)
  if (r.status === 429) {
    const retryAfter = Number(r.headers.get("retry-after") ?? "60");
    const details = await r.text().catch(() => "");
    return NextResponse.json(
      { error: "Rate limited", retry_after: retryAfter, details: details.slice(0, 300) },
      { status: 429 }
    );
  }

  if (r.status === 401 || r.status === 403) {
    const details = await r.text().catch(() => "");
    return NextResponse.json(
        { error: "Unauthorized/Forbidden", details: details.slice(0, 300) },
        { status: r.status }
    );
  }   

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return NextResponse.json(
      { error: `Upstream ${r.status}`, details: text.slice(0, 300) },
      { status: 502 }
    );
  }

  const data = await r.json();
  const items = (data?.results ?? []).map((it: any) => ({
    id: it.id,
    title: it.title ?? "Untitled",
    thumb: it.thumbnail ?? it.url,
    full: it.url,
    creator: it.creator ?? "Unknown",
    creator_url: it.creator_url ?? it.foreign_landing_url,
    license: it.license,
    license_version: it.license_version,
    source: it.provider,
  }));

  return NextResponse.json({ items });
}
