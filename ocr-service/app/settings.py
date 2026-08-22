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
    ocr_engine: str = Field(default="paddle")
    service_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:8765")
