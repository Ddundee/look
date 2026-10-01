from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    bind_host: str = "0.0.0.0"
    backend_port: int = 8000
    mcp_port: int = 8001

    db_engine: Literal["postgres", "sqlite"] = "postgres"
    postgres_user: str = "todo_app"
    postgres_password: str = "todo_app"
    postgres_db: str = "todo_app"
    postgres_host: str = "db"
    postgres_port: int = 5432
    sqlite_path: str = "./data/todo-app.db"

    api_token: str = "dev-insecure-token-change-me"
    session_secret: str = "dev-insecure-session-secret-change-me"
    admin_username: str = "admin"
    admin_password: str = "admin"
    session_ttl_hours: int = 720

    app_timezone: str = "UTC"
    log_level: str = "INFO"
    seed_demo_data: bool = False

    # Self-update: internal URL of the updater container (empty = feature
    # off) and the git commit this image was built from (set by CI).
    updater_url: str = ""
    app_revision: str = ""

    @property
    def database_url(self) -> str:
        if self.db_engine == "sqlite":
            return f"sqlite:///{self.sqlite_path}"
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
