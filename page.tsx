"use client";
import { useEffect, useState } from "react";
const AG = {
  perplexity: { n: "Perplexity", r: "Research", c: "#4fb3bf" },
  claude: { n: "Claude", r: "Creation", c: "#f2b84b" },
  grok: { n: "Grok", r: "Challenge", c: "#b48cff" },
  openai: { n: "ChatGPT", r: "Review", c: "#5bd58c" },
} as const;
type Id = keyof typeof AG;
const IDS = Object.keys(AG) as Id[];
const MODES = [["fast", "Fast"], ["balanced", "Balanced"], ["deep", "Deep Research"], ["max", "Max quality"]];

export default function Home() {
  const [prompt, setPrompt] = useState(""); const [mode, setMode] = useState("balanced");
  const [sel, setSel] = useState<Id[]>([]); const [cfg, setCfg] = useState<Id[]>([]);
  const [plan, setPlan] = useState<any>(null); const [steps, setSteps] = useState<Record<number, any>>({});
  const [st, setSt] = useState<Record<string, string>>({}); const [fin, setFin] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [q, setQ] = useState("");
  useEffect(() => { fetch("/api/run").then(r => r.json()).then(d => setCfg(d.configured)).catch(() => {}); }, []);

  function on(e: any) {
    if (e.t === "plan") setPlan(e);
    else if (e.t === "step") { setSteps(s => ({ ...s, [e.i]: { ...s[e.i], ...e } })); setSt(s => ({ ...s, [e.agent]: e.status })); }
    else if (e.t === "review") setSt(s => ({ ...s, [e.agent]: "run" }));
    else if (e.t === "final") { setFin(e.text); setSt(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === "run" ? "done" : v]))); }
    else if (e.t === "clarify") setQ(e.q);
    else if (e.t === "error") setErr(e.m);
  }
  async function send() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setErr(""); setQ(""); setFin(""); setPlan(null); setSteps({}); setSt({});
    try {
      const r = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, mode, agents: sel }) });
      if (!r.ok || !r.body) { setErr((await r.json().catch(() => ({}))).error || "Request failed."); return; }
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const l of lines) if (l) on(JSON.parse(l));
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const label = (a: Id) => !cfg.includes(a) ? "no key" : st[a] === "run" ? "working" : st[a] === "done" ? "done" : st[a] === "error" ? "failed" : "ready";

  return (
    <main className="wrap">
      <header><h1>Command Center</h1><p>One request. The router picks the agents.</p></header>
      <section className="agents">
        <button className={`chip ${!sel.length ? "on" : ""}`} onClick={() => setSel([])}>Auto<small>Router decides</small></button>
        {IDS.map(a => (
          <button key={a} disabled={!cfg.includes(a)} className={`chip ${sel.includes(a) ? "on" : ""}`} style={{ "--c": AG[a].c } as any}
            onClick={() => setSel(s => s.includes(a) ? s.filter(x => x !== a) : [...s, a])}>
            <span><i className={`dot ${st[a] === "run" ? "pulse" : ""}`} />{AG[a].n}</span><small>{AG[a].r} · {label(a)}</small>
          </button>))}
      </section>
      <section className="box">
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe what you need…" rows={4}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
        <div className="bar">
          <select value={mode} onChange={e => setMode(e.target.value)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="send" onClick={send} disabled={busy || !prompt.trim()}>{busy ? "Working…" : "Send"}</button>
        </div>
      </section>
      {err && <div className="msg bad" role="alert">{err}</div>}
      {q && <div className="msg">The router needs one detail: {q}</div>}
      {plan && (
        <section className="flow">
          <h2>Workflow <small>{plan.plan.task_type} · about {plan.estimate} AI calls</small></h2>
          {plan.plan.steps.length === 0 && <p className="mut">Simple request: answered directly.</p>}
          {plan.plan.steps.map((s: any, i: number) => {
            const x = steps[i] || {};
            return (
              <details key={i} className={x.status || "wait"} style={{ "--c": AG[s.agent as Id].c } as any}>
                <summary><i className={`dot ${x.status === "run" ? "pulse" : ""}`} />{AG[s.agent as Id].n} <em>{s.role}</em><small>{x.status === "run" ? "working" : x.status || "queued"}</small></summary>
                <p className="mut">{s.instruction}</p>
                {x.error && <p className="bad">{x.error}</p>}
                {x.text && <pre>{x.text}</pre>}
                {x.sources?.length > 0 && <ul>{x.sources.map((u: string) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{u}</a></li>)}</ul>}
              </details>);
          })}
          <div className="rev" style={{ "--c": AG[plan.reviewer as Id].c } as any}><i className={`dot ${busy && !fin ? "pulse" : ""}`} />Final review by {AG[plan.reviewer as Id].n}</div>
        </section>)}
      {fin && <section className="final"><h2>Answer</h2><pre>{fin}</pre></section>}
    </main>
  );
}
