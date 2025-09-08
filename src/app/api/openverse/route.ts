import { NextRequest } from "next/server";

type OpenverseItem = {
  id: string;
  title?: string;
  thumbnail?: string; // Openverse `thumbnail`
  url: string;        // full image url
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  source?: string;
};

type OpenverseResponse = {
  results: unknown[];
};

function toItem(x: unknown): OpenverseItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string") return null;

  return {
    id: o.id,
    title: typeof o.title === "string" ? o.title : undefined,
    thumbnail: typeof o.thumbnail === "string" ? o.thumbnail : undefined,
    url: typeof o.url === "string" ? o.url : "",
    creator: typeof o.creator === "string" ? o.creator : "",
    creator_url: typeof o.creator_url === "string" ? o.creator_url : undefined,
    license: typeof o.license === "string" ? o.license : "",
    license_version:
      typeof o.license_version === "string" ? o.license_version : undefined,
    source: typeof o.source === "string" ? o.source : undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const page = Number(searchParams.get("page") ?? "1");

    // Build the Openverse API URL
    const apiUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(
      q
    )}&page=${page}`;

    const res = await fetch(apiUrl, { cache: "no-store" });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Openverse ${res.status}` }), {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    }

    const j = (await res.json()) as OpenverseResponse;
    const items = Array.isArray(j.results)
      ? j.results.map(toItem).filter(Boolean)
      : [];

    // Map Openverse items into your frontend Item shape
    const mapped = (items as OpenverseItem[]).map((r) => ({
      id: r.id,
      title: r.title ?? "",
      thumb: r.thumbnail ?? r.url,
      full: r.url,
      creator: r.creator ?? "",
      creator_url: r.creator_url,
      license: r.license ?? "",
      license_version: r.license_version,
      source: r.source,
    }));

    return Response.json({ items: mapped });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
