from enum import StrEnum

from pydantic import BaseModel, Field


class CleanerRoute(StrEnum):
    FLAT = "flat"
    GRADIENT = "gradient"
    ARTWORK = "artwork"


class RegionStatus(StrEnum):
    READY = "ready"
    REPAIRED = "repaired"
    NEEDS_REVIEW = "needs_review"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class JobStage(StrEnum):
    QUEUED = "queued"
    DETECTING = "detecting"
    REFINING = "refining"
    CLEANING = "cleaning"
    VERIFYING = "verifying"
    ENCODING = "encoding"
    COMPLETE = "complete"


class PixelRect(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class RegionRecord(BaseModel):
    id: str
    rect: PixelRect
    route: CleanerRoute
    confidence: float = Field(ge=0, le=1)
    status: RegionStatus
    residual_score: float = Field(ge=0)
    damage_score: float = Field(ge=0)


class JobProgress(BaseModel):
    stage: JobStage
    completed_regions: int = Field(ge=0)
    total_regions: int = Field(ge=0)
    elapsed_ms: int = Field(ge=0)


class CleaningResult(BaseModel):
    job_id: str
    source_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    clean_asset: str
    mask_asset: str
    regions: list[RegionRecord]
    timings_ms: dict[str, int]
