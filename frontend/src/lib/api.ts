import type {
  UpdateJob,
  UpdateStatus,
  CalendarEvent,
  EventPayload,
  EventWithContext,
  Occurrence,
  OccurrenceEditPayload,
  ScheduleResponse,
  DaySummary,
  FoodEntry,
  FoodEntryPayload,
  HistorySummary,
  NutritionTargetsPayload,
  TargetsResponse,
  Task,
  TaskCreatePayload,
  TaskListResponse,
  TaskUpdatePayload,
  TodayView,
  WeekSummary,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
  });

  if (res.status === 401) {
    // A wrong password at login is also a 401: let the login page show it.
    if (typeof window !== "undefined" && path !== "/api/auth/login" && window.location.pathname !== "/login") {
      // Hard navigation on purpose: this is a plain fetch helper with no
      // router instance, and a full reload also clears any stale client
      // state left over from the now-invalid session. `expired` tells
      // proxy.ts not to bounce back into the app on a leftover cookie.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login?expired=1";
    }
    throw new ApiError(401, "Not authenticated");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (Array.isArray(body.detail)) {
        // FastAPI validation errors: [{loc: ["body", "calories"], msg: "..."}]
        detail = body.detail
          .map((d: { loc?: unknown[]; msg?: string }) =>
            [d.loc?.filter((p) => p !== "body").join("."), d.msg].filter(Boolean).join(": ")
          )
          .join("; ");
      } else {
        detail = body.detail || JSON.stringify(body);
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  login: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  listTasks: (params: {
    status?: string;
    category?: string;
    priority?: string;
    tag?: string;
    due_before?: string;
    due_after?: string;
    planned_for_date?: string;
    include_completed?: boolean;
    q?: string;
  } = {}) => request<TaskListResponse>(`/api/tasks${qs(params)}`),

  rankedTasks: (limit = 20) => request<TaskListResponse>(`/api/tasks/ranked${qs({ limit })}`),

  getTask: (id: string) => request<Task>(`/api/tasks/${id}`),

  createTask: (payload: TaskCreatePayload) =>
    request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),

  updateTask: (id: string, payload: TaskUpdatePayload) =>
    request<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, { method: "DELETE" }),

  completeTask: (id: string) => request<Task>(`/api/tasks/${id}/complete`, { method: "POST" }),
  cancelTask: (id: string) => request<Task>(`/api/tasks/${id}/cancel`, { method: "POST" }),

  rescheduleTask: (id: string, due_date: string | null, due_time?: string | null) =>
    request<Task>(`/api/tasks/${id}/reschedule${qs({ due_date: due_date ?? "", due_time })}`, {
      method: "POST",
    }),

  setPriority: (id: string, priority: string) =>
    request<Task>(`/api/tasks/${id}/priority${qs({ priority })}`, { method: "POST" }),

  addNote: (id: string, note: string) =>
    request<Task>(`/api/tasks/${id}/notes${qs({ note })}`, { method: "POST" }),

  planForToday: (id: string, for_date?: string) =>
    request<Task>(`/api/tasks/${id}/plan-today${qs({ for_date })}`, { method: "POST" }),

  unplanFromToday: (id: string) =>
    request<Task>(`/api/tasks/${id}/unplan-today`, { method: "POST" }),

  getToday: () => request<TodayView>("/api/today"),
  getWeekSummary: (start_date?: string) =>
    request<WeekSummary>(`/api/week-summary${qs({ start_date })}`),
  carryForward: (from_date: string, to_date: string, priorities?: string[]) =>
    request<TaskListResponse>(
      `/api/today/carry-forward${qs({ from_date, to_date })}${
        priorities?.length ? "&" + priorities.map((p) => `priorities=${p}`).join("&") : ""
      }`,
      { method: "POST" }
    ),

  getNutritionDay: (date?: string) => request<DaySummary>(`/api/nutrition/day${qs({ date })}`),
  getNutritionHistory: (start_date: string, end_date?: string) =>
    request<HistorySummary>(`/api/nutrition/history${qs({ start_date, end_date })}`),
  createFoodEntry: (payload: FoodEntryPayload) =>
    request<{ entry: FoodEntry; day: DaySummary }>("/api/nutrition/entries", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateFoodEntry: (id: string, payload: FoodEntryPayload) =>
    request<{ entry: FoodEntry; day: DaySummary }>(`/api/nutrition/entries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteFoodEntry: (id: string) =>
    request<{ deleted_id: string; day: DaySummary }>(`/api/nutrition/entries/${id}`, {
      method: "DELETE",
    }),
  getNutritionTargets: () => request<TargetsResponse>("/api/nutrition/targets"),
  setNutritionTargets: (payload: NutritionTargetsPayload) =>
    request<TargetsResponse>("/api/nutrition/targets", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  getSchedule: (start_date: string, end_date?: string, include_cancelled?: boolean) =>
    request<ScheduleResponse>(`/api/events/schedule${qs({ start_date, end_date, include_cancelled })}`),
  previewEvent: (p: { start_at: string; end_at?: string; all_day?: boolean; rrule: string }) =>
    request<Occurrence[]>(`/api/events/preview${qs(p)}`),
  getEvent: (id: string) => request<CalendarEvent>(`/api/events/${id}`),
  createEvent: (payload: EventPayload) =>
    request<EventWithContext>("/api/events", { method: "POST", body: JSON.stringify(payload) }),
  updateEvent: (id: string, payload: EventPayload) =>
    request<EventWithContext>(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteEvent: (id: string) => request<{ deleted_id: string }>(`/api/events/${id}`, { method: "DELETE" }),
  editOccurrence: (id: string, day: string, payload: OccurrenceEditPayload) =>
    request<Occurrence>(`/api/events/${id}/occurrences/${day}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  restoreOccurrence: (id: string, day: string) =>
    request<Occurrence>(`/api/events/${id}/occurrences/${day}`, { method: "DELETE" }),

  getVersion: () => request<{ revision: string | null }>("/api/system/version"),
  getUpdateStatus: (refresh = false) =>
    request<UpdateStatus>(`/api/system/update${qs({ refresh: refresh || undefined })}`),
  startUpdate: () => request<{ job: UpdateJob }>("/api/system/update", { method: "POST" }),
};
