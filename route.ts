import { run } from "@/lib/orchestrator";
import { ready } from "@/lib/providers";
export const runtime = "nodejs"; export const maxDuration = 300;
const hits = new Map<string, number[]>(); // simple in-memory limiter; use Redis in production
const IDS = ["openai", "claude", "grok", "perplexity"];

export async function GET() { return Response.json({ configured: ready() }); } // reports which keys exist, never the keys

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local", now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (h.length >= 8) return Response.json({ error: "Rate limit: 8 requests per minute." }, { status: 429 });
  hits.set(ip, [...h, now]);
  const b = await req.json().catch(() => ({}));
  const prompt = String(b.prompt || "").trim().slice(0, 8000);
  if (!prompt) return Response.json({ error: "Enter a request first." }, { status: 400 });
  const mode = ["fast", "balanced", "deep", "max"].includes(b.mode) ? b.mode : "balanced";
  const agents = Array.isArray(b.agents) ? b.agents.filter((a: string) => IDS.includes(a)) : [];
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      try { for await (const e of run(prompt, mode, agents)) c.enqueue(enc.encode(JSON.stringify(e) + "\n")); }
      catch (e) { c.enqueue(enc.encode(JSON.stringify({ t: "error", m: String(e) }) + "\n")); }
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
