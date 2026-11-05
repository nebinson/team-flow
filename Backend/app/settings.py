from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "TeamFlow API"
    environment: str = "development"
    frontend_origin: str = "http://localhost:5173"
    mongodb_uri: str = ""
    mongodb_database: str = "teamflow"
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    email_verification_token_minutes: int = 1440
    verification_resend_cooldown_seconds: int = 60
    resend_api_key: str = ""
    email_from: str = ""
    nim_api_key: str = ""
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    nim_model: str = ""
    gemini_api_key: str = ""
    gemini_model: str = ""
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_model: str = ""
    ice_servers_json: str = '[{"urls":["stun:stun.l.google.com:19302"]}]'

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        extra="ignore",
    )


settings = Settings()
