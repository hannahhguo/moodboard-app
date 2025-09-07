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

// Toggle manual search UI without deleting code
const ENABLE_MANUAL_SEARCH = false;

const SLOT_COUNT = 3;

// FOR WEB UI
const PRESETS = [
  "lonely, dark, single figure, horizon",
  "warm nostalgic, golden hour, film grain",
  "stormy sea, small boat, dramatic",
  "urban night, neon, rain, solitude",
];

// FOR BETTER IMAGE QUERIES
// --- Tiny lexicons (expand anytime) ---
const COLOR_WORDS = new Set([
  "black","white","gray","grey","charcoal","silver","gold","golden",
  "blue","navy","indigo","teal","cyan","turquoise",
  "red","crimson","scarlet","maroon",
  "green","emerald","olive","sage",
  "yellow","amber","ochre","ocher","mustard",
  "purple","violet","magenta","lilac",
  "orange","rust","copper","bronze",
  "brown","beige","tan","sepia",
  "pink","peach","rose",
]);
const MOOD_WORDS = new Set([
  "lonely","solitary","melancholy","wistful","moody","somber","brooding",
  "serene","calm","peaceful","tender","nostalgic","yearning","eerie","ominous",
]);
const PHOTO_COMPOSITION = new Set([
  "silhouette","portrait","landscape","wide","aerial","macro","minimalist",
  "grainy","film","bokeh","long-exposure","lowlight","low-light",
  "horizon","skyline","shore","cliff","alley","street","night","dawn","dusk",
  "rain","fog","mist","snow","storm","neon","reflections",
]);

// Stoplist + simple tokenization (same as before, slightly tweaked)
const STOP = new Set([
  "the","a","an","and","or","of","in","on","at","to","for","with","from","by","into","over",
  "is","are","was","were","be","been","being","it","its","that","this","these","those","as",
  "but","if","then","than","so","such","very","not","no","off","out","up","down","near","far",
  "your","my","our","their","his","her","they","them","you","we","i"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Simple “noun/adjective-ish” heuristic: prefer longer words & certain suffixes.
// This is intentionally cheap—no POS tagger needed.
function posBias(word: string): number {
  // adjective-y suffixes
  if (/(ful|less|ous|ive|ish|y|ly)$/.test(word)) return 1.2;
  // noun-y endings or compounds
  if (/(tion|ment|ness|scape|graphy)$/.test(word)) return 1.15;
  // hyphen compounds often meaningful (e.g., long-exposure, low-light)
  if (word.includes("-")) return 1.1;
  // length bias
  if (word.length >= 7) return 1.05;
  return 1.0;
}

// Domain biases: colors/moods/composition terms get a boost
function domainBias(word: string): number {
  let b = 1.0;
  if (COLOR_WORDS.has(word)) b *= 1.25;
  if (MOOD_WORDS.has(word)) b *= 1.2;
  if (PHOTO_COMPOSITION.has(word)) b *= 1.15;
  return b;
}

type WeightOpts = {
  baseWeight?: number;   // weight for tokens from activeQuery
  keptWeight?: number;   // weight for tokens from recent kept titles
  itemWeight?: number;   // weight for tokens from the newly accepted image title
};

// Score tokens from a string with configurable weight and biases.
function scoreTokensFrom(text: string, weight: number, scores: Record<string, number>) {
  for (const w of tokenize(text)) {
    if (STOP.has(w) || w.length < 3) continue;
    const inc = weight * posBias(w) * domainBias(w);
    scores[w] = (scores[w] ?? 0) + inc;
  }
}

// Turn a score map into a compact query
function topKeywords(scores: Record<string, number>, max = 12): string[] {
  // Avoid near-duplicates by preferring unique roots (super simple de-dupe)
  const entries = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  const picked: string[] = [];
  const seenRoots = new Set<string>();
  for (const [w] of entries) {
    const root = w.replace(/(s|es|ed|ing|ly)$/,""); // ultra-naive stemming
    if (seenRoots.has(root)) continue;
    picked.push(w);
    seenRoots.add(root);
    if (picked.length >= max) break;
  }
  return picked;
}

// Pre-boost any color words found in the *user's* text
function preseedColorHintsFromUserText(
  scores: Record<string, number>,
  text: string
) {
  for (const w of tokenize(text)) {
    if (COLOR_WORDS.has(w)) {
      // light nudge so color hints survive scoring
      scores[w] = (scores[w] ?? 0) + 0.6;
    }
  }
}



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

  // USING WEIGHTED KEYWORDS
  // TODO: bump keptWeight if want to emphasise accumulated taste, bump itemWeight if want √ to steer harder
  function refineQueryWith(item: Item): string {
    const scores: Record<string, number> = {};

    // pre-seed with color words from what the user typed in the Canvas
    preseedColorHintsFromUserText(scores, userText);
    
    // Tweakable weights:
    const WEIGHTS: WeightOpts = {
      baseWeight: 1.0,   // current vibe
      keptWeight: 1.4,   // reinforce what user kept
      itemWeight: 1.8,   // strongly bias toward newly accepted image
    };

    // 1) current hidden vibe
    scoreTokensFrom(activeQuery, WEIGHTS.baseWeight!, scores);

    // 2) recent kept titles (up to 5)
    for (const k of kept.slice(0, 5)) {
      scoreTokensFrom(k.title ?? "", WEIGHTS.keptWeight!, scores);
    }

    // 3) newly accepted image (strongest)
    scoreTokensFrom(item.title ?? "", WEIGHTS.itemWeight!, scores);

    // Build the refined query (compact list of top tokens)
    const keywords = topKeywords(scores, 12);
    const refined = keywords.join(" ");

    return refined || activeQuery;
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
              {/* search hidden for now */}
              {ENABLE_MANUAL_SEARCH && (
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
              )}

              <button
                onClick={() => analyzePoemAndSearch(userText)}
                disabled={loading}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Analyze with AI
              </button>

              <button
                onClick={() => {
                  const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
                  setUserText(p);              // show it in the Canvas
                  analyzePoemAndSearch(p);     // AI path (does its own resets + fetch)
                }}
                disabled={loading}
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
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setUserText(p);          // update Canvas text only
                      analyzePoemAndSearch(p); // AI path (no manual resets needed)
                    }}
                    disabled={loading}
                    className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
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