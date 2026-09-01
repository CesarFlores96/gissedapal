import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.repositories.updater import is_newer
from app.routers import updater as updater_router


@pytest.mark.parametrize(
    ("current", "latest", "expected"),
    [
        ("0.1.0", "0.2.0", True),
        ("0.2.0", "0.2.0", False),
        ("0.2.1", "0.2.0", False),
        ("0.9.9", "0.10.0", True),
    ],
)
def test_is_newer(current: str, latest: str, expected: bool) -> None:
    assert is_newer(current, latest) is expected


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    releases_dir = tmp_path / "releases"
    releases_dir.mkdir()
    (releases_dir / "latest.json").write_text(
        json.dumps({
            "version": "0.2.0",
            "notes": "Corrige capas de teselas.",
            "pub_date": "2026-08-05T00:00:00Z",
            "platforms": {
                "windows-x86_64": {
                    "signature": "firma-de-prueba",
                    "file": "SEDAPAL-GIS_0.2.0_x64-setup.nsis.zip",
                }
            },
        }),
        encoding="utf-8",
    )
    settings = SimpleNamespace(
        updater_releases_dir=str(releases_dir),
        updater_public_base_url="https://sedapalweb.com/fastapi",
    )
    monkeypatch.setattr(updater_router, "get_settings", lambda: settings)

    app = FastAPI()
    app.include_router(updater_router.router)
    return TestClient(app)


def test_returns_manifest_when_client_is_outdated(client: TestClient) -> None:
    response = client.get("/updater/windows/x86_64/0.1.0")
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == "0.2.0"
    assert body["signature"] == "firma-de-prueba"
    assert body["url"] == (
        "https://sedapalweb.com/fastapi/updater/files/SEDAPAL-GIS_0.2.0_x64-setup.nsis.zip"
    )


def test_returns_no_content_when_client_is_current(client: TestClient) -> None:
    response = client.get("/updater/windows/x86_64/0.2.0")
    assert response.status_code == 204


def test_returns_no_content_for_unknown_platform(client: TestClient) -> None:
    response = client.get("/updater/darwin/aarch64/0.1.0")
    assert response.status_code == 204
