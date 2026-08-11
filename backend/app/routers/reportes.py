import asyncio

from fastapi import APIRouter, HTTPException, Query

from app.auth import CurrentUser
from app.database import get_pool
from app.repositories.reportes import (
    build_supply_analysis,
    fetch_abrupt_consumption_drops,
    fetch_report_master_page,
    fetch_report_header,
    fetch_supply_details,
    fetch_supply_indicators,
)

router = APIRouter(prefix="/reportes", tags=["reportes"])

# Campos que consume el panel de "Evolución Volumen" + hallazgos automáticos.
# El resto del payload del motor estadístico (operationalSummary, periods,
# components/thresholds detallados) no se usa en esta versión.
EVOLUTION_ROW_KEYS = (
    "year", "month", "label", "currentVolume", "previousVolume", "historicalMedian",
    "variationVsMedianPercent", "variationVsPreviousYearPercent", "previousYearDifference",
    "absoluteDifference", "isAnomaly", "severity", "type",
    "baselineYears", "baselineValues", "baselineSampleCount",
)
SUMMARY_KEYS = (
    "accumulatedVolume", "historicalAccumulatedMedian",
    "medianDeltaPercent", "medianDeltaM3", "previousDeltaPercent", "previousDeltaM3",
    "baselineStartYear", "baselineEndPeriod",
)
ANALYSIS_DETAIL_KEYS = ("severity", "score", "robustZScore", "reasons")
INSIGHT_CARD_KEYS = ("title", "description", "tone")


def _pick(source: dict, keys: tuple[str, ...]) -> dict:
    return {key: source.get(key) for key in keys}


def _shape_year(year_payload: dict) -> dict:
    return {
        "evolutionRows": [_pick(row, EVOLUTION_ROW_KEYS) for row in year_payload.get("evolutionRows", [])],
        "summary": _pick(year_payload.get("summary", {}), SUMMARY_KEYS),
        "insightCards": [_pick(card, INSIGHT_CARD_KEYS) for card in year_payload.get("insightCards", [])],
        "analysis": _pick(year_payload.get("analysis", {}), ANALYSIS_DETAIL_KEYS),
    }


@router.get("/master")
async def report_master(
    _user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str = Query(default="", max_length=160),
    filter_active: bool = Query(default=False),
    trend_direction: str = Query(default="either", pattern="^(increasing|decreasing|either)$"),
    min_trend_percent: float = Query(default=0, ge=0, le=10000),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
    baseline_start_period: str = Query(pattern=r"^\d{4}-\d{2}$"),
    baseline_end_period: str = Query(pattern=r"^\d{4}-\d{2}$"),
    target_start_period: str = Query(pattern=r"^\d{4}-\d{2}$"),
    target_end_period: str = Query(pattern=r"^\d{4}-\d{2}$"),
) -> dict:
    if baseline_start_period > baseline_end_period or target_start_period > target_end_period:
        raise HTTPException(status_code=400, detail="El rango de consumo no es valido.")
    return await fetch_report_master_page(
        get_pool(),
        page=page,
        page_size=page_size,
        search=search.strip(),
        filter_active=filter_active,
        trend_direction=trend_direction,
        min_trend_percent=min_trend_percent,
        sort_order=sort_order,
        baseline_start_period=baseline_start_period,
        baseline_end_period=baseline_end_period,
        target_start_period=target_start_period,
        target_end_period=target_end_period,
    )


@router.get("/anomalias/caidas-consumo")
async def abrupt_consumption_drops(_user: CurrentUser) -> dict:
    return await fetch_abrupt_consumption_drops(get_pool())

@router.get("/suministro/{supply_code}")
async def supply_report(supply_code: str, _user: CurrentUser) -> dict:
    normalized = supply_code.strip()
    pool = get_pool()
    header, analysis, indicators, details = await asyncio.gather(
        fetch_report_header(pool, normalized),
        build_supply_analysis(pool, normalized),
        fetch_supply_indicators(pool, normalized),
        fetch_supply_details(pool, normalized),
    )
    if not header:
        raise HTTPException(status_code=404, detail="Suministro no encontrado.")
    return {
        "supplyCode": analysis.get("supplyCode", normalized),
        "years": analysis.get("years", []),
        "header": header,
        "analysisByYear": {
            year: _shape_year(payload) for year, payload in analysis.get("analysisByYear", {}).items()
        },
        "indicators": indicators,
        "details": {
            **details,
            "billing": analysis.pop("billingRows", []),
        },
        "generatedAt": analysis.get("generatedAt"),
    }
