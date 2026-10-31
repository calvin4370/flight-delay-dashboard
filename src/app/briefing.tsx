"use client";

import { useState } from "react";

type Result = { facts: unknown; briefing: string | null; error?: string; model?: string };

export default function Briefing({ airport, date, horizon }: { airport: string; date: string; horizon: number }) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/briefing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ airport, date, horizon }),
      });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-base font-semibold">Shift briefing</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">
        Written by Claude from this page&apos;s numbers and timestamped signals only. It adds no numbers of its own.
      </p>
      <button onClick={run} disabled={loading} aria-busy={loading}
        className="press control w-full bg-[var(--ink)] text-[var(--panel)] disabled:opacity-60">
        {loading ? "Writing briefing…" : "Write shift briefing"}
      </button>
      {result?.error && <p className="mt-2 rounded-md bg-[var(--watch-bg)] p-2 text-xs text-[var(--watch)]">{result.error}</p>}
      {result?.briefing && <div className="reveal mt-2 whitespace-pre-wrap rounded-md border border-[var(--line)] bg-[var(--panel)] p-3 text-xs leading-relaxed">{result.briefing}</div>}
      {result && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-[var(--muted)]">Facts given to Claude (source of every number)</summary>
          <pre className="max-h-64 overflow-auto rounded-md border border-[var(--line)] bg-[var(--panel)] p-2">{JSON.stringify(result.facts, null, 1)}</pre>
        </details>
      )}
    </section>
  );
}
