import { NextRequest } from "next/server";

type AnalyzeRequest = {
  text: string;
  acceptedTitles?: string[];
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AnalyzeRequest;

    const base = body.text?.trim() ?? "";
    const extras = (body.acceptedTitles ?? []).slice(0, 5).join(" ");
    const search_query = [base, extras].filter(Boolean).join(" ").trim();

    return Response.json({ search_query });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
