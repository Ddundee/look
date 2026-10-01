"use client";

import { TrayIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged } from "@/lib/events";
import { useTaskListState } from "@/lib/useTasks";
import { EmptyState, ErrorState, PageHeader, TaskList, TaskListSkeleton } from "@/components/PageParts";

export default function InboxPage() {
  const { tasks, loading, error, handleUpdated, handleDeleted } = useTaskListState(() =>
    api.listTasks({ status: "inbox" }).then((r) => r.tasks)
  );

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="Captured, not yet organized. Click a task to give it a date, priority, or category."
      />

      {error && <ErrorState message={error} onRetry={notifyTasksChanged} />}
      {loading ? (
        <TaskListSkeleton />
      ) : tasks.length === 0 ? (
        !error && (
          <EmptyState icon={TrayIcon} title="Inbox zero">
            Anything you add without a date lands here until you sort it.
          </EmptyState>
        )
      ) : (
        <TaskList tasks={tasks} onUpdated={handleUpdated} onDeleted={handleDeleted} />
      )}
    </div>
  );
}
