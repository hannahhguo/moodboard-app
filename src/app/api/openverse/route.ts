import { NextResponse } from "next/server";

const OPENVERSE = "https://api.openverse.engineering/v1/images";

// Avoid ISR/edge caching for this endpoint
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Required / common params
  const q = searchParams.get("q") ?? "lonely horizon";
  const page = searchParams.get("page") ?? "1";

  // 🔑 New: accept either a specific license list OR a broader license_type
  const license = searchParams.get("license");            // e.g. "cc0,by"
  const license_type = searchParams.get("license_type");  // e.g. "all-cc" (or whatever you pass)
  
  // (Optional) pass-through for other filters if you add them later
  const color = searchParams.get("color");
  const source = searchParams.get("source");

  const u = new URL(OPENVERSE);
  u.searchParams.set("q", q);
  u.searchParams.set("page", page);

  // Only forward filters that are present
  if (license) u.searchParams.set("license", license);
  if (license_type) u.searchParams.set("license_type", license_type);
  if (color) u.searchParams.set("color", color as string);
  if (source) u.searchParams.set("source", source as string);

  const r = await fetch(u.toString(), {
    headers: { "User-Agent": "MoodBoard/1.0 (contact: you@example.com)" },
    cache: "no-store",
  });

  if (!r.ok) {
    return NextResponse.json({ error: "Openverse request failed" }, { status: 502 });
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
