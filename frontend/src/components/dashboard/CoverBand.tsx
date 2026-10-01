"use client";

import { TreePalmIcon } from "@phosphor-icons/react";
import { formatDateLong } from "@/lib/format";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** The dashboard's header, painted like the album cover: a deep sky
 * fading to the horizon, a teal sea, a thin white line, mustard sand and
 * a palm rising from it. Text sits on the darkest part of the sky. The
 * greeting needs the client clock, so it only renders once `date` (from
 * the API) arrives, which also keeps server and client markup equal. */
export default function CoverBand({ date, summary }: { date: string | null; summary: string | null }) {
  return (
    <section aria-label="Overview" className="relative isolate overflow-hidden rounded-2xl elev-1">
      <div className="h-40 bg-[linear-gradient(to_bottom,var(--cover-sky-top)_0%,var(--cover-sky-mid)_58%,var(--cover-horizon)_100%)] sm:h-48">
        <div className="relative z-10 max-w-[68%] px-5 pt-5 sm:px-7 sm:pt-6">
          {date ? (
            <>
              <p className="text-[13px] font-medium text-cover-cream/80">{formatDateLong(date)}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-cover-cream sm:text-3xl">{greeting()}</h1>
              {summary && <p className="mt-1.5 text-sm text-cover-cream/90">{summary}</p>}
            </>
          ) : (
            <span className="shimmer block h-16 w-56 rounded-lg opacity-30" aria-hidden />
          )}
        </div>
      </div>
      <div className="h-6 bg-cover-sea sm:h-8" />
      <div className="h-[3px] bg-cover-line" />
      <div className="h-4 bg-cover-sand sm:h-5" />
      <TreePalmIcon
        weight="fill"
        aria-hidden
        className="pointer-events-none absolute -bottom-2 -right-5 h-32 w-32 text-cover-ink sm:-bottom-3 sm:right-12 sm:h-56 sm:w-56"
      />
    </section>
  );
}
