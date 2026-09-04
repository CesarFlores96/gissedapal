import pytest

from app.services.cache import SharedCache, cached_report, report_cache_key


def test_report_cache_key_is_stable_for_parameter_order() -> None:
    assert report_cache_key("master", 3, {"page": 1, "search": "ate"}) == report_cache_key(
        "master", 3, {"search": "ate", "page": 1}
    )


@pytest.mark.asyncio
async def test_cache_without_redis_degrades_to_loader(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = SharedCache()
    monkeypatch.setattr("app.services.cache.shared_cache", cache)
    calls = 0

    async def loader() -> dict:
        nonlocal calls
        calls += 1
        return {"data": ["source"]}

    class Pool:
        def connection(self):
            raise RuntimeError("database unavailable")

    result = await cached_report(Pool(), "master", {"page": 1}, 60, loader)  # type: ignore[arg-type]
    assert calls == 1
    assert result["data"] == ["source"]
    assert result["cache"] == {"status": "miss", "revision": 1}
