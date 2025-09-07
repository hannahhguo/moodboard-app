// src/app/api/analyze/route.ts   (or app/api/analyze/route.ts if no src/)
import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnalyzeRequest = {
  text: string;
  contextHints?: string[];
  acceptedTitles?: string[];
};

export async function POST(req: Request) {
  try {
    const { text, contextHints = [], acceptedTitles = [] } = (await req.json()) as AnalyzeRequest;

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });
    }
    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const system = `
Return ONLY JSON with this schema:
{"moods":string[],"colors":string[],"imagery":string[],"aesthetics":string[],"avoid":string[],"search_query":string}
Be concrete and visual. No prose outside JSON.
`.trim();

    const user = `
POEM:
${text}

HINTS: ${contextHints.join(", ") || "(none)"}
KEPT IMAGES: ${acceptedTitles.join(", ") || "(none)"}
`.trim();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: system + "\n\n" + user }] }],
      generationConfig: { temperature: 0.6, responseMimeType: "application/json" },
    });

    const raw = result.response.text();
    let json: any;
    try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "Model did not return JSON" }, { status: 502 }); }

    const safe = {
      moods: Array.isArray(json.moods) ? json.moods : [],
      colors: Array.isArray(json.colors) ? json.colors : [],
      imagery: Array.isArray(json.imagery) ? json.imagery : [],
      aesthetics: Array.isArray(json.aesthetics) ? json.aesthetics : [],
      avoid: Array.isArray(json.avoid) ? json.avoid : [],
      search_query: typeof json.search_query === "string" ? json.search_query : "",
    };

    return NextResponse.json(safe);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Analyze failed" }, { status: 500 });
  }
}
