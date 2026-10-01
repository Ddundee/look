export type TaskStatus =
  | "inbox"
  | "todo"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export type RecurrencePattern =
  | "daily"
  | "weekdays"
  | "weekly"
  | "specific_days"
  | "monthly"
  | "custom_interval";

export const SEED_CATEGORIES = ["LeetCode", "school", "project", "personal", "errands"] as const;

export function isTaskDone(task: { status: TaskStatus }): boolean {
  return task.status === "completed" || task.status === "cancelled";
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  due_date: string | null;
  due_time: string | null;
  completed_at: string | null;
  estimated_duration: number | null;
  source: string;
  external_reference: string | null;
  notes: string | null;
  planned_for_date: string | null;
  recurrence_rule_id: string | null;
  occurrence_date: string | null;

  is_overdue: boolean;
  priority_score: number;
  priority_reasons: string[];
}

export interface TaskListResponse {
  tasks: Task[];
  count: number;
}

export interface TodayView {
  date: string;
  scheduled: Task[];
  due_today: Task[];
  overdue: Task[];
  recurring_today: Task[];
  suggested_high_priority: Task[];
}

export interface WeekSummary {
  start_date: string;
  end_date: string;
  completed_count: number;
  completed_by_category: Record<string, number>;
  created_count: number;
  overdue_count: number;
  completed_tasks: Task[];
}

export interface TaskCreatePayload {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  category?: string;
  tags?: string[];
  due_date?: string | null;
  due_time?: string | null;
  estimated_duration?: number | null;
  notes?: string | null;
  planned_for_date?: string | null;
}

export type TaskUpdatePayload = Partial<TaskCreatePayload>;

// ---- Nutrition ------------------------------------------------------------

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type MacroKey = "calories" | "protein_g" | "carbs_g" | "fat_g";

export interface FoodEntry {
  id: string;
  name: string;
  quantity: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meal: MealType | null;
  eaten_on: string;
  eaten_at: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export type MacroTotals = Record<MacroKey, number>;

export interface MacroRemaining {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface NutritionTargets {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  effective_from: string;
}

export interface DaySummary {
  day: string;
  entries: FoodEntry[];
  totals: MacroTotals;
  targets: NutritionTargets | null;
  remaining: MacroRemaining | null;
  over: MacroKey[];
}

export interface HistoryDay {
  day: string;
  entry_count: number;
  totals: MacroTotals;
  targets: NutritionTargets | null;
}

export interface HistorySummary {
  start_date: string;
  end_date: string;
  days: HistoryDay[];
  logged_days: number;
  averages: MacroTotals | null;
}

export interface TargetsResponse {
  current: NutritionTargets | null;
  history: NutritionTargets[];
}

export interface FoodEntryPayload {
  name?: string;
  calories?: number;
  quantity?: string | null;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  meal?: MealType | null;
  eaten_on?: string;
  eaten_at?: string | null;
  notes?: string | null;
}

export interface NutritionTargetsPayload {
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  effective_from?: string;
}

// ---- Events ---------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  location: string | null;
  notes: string | null;
  category: string;
  all_day: boolean;
  start_at: string; // local "YYYY-MM-DDTHH:MM:SS"
  end_at: string;
  rrule: string | null;
  exdates: string[];
  source: string;
  created_at: string;
  updated_at: string;
}

export interface Occurrence {
  event_id: string;
  occurrence_date: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  title: string;
  location: string | null;
  category: string;
  notes: string | null;
  recurring: boolean;
  rrule: string | null;
  overridden: boolean;
  cancelled: boolean;
}

export interface EventWithContext {
  event: CalendarEvent;
  next_occurrences: Occurrence[];
  conflicts: Occurrence[];
  dropped_overrides: string[];
}

export interface ScheduleResponse {
  start_date: string;
  end_date: string;
  occurrences: Occurrence[];
  count: number;
}

export interface EventPayload {
  title?: string;
  start_at?: string;
  end_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  category?: string;
  notes?: string | null;
  rrule?: string | null;
  exdates?: string[];
}

export interface OccurrenceEditPayload {
  cancel?: boolean;
  start_at?: string;
  end_at?: string;
  title?: string;
  location?: string | null;
  notes?: string | null;
}

// ---- Self-update ------------------------------------------------------------

export type UpdateJobState = "idle" | "pulling" | "backing_up" | "restarting" | "done" | "failed";

export interface UpdateJob {
  state: UpdateJobState;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  target: string | null;
  backup?: string | null;
}

export interface UpdateStatus {
  enabled: boolean;
  current?: { backend: string | null; frontend: string | null };
  latest?: { sha: string; published_at: string } | null;
  update_available?: boolean;
  changes?: { sha: string; message: string }[];
  checked_at?: string | null;
  check_error?: string | null;
  job?: UpdateJob;
}
