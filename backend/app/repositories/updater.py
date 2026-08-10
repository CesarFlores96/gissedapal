import json
import os

from app.config import Settings


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.strip().split("."))


def is_newer(current_version: str, latest_version: str) -> bool:
    return _version_tuple(latest_version) > _version_tuple(current_version)


def read_latest_release(settings: Settings) -> dict | None:
    manifest_path = os.path.join(settings.updater_releases_dir, "latest.json")
    if not os.path.exists(manifest_path):
        return None
    with open(manifest_path, encoding="utf-8") as handle:
        return json.load(handle)
