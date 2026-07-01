export type Accent = "blue" | "purple" | "green" | "orange" | "red" | "neutral";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
export const DEFAULT_WHATSAPP_RECIPIENT = "972546745182";
export const DEFAULT_WHATSAPP_RECIPIENT_LOCAL = "0546745182";

export type DashboardActivity = {
  id: string;
  title: string;
  activity_type: string;
  occurred_at: string;
  duration_minutes: number | null;
  module_id: string | null;
  discipline_name: string | null;
  discipline_slug: string | null;
  module_name: string | null;
  module_slug: string | null;
  module_type: string | null;
};

export type DashboardModule = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  priority: number;
  discipline_name: string;
  discipline_slug: string;
  behavior: ModuleBehavior;
};

export type WeeklyBalanceItem = {
  discipline_id: string;
  discipline_name: string;
  discipline_slug: string;
  discipline_color: string | null;
  activity_count: number;
  duration_minutes: number;
};

export type DashboardRecommendation = {
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
};

export type DashboardResponse = {
  today_focus: {
    question: string;
    primary: string;
    note: string;
  };
  real_signals: {
    today_activity_count: number;
    today_duration_minutes: number;
    week_activity_count: number;
    week_duration_minutes: number;
    active_module_count: number;
    last_activity_title: string | null;
    last_activity_at: string | null;
  };
  recent_activities: DashboardActivity[];
  active_modules: DashboardModule[];
  weekly_balance: WeeklyBalanceItem[];
  recommendations: DashboardRecommendation[];
};

export type JournalActivity = DashboardActivity & {
  notes: string | null;
  source: string;
  energy_level: number | null;
  mood_level: number | null;
};

export type AuditEvent = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  changes: Record<string, unknown>;
  actor: string;
  created_at: string;
};

export type CommunicationProvider = {
  id: string;
  name: string;
  type: string;
  channel: string;
  config: Record<string, unknown>;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export type CommunicationMessage = {
  id: string;
  provider_id: string;
  direction: string;
  channel: string;
  recipient: string | null;
  sender: string | null;
  content_text: string;
  status: string;
  provider_message_id: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ActivityTemplate = {
  id: string;
  discipline_id: string | null;
  module_id: string | null;
  title: string;
  activity_type: string;
  default_duration_minutes: number | null;
  discipline_name: string | null;
  discipline_slug: string | null;
  module_name: string | null;
  module_slug: string | null;
};

export type Discipline = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
};

export type LifeModule = {
  id: string;
  discipline_id: string;
  type: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  priority: number;
};

export type QuickLogPayload = {
  template_id?: string;
  module_id?: string;
  discipline_id?: string;
  title?: string;
  activity_type?: string;
  duration_minutes?: number;
  notes?: string;
};

export type ActivityTemplatePayload = {
  discipline_id?: string;
  module_id?: string;
  title: string;
  activity_type: string;
  default_duration_minutes?: number;
  sort_order?: number;
};

export type ModulePayload = {
  discipline_id: string;
  type: string;
  name: string;
  slug: string;
  description?: string;
  priority?: number;
};

export type ModuleUpdatePayload = {
  discipline_id?: string;
  name?: string;
  description?: string;
  status?: string;
  priority?: number;
};

export type ModuleBehavior = {
  module_id: string;
  type: string;
  config: Record<string, unknown>;
  summary: Record<string, unknown>;
};

export type ProjectItemType = "task" | "bug" | "feature";
export type ProjectItemStatus = "todo" | "in_progress" | "done";

export type ProjectItem = {
  id: string;
  module_id: string;
  item_type: ProjectItemType;
  title: string;
  description: string | null;
  status: ProjectItemStatus;
  priority: number;
  due_date: string | null;
  completed_at: string | null;
  completed_activity_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectSummary = {
  progress_percent: number;
  tasks_open: number;
  tasks_done: number;
  bugs_open: number;
  bugs_done: number;
  features_open: number;
  features_done: number;
  total_open: number;
  total_done: number;
  weekly_activity_count: number;
  weekly_minutes: number;
};

export type ProjectOverview = {
  module: LifeModule;
  summary: ProjectSummary;
  items: ProjectItem[];
  recent_activities: DashboardActivity[];
};

export type ProjectItemPayload = {
  item_type: ProjectItemType;
  title: string;
  description?: string;
  priority?: number;
};

export type LearningUnitType = "topic" | "lab" | "machine";
export type LearningUnitStatus = "not_started" | "in_progress" | "completed";

export type LearningUnit = {
  id: string;
  module_id: string;
  unit_type: LearningUnitType;
  title: string;
  status: LearningUnitStatus;
  sort_order: number;
  completed_at: string | null;
  completed_activity_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LearningSummary = {
  progress_percent: number;
  learning_units_total: number;
  learning_units_done: number;
  study_minutes: number;
  study_sessions: number;
  weekly_activity_count: number;
  weekly_minutes: number;
};

export type LearningOverview = {
  module: LifeModule;
  summary: LearningSummary;
  units: LearningUnit[];
  recent_activities: DashboardActivity[];
};

export type LearningUnitPayload = {
  unit_type: LearningUnitType;
  title: string;
};

export type WellbeingMetricDef = {
  key: string;
  label: string;
  min: number;
  max: number;
  good: "low" | "high";
};

export type WellbeingMetricStat = {
  latest: number | null;
  avg: number | null;
  count: number;
};

export type WellbeingSummary = {
  sessions_week: number;
  weekly_minutes: number;
  weekly_activity_count: number;
  metrics: Record<string, WellbeingMetricStat>;
};

export type WellbeingOverview = {
  module: LifeModule;
  metric_defs: WellbeingMetricDef[];
  summary: WellbeingSummary;
  recent_sessions: DashboardActivity[];
  trends: Record<string, number[]>;
};

export type WellbeingSessionPayload = {
  duration_minutes?: number;
  notes?: string;
  values: Record<string, number>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Atlas API error ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getDashboard(): Promise<DashboardResponse> {
  return request<DashboardResponse>("/dashboard/today");
}

export function getActivities(): Promise<JournalActivity[]> {
  return request<JournalActivity[]>("/activities?limit=100");
}

export function getAuditEvents(): Promise<AuditEvent[]> {
  return request<AuditEvent[]>("/audit-events?limit=100");
}

export function getCommunicationProviders(): Promise<CommunicationProvider[]> {
  return request<CommunicationProvider[]>("/communication/providers");
}

export function createCommunicationProvider(): Promise<CommunicationProvider> {
  return request<CommunicationProvider>("/communication/providers", {
    method: "POST",
    body: JSON.stringify({
      name: "Evolution Provider",
      type: "evolution",
      channel: "whatsapp",
      config: { dry_run: true, instance: "atlas", default_recipient: DEFAULT_WHATSAPP_RECIPIENT }
    })
  });
}

export function getCommunicationMessages(): Promise<CommunicationMessage[]> {
  return request<CommunicationMessage[]>("/communication/messages?limit=100");
}

export function sendCommunicationMessage(providerId: string, recipient: string, contentText: string): Promise<CommunicationMessage> {
  return request<CommunicationMessage>("/communication/messages", {
    method: "POST",
    body: JSON.stringify({ provider_id: providerId, recipient, content_text: contentText })
  });
}

export function getActivityTemplates(): Promise<ActivityTemplate[]> {
  return request<ActivityTemplate[]>("/activity-templates");
}

export function getDisciplines(): Promise<Discipline[]> {
  return request<Discipline[]>("/disciplines");
}

export function getModules(): Promise<LifeModule[]> {
  return request<LifeModule[]>("/modules");
}

export function createModule(payload: ModulePayload): Promise<LifeModule> {
  return request<LifeModule>("/modules", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateModule(moduleId: string, payload: ModuleUpdatePayload): Promise<LifeModule> {
  return request<LifeModule>(`/modules/${moduleId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function archiveModule(moduleId: string): Promise<LifeModule> {
  return request<LifeModule>(`/modules/${moduleId}/archive`, { method: "POST" });
}

export function pauseModule(moduleId: string): Promise<LifeModule> {
  return request<LifeModule>(`/modules/${moduleId}/pause`, { method: "POST" });
}

export function resumeModule(moduleId: string): Promise<LifeModule> {
  return request<LifeModule>(`/modules/${moduleId}/resume`, { method: "POST" });
}

export function getModuleBehavior(moduleId: string): Promise<ModuleBehavior> {
  return request<ModuleBehavior>(`/modules/${moduleId}/behavior`);
}

export function updateModuleBehavior(moduleId: string, config: Record<string, number>): Promise<ModuleBehavior> {
  return request<ModuleBehavior>(`/modules/${moduleId}/behavior`, {
    method: "PATCH",
    body: JSON.stringify({ config })
  });
}

export function createActivityTemplate(payload: ActivityTemplatePayload): Promise<ActivityTemplate> {
  return request<ActivityTemplate>("/activity-templates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function quickLog(payload: QuickLogPayload): Promise<DashboardActivity> {
  return request<DashboardActivity>("/activities/quick-log", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export type CreateActivityPayload = {
  title: string;
  activity_type: string;
  module_id?: string;
  discipline_id?: string;
  duration_minutes?: number;
  notes?: string;
  occurred_at?: string;
  source?: string;
};

export type ActivityUpdatePayload = {
  title?: string;
  duration_minutes?: number | null;
  notes?: string | null;
  occurred_at?: string;
  module_id?: string | null;
  discipline_id?: string | null;
};

export function createActivity(payload: CreateActivityPayload): Promise<JournalActivity> {
  return request<JournalActivity>("/activities", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateActivity(activityId: string, payload: ActivityUpdatePayload): Promise<JournalActivity> {
  return request<JournalActivity>(`/activities/${activityId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteActivity(activityId: string): Promise<JournalActivity> {
  return request<JournalActivity>(`/activities/${activityId}`, {
    method: "DELETE"
  });
}

export function getProjectOverview(moduleId: string): Promise<ProjectOverview> {
  return request<ProjectOverview>(`/project/${moduleId}/overview`);
}

export function createProjectItem(moduleId: string, payload: ProjectItemPayload): Promise<ProjectItem> {
  return request<ProjectItem>(`/project/${moduleId}/items`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateProjectItem(
  moduleId: string,
  itemId: string,
  payload: Partial<Pick<ProjectItem, "status" | "title" | "priority" | "item_type">>
): Promise<ProjectItem> {
  return request<ProjectItem>(`/project/${moduleId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function completeProjectItem(moduleId: string, itemId: string, durationMinutes?: number): Promise<ProjectItem> {
  return request<ProjectItem>(`/project/${moduleId}/items/${itemId}/complete`, {
    method: "POST",
    body: JSON.stringify({ log_activity: true, duration_minutes: durationMinutes })
  });
}

export function deleteProjectItem(moduleId: string, itemId: string): Promise<ProjectItem> {
  return request<ProjectItem>(`/project/${moduleId}/items/${itemId}`, {
    method: "DELETE"
  });
}

export function getLearningOverview(moduleId: string): Promise<LearningOverview> {
  return request<LearningOverview>(`/learning/${moduleId}/overview`);
}

export function createLearningUnit(moduleId: string, payload: LearningUnitPayload): Promise<LearningUnit> {
  return request<LearningUnit>(`/learning/${moduleId}/units`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateLearningUnit(
  moduleId: string,
  unitId: string,
  payload: Partial<Pick<LearningUnit, "status" | "title" | "unit_type">>
): Promise<LearningUnit> {
  return request<LearningUnit>(`/learning/${moduleId}/units/${unitId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function completeLearningUnit(moduleId: string, unitId: string, durationMinutes?: number): Promise<LearningUnit> {
  return request<LearningUnit>(`/learning/${moduleId}/units/${unitId}/complete`, {
    method: "POST",
    body: JSON.stringify({ log_activity: true, duration_minutes: durationMinutes })
  });
}

export function deleteLearningUnit(moduleId: string, unitId: string): Promise<LearningUnit> {
  return request<LearningUnit>(`/learning/${moduleId}/units/${unitId}`, {
    method: "DELETE"
  });
}

export function getWellbeingOverview(moduleId: string): Promise<WellbeingOverview> {
  return request<WellbeingOverview>(`/wellbeing/${moduleId}/overview`);
}

export function logWellbeingSession(
  moduleId: string,
  payload: WellbeingSessionPayload
): Promise<{ activity: DashboardActivity; metrics_recorded: string[] }> {
  return request(`/wellbeing/${moduleId}/session`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export type Proposal = {
  id: string;
  type: string;
  title: string;
  rationale: string | null;
  payload: Record<string, unknown>;
  status: string;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
};

export function getProposals(status = "pending"): Promise<Proposal[]> {
  return request<Proposal[]>(`/proposals?status=${encodeURIComponent(status)}`);
}

export function acceptProposal(id: string): Promise<Proposal> {
  return request<Proposal>(`/proposals/${id}/accept`, { method: "POST" });
}

export function dismissProposal(id: string): Promise<Proposal> {
  return request<Proposal>(`/proposals/${id}/dismiss`, { method: "POST" });
}
