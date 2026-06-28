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
