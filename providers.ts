// One module per provider behind a common interface: swap or add providers here only.
export type AgentId = "openai" | "claude" | "grok" | "perplexity";
export interface Result { text: string; sources?: string[] }
export interface Provider {
  id: AgentId; name: string; configured(): boolean;
  call(system: string, prompt: string, signal: AbortSignal): Promise<Result>;
}
class HttpError extends Error { constructor(public status: number, m: string) { super(m); } }

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new HttpError(r.status, `${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// OpenAI, xAI and Perplexity share the chat-completions format.
const compat = (id: AgentId, name: string, keyEnv: string, url: string, modelEnv: string, def: string): Provider => ({
  id, name, configured: () => !!process.env[keyEnv],
  async call(system, prompt, signal) {
    const j = await post(url, { authorization: `Bearer ${process.env[keyEnv]}` },
      { model: process.env[modelEnv] || def, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }, signal);
    return { text: j.choices?.[0]?.message?.content ?? "", sources: j.citations };
  },
});

const claude: Provider = {
  id: "claude", name: "Claude", configured: () => !!process.env.ANTHROPIC_API_KEY,
  async call(system, prompt, signal) {
    const j = await post("https://api.anthropic.com/v1/messages",
      { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      { model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 3000, system, messages: [{ role: "user", content: prompt }] }, signal);
    return { text: (j.content || []).map((b: { text?: string }) => b.text || "").join("") };
  },
};

export const PROVIDERS: Record<AgentId, Provider> = {
  openai: compat("openai", "ChatGPT", "OPENAI_API_KEY", "https://api.openai.com/v1/chat/completions", "OPENAI_MODEL", "gpt-4o"),
  claude,
  grok: compat("grok", "Grok", "XAI_API_KEY", "https://api.x.ai/v1/chat/completions", "XAI_MODEL", "grok-4"),
  perplexity: compat("perplexity", "Perplexity", "PERPLEXITY_API_KEY", "https://api.perplexity.ai/chat/completions", "PERPLEXITY_MODEL", "sonar-pro"),
};
export const ready = (): AgentId[] => (Object.keys(PROVIDERS) as AgentId[]).filter(k => PROVIDERS[k].configured());

// 45s timeout, one retry on rate-limit/server/network errors.
export async function callWithRetry(agent: AgentId, system: string, prompt: string, ms = 45000): Promise<Result> {
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), ms);
    try { return await PROVIDERS[agent].call(system, prompt, ac.signal); }
    catch (e) {
      const s = e instanceof HttpError ? e.status : 0;
      if (attempt >= 1 || (s && s !== 429 && s < 500)) throw e instanceof Error && e.name === "AbortError" ? new Error("Timed out") : e;
      await new Promise(r => setTimeout(r, 1000));
    } finally { clearTimeout(timer); }
  }
}
