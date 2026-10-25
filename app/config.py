"""Configuración leída del entorno, en un solo lugar."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str


def get_settings() -> Settings:
    return Settings(
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql://ppm:ppm@localhost:5432/ppm"
        ),
    )
