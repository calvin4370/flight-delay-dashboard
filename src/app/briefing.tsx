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
      <h2 className="mb-1 font-semibold">Shift briefing (Claude)</h2>
      <p className="mb-2 text-xs text-neutral-500">
        Restates model outputs and cited, timestamped signals only. It never adds numbers; the TMC decides.
      </p>
      <button onClick={run} disabled={loading} aria-busy={loading}
        className="rounded bg-neutral-900 px-3 py-1.5 text-white transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none disabled:opacity-60 dark:bg-white dark:text-black">
        {loading ? "Writing…" : `Brief ${airport} ${date}, ${horizon} h ahead`}
      </button>
      {result?.error && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{result.error}</p>}
      {result?.briefing && <div className="reveal mt-2 whitespace-pre-wrap rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-900">{result.briefing}</div>}
      {result && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-neutral-500">Facts given to Claude (source of every number)</summary>
          <pre className="max-h-64 overflow-auto rounded bg-neutral-100 p-2 dark:bg-neutral-900">{JSON.stringify(result.facts, null, 1)}</pre>
        </details>
      )}
    </section>
  );
}
