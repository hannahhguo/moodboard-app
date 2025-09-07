"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

const SLOT_COUNT = 3;

export default function Home() {
  const [userText, setUserText] = useState("lonely, dark, single figure, horizon");
  const [activeQuery, setActiveQuery] = useState(userText); // invisible internal query for refinement
  const [itemsQueue, setItemsQueue] = useState<Item[]>([]);
  const [visible, setVisible] = useState<Item[]>([]);
  const [kept, setKept] = useState<Item[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent overlapping fetches
  const fetchingRef = useRef(false);

  // ---- Fetch helpers ----
  async function fetchImages(query: string, pageNum: number, opts?: { append?: boolean }) {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setLoading(true);
      setError(null);

      const url = `/api/openverse?q=${encodeURIComponent(query)}&license_type=all-cc&page=${pageNum}`;
      const r = await fetch(url, { cache: "no-store" });

      // Handle errors, especially 429 rate limit
      if (!r.ok) {
        let msg = `API ${r.status}`;
        try {
          const body = await r.json();
          if (r.status === 429) {
            msg = `We’re being rate-limited by Openverse. Try again in ${body.retry_after ?? 60}s.`;
          } else if (body?.error) {
            msg = body.error;
          }
        } catch {
          /* ignore JSON parse errors */
        }
        throw new Error(msg);
      }

      const j = await r.json();


      // Filter out anything we've already shown/rejected/kept
      const fresh: Item[] = (j.items ?? []).filter((it: Item) => !seenIds.has(it.id));

      setItemsQueue(prev => (opts?.append ? [...prev, ...fresh] : fresh));
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Search failed");
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }

  // Fill visible slots up to SLOT_COUNT from the queue
  function fillSlots() {
    setVisible(prev => {
      let next = [...prev];
      let qcopy = [...itemsQueue];
      while (next.length < SLOT_COUNT && qcopy.length > 0) {
        next.push(qcopy.shift() as Item);
      }
      // commit the queue change
      if (qcopy.length !== itemsQueue.length) setItemsQueue(qcopy);
      return next;
    });
  }

  // Kick off initial load
  useEffect(() => {
    (async () => {
      setPage(1);
      setItemsQueue([]);
      setVisible([]);
      setKept([]);
      setSeenIds(new Set());
      await fetchImages(activeQuery, 1, { append: false });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // changes if you setQ manually; initial effect runs once

  // Whenever queue changes, try to top up the 3 visible slots
  useEffect(() => {
    if (visible.length < SLOT_COUNT) fillSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsQueue]);

  // If we’re running low on queue, prefetch next page --commented out to prevent over-fetching
  // useEffect(() => {
  //   if (itemsQueue.length < 6 && !loading) {
  //     const p = page + 1;
  //     setPage(p);
  //     fetchImages(q, p, { append: true });
  //   }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [itemsQueue, loading]);

  // ---- Actions ----
  function removeSlotAt(idx: number) {
    setVisible(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  }

  function markSeen(id: string) {
    setSeenIds(prev => new Set(prev).add(id));
  }

  // Simple refinement: boost query with accepted item’s title + source
  function refineQueryWith(item: Item) {
    const tokens = new Set<string>();
    // seed with the current activeQuery (not userText)
    activeQuery.split(/[,\s]+/).forEach(w => w && tokens.add(w.toLowerCase()));
    kept.slice(0, 5).forEach(k => (k.title || "").toLowerCase().split(/[,\s]+/).forEach(w => w && w.length > 2 && tokens.add(w)));
    (item.title || "").toLowerCase().split(/[,\s]+/).forEach(w => w && w.length > 2 && tokens.add(w));
    if (item.source) tokens.add(item.source.toLowerCase());
    return Array.from(tokens).slice(0, 12).join(" ") || activeQuery;
  }


  async function handleAccept(idx: number) {
    const item = visible[idx];
    if (!item) return;

    setKept(prev => [item, ...prev]);
    markSeen(item.id);
    removeSlotAt(idx);

    // Build refined query from accepted image + recent keeps (your refine function)
    const refined = refineQueryWith(item); // returns a string

    // Update hidden query only
    setActiveQuery(refined);

    // Refresh the queue with refined query (invisible to textarea)
    setPage(1);
    setItemsQueue([]);
    await fetchImages(refined, 1, { append: false });

    // (optional) maybeAnalyzeAfterAccept();  // if you added periodic Gemini calls
  }


  function handleReject(idx: number) {
    const item = visible[idx];
    if (!item) return;

    // mark as seen (so we don’t re-show)
    markSeen(item.id);

    // remove from candidates and backfill
    removeSlotAt(idx);

    // If queue is empty after removing, fillSlots() will run on next queue change
    if (itemsQueue.length === 0) fillSlots();

    // New: proactively fetch more when queue is running low
    if (itemsQueue.length < 3 && !loading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchImages(activeQuery, nextPage, { append: true });
    }
  }

  async function analyzePoemAndSearch(poem: string) {
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: poem,
          acceptedTitles: kept.slice(0, 5).map(k => k.title).filter(Boolean),
        }),
      });

      if (!resp.ok) {
        const msg = (await resp.json().catch(() => ({}))).error || `Analyze API ${resp.status}`;
        throw new Error(msg);
      }

      const analysis = await resp.json();
      const query = analysis.search_query?.trim() || activeQuery;
      // Invisible: do NOT change userText
      setActiveQuery(query);

      // reset & search with refined query
      setPage(1);
      setItemsQueue([]);
      setVisible([]);
      await fetchImages(query, 1, { append: false });
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  // UI bits
  const presets = useMemo(
    () => [
      "lonely, dark, single figure, horizon",
      "urban night, neon, rain, solitude",
      "stormy sea, small boat, dramatic",
      "warm nostalgic, golden hour, film grain",
    ],
    []
  );

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Mood Board (left) */}
        <section className="lg:col-span-8">
          <header className="mb-2">
            <h1 className="text-2xl font-semibold">AI Mood Board for Songwriters</h1>
            <p className="mt-1 text-sm opacity-70">
              Pick images that resonate. We’ll learn your vibe and pull in more.
            </p>
          </header>

          {/* Candidate strip: always 3 */}
          {error && <p className="mt-2 text-red-600">Error: {error}</p>}
          {loading && <p className="mt-2 opacity-70">Searching…</p>}

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: SLOT_COUNT }).map((_, i) => {
              const it = visible[i];
              return (
                <div key={i} className="relative overflow-hidden rounded-2xl border">
                  {it ? (
                    <>
                      <Image
                        src={it.thumb}
                        alt={it.title}
                        width={600}
                        height={400}
                        className="h-64 w-full object-cover"
                      />
                      {/* Actions overlay */}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/50 p-2 text-white">
                        <div className="truncate text-sm">{it.title || "Untitled"}</div>
                        <div className="flex gap-2">
                          <button
                            aria-label="Reject"
                            onClick={() => handleReject(i)}
                            className="rounded-full bg-white px-3 py-1 text-black hover:opacity-80"
                          >
                            ✕
                          </button>
                          <button
                            aria-label="Accept"
                            onClick={() => handleAccept(i)}
                            className="rounded-full bg-emerald-500 px-3 py-1 hover:opacity-90"
                          >
                            ✓
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex h-64 items-center justify-center text-sm opacity-60">
                      {loading ? "Loading…" : "Fetching more…"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Kept images grid */}
          {kept.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-medium">Kept on Board</h2>
              <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {kept.map((it) => (
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
            </>
          )}
        </section>

        {/* Canvas (right) */}
        <aside className="lg:col-span-4">
          <div className="sticky top-6 rounded-2xl border p-4">
            <h2 className="text-lg font-medium">Canvas</h2>
            <p className="mt-1 text-sm opacity-70">
              Describe a feeling/lyric. Candidates appear on the left. ✓ to keep, ✕ to skip.
            </p>

            <label htmlFor="canvas-input" className="sr-only">
              Canvas query
            </label>
            <textarea
              id="canvas-input"
              className="mt-3 h-28 w-full resize-y rounded-xl border p-3"
              placeholder="e.g., 'lonely, dark, wide horizon; single figure; cold wind'"
              value={userText}
              onChange={(e) => setUserText(e.target.value)}
            />

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => {
                  // reset flow for a fresh search
                  setActiveQuery(userText);
                  setPage(1);
                  setItemsQueue([]);
                  setVisible([]);
                  setKept([]);
                  setSeenIds(new Set());
                  fetchImages(userText, 1, { append: false });
                }}
                disabled={loading}
                className="rounded-xl bg-black px-4 py-2 text-white"
              >
                Search
              </button>

              <button
                onClick={() => analyzePoemAndSearch(userText)}
                disabled={loading}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Analyze with AI
              </button>

              <button
                onClick={() => {
                  // user explicitly wants to search their typed text
                  setActiveQuery(userText);
                  setPage(1);
                  setItemsQueue([]);
                  setVisible([]);
                  setKept([]);
                  setSeenIds(new Set());
                  fetchImages(userText, 1, { append: false });
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
                {["lonely, dark, single figure, horizon", "warm nostalgic, golden hour, film grain", "stormy sea, small boat, dramatic"].map(
                  (p) => (
                    <button
                      key={p}
                      onClick={() => {
                        const demo = "urban night, neon, rain, solitude";
                        setUserText(demo);
                        setActiveQuery(demo);
                        setPage(1);
                        setItemsQueue([]);
                        setVisible([]);
                        setKept([]);
                        setSeenIds(new Set());
                        fetchImages(demo, 1, { append: false });
                      }}
                      className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50"
                    >
                      {p}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}