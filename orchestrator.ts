import { AgentId, ready, callWithRetry } from "./providers";
export type Mode = "fast" | "balanced" | "deep" | "max";
const CAP: Record<Mode, number> = { fast: 1, balanced: 3, deep: 4, max: 5 }; // hard step cap also prevents agent loops
const MAX_CTX = 6000;

const ROLE_SYS: Record<AgentId, string> = {
  perplexity: "You are the Research Agent. Find current, verifiable information. Cite sources. Label points FACT (sourced) or ASSUMPTION. Be concise.",
  claude: "You are the Creation Agent. Turn the provided information into a high-quality, well-structured deliverable. Do not invent facts beyond your inputs; flag gaps.",
  grok: "You are the Challenge & Education Agent. Explain simply, offer alternative perspectives, challenge assumptions, and name concrete weaknesses and risks.",
  openai: "You are the Analysis & Planning Agent. Reason carefully; separate facts from opinions.",
};
const REVIEW_SYS = "You are the Final Reviewer. Never trust one agent blindly: detect contradictions, correct weak reasoning, distinguish sourced facts from opinions/assumptions, and say where agents disagree. Write ONE final answer for the user (plain text, light formatting, keep source URLs). End with 'Confidence: low/medium/high' and a one-line reason.";

export interface PlanStep { agent: AgentId; role: string; instruction: string; uses: number[] }
export interface Plan { task_type: string; clarify?: string; steps: PlanStep[] }

async function route(prompt: string, pool: AgentId[], mode: Mode): Promise<Plan> {
  const router = (["openai", "claude", "grok"] as AgentId[]).find(a => ready().includes(a));
  const fallback: Plan = { task_type: "general", steps: pool.length ? [{ agent: pool[0], role: "answer", instruction: prompt, uses: [] }] : [] };
  if (!router) return fallback;
  const sys = `You are an AI router. Choose ONLY the agents needed and their order. Reply with JSON only:
{"task_type":string,"clarify":string|null,"steps":[{"agent":"perplexity|claude|grok|openai","role":"research|creation|challenge|analysis","instruction":string,"uses":[indices of earlier steps whose output this step needs]}]}
Strengths: perplexity=current web facts with sources; claude=documents/presentations/structured content; grok=explanations, alternative views, challenging ideas; openai=planning/analysis.
Available agents: ${pool.join(", ")}. Max ${CAP[mode]} steps (a final review always runs after; do not add it).
Simple question: 0 or 1 step. Add research only if current info is needed; add challenge only if an idea needs testing. Set "clarify" (a question) ONLY if the request is genuinely ambiguous, else null.`;
  try {
    const { text } = await callWithRetry(router, sys, prompt, 25000);
    const j = JSON.parse(text.match(/\{[\s\S]*\}/)![0]);
    const steps: PlanStep[] = (Array.isArray(j.steps) ? j.steps : [])
      .filter((s: PlanStep) => pool.includes(s?.agent) && typeof s.instruction === "string")
      .slice(0, CAP[mode])
      .map((s: PlanStep, i: number) => ({ agent: s.agent, role: String(s.role || "task"), instruction: s.instruction, uses: (s.uses || []).filter((u: number) => Number.isInteger(u) && u >= 0 && u < i) }));
    return { task_type: String(j.task_type || "general"), clarify: j.clarify || undefined, steps };
  } catch { return fallback; }
}

type Out = { agent: string; role: string; text: string; sources?: string[] };
const block = (o: Out) => `--- ${o.agent} (${o.role}) ---\n${o.text.slice(0, MAX_CTX)}${o.sources?.length ? `\nSources: ${o.sources.slice(0, 8).join(", ")}` : ""}`;

export async function* run(prompt: string, mode: Mode, selected: AgentId[]) {
  const avail = ready();
  const pool = selected.length ? selected.filter(a => avail.includes(a)) : avail;
  if (!pool.length) { yield { t: "error", m: "No configured provider selected. Add API keys to .env.local and restart." }; return; }
  const plan = await route(prompt, pool, mode);
  if (plan.clarify) { yield { t: "clarify", q: plan.clarify }; return; }
  const reviewer = (["openai", "claude", "grok", "perplexity"] as AgentId[]).find(a => pool.includes(a))!;
  yield { t: "plan", plan, reviewer, estimate: plan.steps.length + 2 }; // +router +review

  const out: (Out | undefined)[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    yield { t: "step", i, agent: s.agent, status: "run" };
    const ctx = s.uses.map(j => out[j]).filter(Boolean).map(o => block(o!)).join("\n\n");
    const t0 = Date.now();
    try {
      const r = await callWithRetry(s.agent, ROLE_SYS[s.agent], `USER REQUEST:\n${prompt}\n\nYOUR TASK:\n${s.instruction}${ctx ? `\n\nINPUT FROM OTHER AGENTS:\n${ctx}` : ""}`);
      out[i] = { agent: s.agent, role: s.role, ...r };
      console.log(JSON.stringify({ ev: "step", agent: s.agent, ms: Date.now() - t0 }));
      yield { t: "step", i, agent: s.agent, status: "done", text: r.text, sources: r.sources };
    } catch (e) {
      console.error(JSON.stringify({ ev: "step_error", agent: s.agent, err: String(e) }));
      yield { t: "step", i, agent: s.agent, status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  }
  const done = out.filter(Boolean) as Out[];
  yield { t: "review", agent: reviewer };
  try {
    const failed = plan.steps.length - done.length;
    const r = await callWithRetry(reviewer, REVIEW_SYS,
      `USER REQUEST:\n${prompt}\n\n${done.length ? `AGENT OUTPUTS:\n${done.map(block).join("\n\n")}` : "No other agent outputs: answer directly."}${failed ? `\n\nNote: ${failed} agent(s) failed; say what is missing.` : ""}`);
    yield { t: "final", text: r.text };
  } catch (e) { yield { t: "error", m: `Final review failed: ${e instanceof Error ? e.message : e}` }; }
}
