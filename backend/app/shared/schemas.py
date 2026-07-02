from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AtlasModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DisciplineCreate(AtlasModel):
    name: str = Field(min_length=1)
    slug: str = Field(min_length=1)
    description: str | None = None
    color: str | None = None
    icon: str | None = None
    sort_order: int = 0


class DisciplineUpdate(AtlasModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ModuleCreate(AtlasModel):
    discipline_id: str
    type: str
    name: str = Field(min_length=1)
    slug: str = Field(min_length=1)
    description: str | None = None
    priority: int = 3
    config: dict[str, Any] = Field(default_factory=dict)
    start_date: str | None = None
    target_date: str | None = None


class ModuleUpdate(AtlasModel):
    discipline_id: str | None = None
    name: str | None = None
    description: str | None = None
    status: str | None = None
    priority: int | None = None
    config: dict[str, Any] | None = None
    start_date: str | None = None
    target_date: str | None = None


class ModuleBehaviorUpdate(AtlasModel):
    config: dict[str, Any] = Field(default_factory=dict)


class ActivityCreate(AtlasModel):
    discipline_id: str | None = None
    module_id: str | None = None
    activity_type: str = Field(min_length=1)
    title: str = Field(min_length=1)
    notes: str | None = None
    occurred_at: str | None = None
    duration_minutes: int | None = None
    energy_level: int | None = None
    mood_level: int | None = None
    source: str = "manual"
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActivityUpdate(AtlasModel):
    discipline_id: str | None = None
    module_id: str | None = None
    activity_type: str | None = None
    title: str | None = None
    notes: str | None = None
    occurred_at: str | None = None
    duration_minutes: int | None = None
    energy_level: int | None = None
    mood_level: int | None = None
    metadata: dict[str, Any] | None = None


class QuickLogCreate(AtlasModel):
    template_id: str | None = None
    module_id: str | None = None
    discipline_id: str | None = None
    title: str | None = None
    activity_type: str | None = None
    duration_minutes: int | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActivityTemplateCreate(AtlasModel):
    discipline_id: str | None = None
    module_id: str | None = None
    title: str = Field(min_length=1)
    activity_type: str = Field(min_length=1)
    default_duration_minutes: int | None = None
    default_metadata: dict[str, Any] = Field(default_factory=dict)
    sort_order: int = 0


class ActivityTemplateUpdate(AtlasModel):
    discipline_id: str | None = None
    module_id: str | None = None
    title: str | None = None
    activity_type: str | None = None
    default_duration_minutes: int | None = None
    default_metadata: dict[str, Any] | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class MetricCreate(AtlasModel):
    discipline_id: str | None = None
    module_id: str | None = None
    activity_id: str | None = None
    metric_key: str = Field(min_length=1)
    value_number: float | None = None
    value_text: str | None = None
    scale_min: float | None = None
    scale_max: float | None = None
    unit: str | None = None
    recorded_at: str | None = None


class ProjectItemCreate(AtlasModel):
    item_type: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str | None = None
    status: str = "todo"
    priority: int = 3
    due_date: str | None = None


class ProjectItemUpdate(AtlasModel):
    item_type: str | None = None
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: int | None = None
    due_date: str | None = None


class ProjectItemComplete(AtlasModel):
    log_activity: bool = True
    duration_minutes: int | None = None
    notes: str | None = None


class LearningUnitCreate(AtlasModel):
    unit_type: str = Field(min_length=1)
    title: str = Field(min_length=1)
    status: str = "not_started"


class LearningUnitUpdate(AtlasModel):
    unit_type: str | None = None
    title: str | None = None
    status: str | None = None
    sort_order: int | None = None


class LearningUnitComplete(AtlasModel):
    log_activity: bool = True
    duration_minutes: int | None = None
    notes: str | None = None


class WellbeingSessionCreate(AtlasModel):
    duration_minutes: int | None = None
    notes: str | None = None
    values: dict[str, float] = Field(default_factory=dict)


class CommunicationProviderCreate(AtlasModel):
    name: str = Field(min_length=1)
    type: str = Field(min_length=1)
    channel: str = Field(min_length=1)
    config: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class CommunicationProviderUpdate(AtlasModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    is_active: bool | None = None


class CommunicationMessageCreate(AtlasModel):
    provider_id: str
    direction: str = "outbound"
    channel: str = "whatsapp"
    recipient: str | None = None
    sender: str | None = None
    content_text: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Response models
#
# These type the core (DB-column) fields of each entity for OpenAPI + output
# validation. They use extra="allow" on purpose: many responses carry dynamic
# fields on top of the columns — SQL-joined labels (discipline_name, module_name),
# derived objects (behavior), parsed JSON (config/metadata). extra="allow" lets
# those pass through untouched, so adding a response_model never strips a field the
# frontend depends on. Non-identity fields are optional to avoid spurious 500s.
# --------------------------------------------------------------------------- #
class AtlasResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


class DisciplineOut(AtlasResponse):
    id: str
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    color: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    is_active: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class LifeModuleOut(AtlasResponse):
    id: str
    discipline_id: str | None = None
    type: str | None = None
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    status: str | None = None
    priority: int | None = None
    config: dict[str, Any] | None = None
    start_date: str | None = None
    target_date: str | None = None
    archived_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ActivityOut(AtlasResponse):
    id: str
    discipline_id: str | None = None
    module_id: str | None = None
    activity_type: str | None = None
    title: str | None = None
    notes: str | None = None
    occurred_at: str | None = None
    duration_minutes: int | None = None
    energy_level: int | None = None
    mood_level: int | None = None
    source: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ActivityTemplateOut(AtlasResponse):
    id: str
    discipline_id: str | None = None
    module_id: str | None = None
    title: str | None = None
    activity_type: str | None = None
    default_duration_minutes: int | None = None
    default_metadata: dict[str, Any] | None = None
    sort_order: int | None = None
    is_active: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class AuditEventOut(AtlasResponse):
    id: str
    entity_type: str | None = None
    entity_id: str | None = None
    action: str | None = None
    summary: str | None = None
    changes: dict[str, Any] | None = None
    actor: str | None = None
    created_at: str | None = None


class CommunicationProviderOut(AtlasResponse):
    id: str
    name: str | None = None
    type: str | None = None
    channel: str | None = None
    config: dict[str, Any] | None = None
    is_active: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CommunicationMessageOut(AtlasResponse):
    id: str
    provider_id: str | None = None
    direction: str | None = None
    channel: str | None = None
    recipient: str | None = None
    sender: str | None = None
    content_text: str | None = None
    status: str | None = None
    provider_message_id: str | None = None
    error: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ProposalCreate(AtlasModel):
    type: str = Field(min_length=1)
    title: str = Field(min_length=1)
    rationale: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_by: str = "system"


class ProposalOut(AtlasResponse):
    id: str
    type: str | None = None
    title: str | None = None
    rationale: str | None = None
    payload: dict[str, Any] | None = None
    status: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    resolved_at: str | None = None


class GoalCreate(AtlasModel):
    title: str = Field(min_length=1)
    module_id: str | None = None
    discipline_id: str | None = None
    definition_of_done: str | None = None
    target_date: str | None = None
    capacity_minutes_per_week: int | None = None
    created_by: str = "user"


class RecommendationFeedback(AtlasModel):
    action: str = Field(min_length=1)


class StepLinkCreate(AtlasModel):
    activity_id: str = Field(min_length=1)


class GoalUpdate(AtlasModel):
    title: str | None = Field(default=None, min_length=1)
    module_id: str | None = None
    discipline_id: str | None = None
    definition_of_done: str | None = None
    target_date: str | None = None
    capacity_minutes_per_week: int | None = None


class GoalOut(AtlasResponse):
    id: str
    module_id: str | None = None
    discipline_id: str | None = None
    title: str | None = None
    definition_of_done: str | None = None
    status: str | None = None
    target_date: str | None = None
    capacity_minutes_per_week: int | None = None
    active_plan_id: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    achieved_at: str | None = None
