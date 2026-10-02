import { FlagIcon } from "@phosphor-icons/react";
import { PRIORITY_LABEL, PRIORITY_TEXT, STATUS_LABEL, STATUS_STYLES } from "@/lib/format";
import type { TaskPriority, TaskStatus } from "@/lib/types";

export function PriorityFlag({ priority }: { priority: TaskPriority }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${PRIORITY_TEXT[priority]}`}>
      <FlagIcon weight="fill" className="h-3.5 w-3.5" aria-hidden />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-px text-[11px] font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// Categories are styled from Settings; see components/look.
export { CategoryTag } from "./look/Look";
