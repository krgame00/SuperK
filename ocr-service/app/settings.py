from pathlib import Path

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SUPERK_",
        env_file=".env",
        extra="ignore",
    )

    model_dir: Path = Path("models")
    cache_dir: Path = Path(".cache")
    max_workers: int = Field(default=1, ge=1)
    max_upload_mb: int = Field(default=80, gt=0)
    # Completed job asset dirs older than this are swept on startup/submit
    # (0 disables time-based sweep; assets are retained for the project lifetime).
    job_retention_hours: float = Field(default=0.0, ge=0)
    # Wall-clock budget for one cleaning job; a watchdog marks the job failed
    # when exceeded (the worker thread itself cannot be interrupted).
    # 0 disables the watchdog.
    job_timeout_minutes: float = Field(default=15.0, ge=0)
    # Pixel ceiling checked before decode — compressed bombs pass the byte
    # limit but would allocate gigabytes of RAM.
    max_image_megapixels: int = Field(default=64, gt=0)
    ocr_engine: str = Field(default="paddle")
    service_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:8765")
