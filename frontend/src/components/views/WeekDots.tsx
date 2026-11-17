import type { ConsistencyDay } from "@/lib/types";

const WEEKDAY = ["M", "T", "W", "T", "F", "S", "S"];

/** Seven dots for a Mon-Sun week. */
export default function WeekDots({ days, today, filled, label, weekdays = true }: {
  days: ConsistencyDay[];
  today: string;
  filled: (d: ConsistencyDay) => boolean;
  label: string;
  /** Letters under the dots (leave off when rows are stacked). */
  weekdays?: boolean;
}) {
  return (
    <ol className="flex gap-1" aria-label={label}>
      {days.map((d, i) => {
        const on = filled(d);
        const future = d.date > today;
        return (
          <li key={d.date} className="flex flex-col items-center gap-0.5">
            <span
              title={`${d.date}${on ? ": yes" : ""}`}
              className={`block h-2.5 w-2.5 rounded-full ${
                on ? "bg-accent" : future ? "border border-dashed border-line" : "bg-surface-2"
              } ${d.date === today ? "ring-2 ring-accent-soft" : ""}`}
            />
            <span className="sr-only">{`${d.date}: ${on ? "yes" : future ? "not yet" : "no"}`}</span>
            {weekdays && <span aria-hidden className="text-[9px] leading-none text-fg-faint">{WEEKDAY[i]}</span>}
          </li>
        );
      })}
    </ol>
  );
}
