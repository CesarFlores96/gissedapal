from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.repositories.updater import is_newer, read_latest_release

router = APIRouter(prefix="/updater", tags=["updater"])


@router.get("/{target}/{arch}/{current_version}")
async def check_for_update(target: str, arch: str, current_version: str) -> Response:
    settings = get_settings()
    release = read_latest_release(settings)
    if release is None or not is_newer(current_version, release["version"]):
        return Response(status_code=204)

    platform_key = f"{target}-{arch}"
    platform = release["platforms"].get(platform_key)
    if platform is None:
        return Response(status_code=204)

    return JSONResponse({
        "version": release["version"],
        "notes": release.get("notes", ""),
        "pub_date": release["pub_date"],
        "url": f"{settings.updater_public_base_url}/updater/files/{platform['file']}",
        "signature": platform["signature"],
    })
