"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type Item = {
  id: string;
  title: string;
  thumb: string;
  full: string;
  creator: string;
  creator_url?: string;
  license: string;
  license_version?: string;
  source?: string;
};

export default function Home() {
  const [q, setQ] = useState("lonely, dark, single figure, horizon");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function search(query: string) {
    try {
      setError(null);
      setLoading(true);
      const url =
        `/api/openverse?q=${encodeURIComponent(query)}&license_type=all-cc&t=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" }); // ← ensure fresh request
      if (!r.ok) throw new Error(`API ${r.status}`);
      const j = await r.json();
      setItems(j.items ?? []);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Search failed");
      setItems([]); // optional: clear grid on error
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    search(q);
  }, []);

  const presets = [
    "lonely, dark, single figure, horizon",
    "urban night, neon, rain, solitude",
    "stormy sea, small boat, dramatic",
    "warm nostalgic, golden hour, film grain",
  ];

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* 12-col grid: left = mood board (span 8), right = Canvas (span 4) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Mood Board (left) */}
        <section className="lg:col-span-8">
          <header className="mb-2">
            <h1 className="text-2xl font-semibold">Mood Board for Artists</h1>
            <p className="mt-1 text-sm opacity-70">
              Images are openly licensed with creator attribution. Click through to explore.
            </p>
          </header>

          {loading && <p className="mt-4 opacity-70">Searching…</p>}
          {error && <p className="mt-4 text-red-600">Error: {error}</p>}

          
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {items.map((it) => (
              <figure key={it.id} className="overflow-hidden rounded-2xl border">
                <Image
                  src={it.thumb}
                  alt={it.title}
                  width={400}
                  height={300}
                  className="h-48 w-full object-cover"
                />
                <figcaption className="p-3 text-sm">
                  <div className="line-clamp-1">{it.title || "Untitled"}</div>
                  <div className="mt-1 text-xs opacity-70">
                    by{" "}
                    {it.creator_url ? (
                      <a className="underline" href={it.creator_url} target="_blank">
                        {it.creator}
                      </a>
                    ) : (
                      it.creator
                    )}{" "}
                    · {it.license.toUpperCase()}
                    {it.license_version ? ` ${it.license_version}` : ""} · {it.source}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Canvas (right) */}
        <aside className="lg:col-span-4">
          <div className="sticky top-6 rounded-2xl border p-4">
            <h2 className="text-lg font-medium">Canvas</h2>
            <p className="mt-1 text-sm opacity-70">
              Describe a feeling, lyric, or scene. Press Search to update the board.
            </p>

            <label htmlFor="canvas-input" className="sr-only">
              Canvas query
            </label>
            <textarea
              id="canvas-input"
              className="mt-3 h-28 w-full resize-y rounded-xl border p-3"
              placeholder="e.g., 'lonely, dark, wide horizon; single figure; cold wind'"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => search(q)}
                className="rounded-xl bg-black px-4 py-2 text-white"
              >
                Search
              </button>
              <button
                onClick={() => {
                  const next = "urban night, neon, rain, solitude";
                  setQ(next);
                  search(next);
                }}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              >
                Try a demo
              </button>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide opacity-70">
                Presets
              </p>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setQ(p);
                      search(p);
                    }}
                    className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional: license quick toggles (wire into your fetch URL later) */}
            {/* <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide opacity-70">
                License
              </p>
              <div className="flex gap-2">
                <button className="rounded-full border px-3 py-1 text-xs">CC0 only</button>
                <button className="rounded-full border px-3 py-1 text-xs">CC0 + BY</button>
              </div>
            </div> */}
          </div>
        </aside>
      </div>
    </main>
  );
}
