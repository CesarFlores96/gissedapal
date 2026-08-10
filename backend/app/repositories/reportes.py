from psycopg_pool import AsyncConnectionPool

from app.repositories.facturacion import fetch_facturacion
from app.repositories.shared import fetch_all, fetch_one
from app.services.consumption_analysis import analyze_supply_consumption, build_monthly_water


# Réplica de los campos derivados que ya calcula el sitio web hermano
# (apps/web/src/modules/reportes/reportes-master.ts y
# infrastructure/repositories/shared.ts) a partir de las mismas columnas de
# bd_facturacion_local, para que los badges del encabezado coincidan.
PAYER_CLASSIFICATION_LABELS = {
    "buen_pagador": "Buen pagador",
    "mal_pagador": "Mal pagador",
    "moroso_critico": "Mal pagador",
    "corte_programado": "Mal pagador",
}


def _classify_segment(segment_name: str | None, office_name: str | None) -> str:
    normalized = f"{segment_name or ''} {office_name or ''}".lower()
    if "fuente propia" in normalized or "fuente_propia" in normalized:
        return "Fuente Propia"
    if "grandes clientes" in normalized or "grandes_clientes" in normalized:
        return "Grandes Clientes"
    return "Sin clasificar"


def _map_payer_classification(value: str | None) -> str:
    if not value:
        return "Regular"
    return PAYER_CLASSIFICATION_LABELS.get(value, "Regular")


async def fetch_report_master_page(
    pool: AsyncConnectionPool,
    *,
    page: int,
    page_size: int,
    search: str,
    filter_active: bool,
    trend_direction: str,
    min_trend_percent: float,
    sort_order: str = "desc",
    baseline_start_period: str,
    baseline_end_period: str,
    target_start_period: str,
    target_end_period: str,
) -> dict:
    """Maestro filtrado por medianas de consumo de agua, igual que la web."""
    safe_page = max(page, 1)
    safe_page_size = min(max(page_size, 1), 100)
    offset = (safe_page - 1) * safe_page_size
    direction = trend_direction if trend_direction in {"increasing", "decreasing", "either"} else "either"
    minimum = max(min_trend_percent, 0)
    order_dir = "ASC" if sort_order.lower() == "asc" else "DESC"

    base_cte = """
        WITH ranges AS (
          SELECT to_date(%s || '-01', 'YYYY-MM-DD') AS baseline_start,
                 to_date(%s || '-01', 'YYYY-MM-DD') AS baseline_end,
                 to_date(%s || '-01', 'YYYY-MM-DD') AS target_start,
                 to_date(%s || '-01', 'YYYY-MM-DD') AS target_end
        ), debt_ranked AS (
          SELECT cd.supply_code, cd.period_year::int AS year, cd.period_month::int AS month,
                 cd.billed_volume_m3::float8 AS volume,
                 row_number() OVER (
                   PARTITION BY cd.supply_code, cd.period_year::int, cd.period_month::int, lower(cd.concept)
                   ORDER BY cd.updated_at DESC NULLS LAST, cd.created_at DESC NULLS LAST, cd.id DESC
                 ) AS source_rank
          FROM public.customer_debts cd, ranges r
          WHERE cd.concept = 'consumo_agua'
            AND make_date(cd.period_year::int, cd.period_month::int, 1)
                BETWEEN r.baseline_start AND r.target_end
        ), daily_ranked AS (
          SELECT b.supply_code, extract(year FROM b.issue_date)::int AS year,
                 extract(month FROM b.issue_date)::int AS month, b.billed_volume_m3::float8 AS volume,
                 row_number() OVER (
                   PARTITION BY b.supply_code, extract(year FROM b.issue_date)::int, extract(month FROM b.issue_date)::int, lower(b.concept)
                   ORDER BY b.source_batch_date DESC NULLS LAST, b.imported_at DESC NULLS LAST,
                            b.source_file DESC NULLS LAST, b.source_line_number DESC NULLS LAST, b.id DESC
                 ) AS source_rank
          FROM public.customer_supply_billing_daily b, ranges r
          WHERE b.issue_date >= r.baseline_start
            AND b.issue_date < r.target_end + interval '1 month'
            AND b.concept = 'consumo_agua'
        ), monthly AS (
          SELECT supply_code, make_date(year, month, 1) AS period, coalesce(volume, 0) AS volume
          FROM debt_ranked WHERE source_rank = 1
          UNION ALL
          SELECT daily.supply_code, make_date(daily.year, daily.month, 1), coalesce(daily.volume, 0)
          FROM daily_ranked daily
          WHERE daily.source_rank = 1
            AND NOT EXISTS (
              SELECT 1 FROM debt_ranked debt
              WHERE debt.source_rank = 1 AND debt.supply_code = daily.supply_code
                AND debt.year = daily.year AND debt.month = daily.month
            )
        ), medians AS (
          SELECT monthly.supply_code,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY volume)
                   FILTER (WHERE period BETWEEN r.baseline_start AND r.baseline_end))::float8 AS baseline_median,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY volume)
                   FILTER (WHERE period BETWEEN r.target_start AND r.target_end))::float8 AS target_median,
                 count(*) FILTER (WHERE period BETWEEN r.baseline_start AND r.baseline_end)::int AS baseline_points,
                 count(*) FILTER (WHERE period BETWEEN r.target_start AND r.target_end)::int AS target_points,
                 ((extract(year FROM age(r.baseline_end, r.baseline_start)) * 12
                    + extract(month FROM age(r.baseline_end, r.baseline_start)) + 1))::int AS baseline_months,
                 ((extract(year FROM age(r.target_end, r.target_start)) * 12
                    + extract(month FROM age(r.target_end, r.target_start)) + 1))::int AS target_months
          FROM monthly CROSS JOIN ranges r
          GROUP BY monthly.supply_code, r.baseline_start, r.baseline_end, r.target_start, r.target_end
        ), trends AS (
          SELECT supply_code, baseline_median, target_median,
                 CASE
                   WHEN baseline_median = 0 AND target_median = 0 THEN 0
                   WHEN baseline_median = 0 AND target_median > 0 THEN 100
                   ELSE ((target_median - baseline_median) / nullif(baseline_median, 0) * 100)::float8
                 END AS trend_percent,
                 target_median - baseline_median AS delta_m3,
                 baseline_points, target_points, baseline_months, target_months
          FROM medians
        ), debt_by_supply AS (
          SELECT customer_supply_id, sum(total_soles)::float8 AS supply_debt_soles
          FROM public.customer_debts
          WHERE status NOT IN ('pagada', 'condonada')
          GROUP BY customer_supply_id
        ), base AS (
          SELECT cs.supply_code,
                 coalesce(cs.customer_name, c.business_name, c.full_name, 'SUMINISTRO ' || cs.supply_code) AS customer_name,
                 coalesce(cs.district, c.district, 'SIN DISTRITO') AS district,
                 coalesce(debt.supply_debt_soles, 0)::float8 AS debt,
                 cs.office_name, cs.segment AS segment_name, cs.meter_code AS meter_serial,
                 cs.route_code, cs.itinerary_code,
                 %s || ' / ' || %s AS trend_period,
                 trends.target_median AS current_volume,
                 trends.baseline_median AS previous_volume,
                 trends.target_median, trends.baseline_median, trends.trend_percent
          FROM public.customer_supplies cs
          JOIN public.customers c ON c.id = cs.customer_id
          LEFT JOIN debt_by_supply debt ON debt.customer_supply_id = cs.id
          LEFT JOIN trends ON trends.supply_code = cs.supply_code
          WHERE (%s = '' OR cs.supply_code ILIKE '%%' || %s || '%%'
                 OR coalesce(cs.customer_name, c.business_name, c.full_name, '') ILIKE '%%' || %s || '%%'
                 OR coalesce(cs.district, c.district, '') ILIKE '%%' || %s || '%%')
            AND (%s = false OR (
                 trends.baseline_median >= 100
                 AND trends.baseline_points::float8 / nullif(trends.baseline_months, 0) >= 0.5
                 AND trends.target_points::float8 / nullif(trends.target_months, 0) >= 0.5
                 AND abs(trends.delta_m3) >= 50
                 AND abs(trends.trend_percent) >= %s
                 AND (%s = 'either'
                      OR (%s = 'increasing' AND trends.trend_percent > 0)
                      OR (%s = 'decreasing' AND trends.trend_percent < 0))))
        )
    """
    filters = [
        baseline_start_period, baseline_end_period, target_start_period, target_end_period,
        target_start_period, target_end_period,
        search, search, search, search,
        filter_active, minimum, direction, direction, direction,
    ]
    rows = await fetch_all(
        pool,
        base_cte + f"""
          SELECT supply_code AS "supplyCode", customer_name AS "customerName", district, debt,
                 office_name AS "officeName", segment_name AS "segmentName", meter_serial AS "meterSerial",
                 route_code AS "routeCode", itinerary_code AS "itineraryCode", trend_period AS "trendPeriod",
                 current_volume AS "currentVolume", previous_volume AS "previousVolume", trend_percent AS "trendPercent",
                 baseline_median AS "baselineMedianM3", target_median AS "targetMedianM3",
                 count(*) OVER()::int AS "_total",
                 coalesce(sum(debt) OVER(), 0)::float8 AS "_totalDebt",
                 coalesce(sum(CASE WHEN lower(concat_ws(' ', coalesce(segment_name, ''), coalesce(office_name, ''))) LIKE '%%grandes clientes%%' THEN debt ELSE 0 END) OVER(), 0)::float8 AS "_grandesClientesDebt",
                 coalesce(sum(CASE WHEN lower(concat_ws(' ', coalesce(segment_name, ''), coalesce(office_name, ''))) LIKE '%%fuente propia%%' THEN debt ELSE 0 END) OVER(), 0)::float8 AS "_fuentePropiaDebt"
          FROM base
          ORDER BY abs(coalesce(trend_percent, 0)) {order_dir}, customer_name, supply_code
          LIMIT %s OFFSET %s
        """,
        [*filters, safe_page_size, offset],
    )
    summary = rows[0] if rows else {}
    data = [
        {key: value for key, value in row.items() if not key.startswith("_")}
        for row in rows
    ]
    return {
        "data": data,
        "page": safe_page,
        "pageSize": safe_page_size,
        "total": int(summary.get("_total") or 0),
        "summary": {
            "totalDebt": summary.get("_totalDebt") or 0,
            "grandesClientesDebt": summary.get("_grandesClientesDebt") or 0,
            "fuentePropiaDebt": summary.get("_fuentePropiaDebt") or 0,
        },
    }


async def fetch_report_header(pool: AsyncConnectionPool, supply_code: str) -> dict | None:
    row = await fetch_one(
        pool,
        """
        SELECT
          coalesce(cs.customer_name, c.business_name, c.full_name) AS customer_name,
          coalesce(cs.district, c.district) AS district,
          cs.segment AS segment_name,
          cs.office_name,
          c.payer_classification,
          coalesce(debt.supply_debt_soles, 0)::float8 AS debt
        FROM public.customer_supplies cs
        JOIN public.customers c ON c.id = cs.customer_id
        LEFT JOIN LATERAL (
          SELECT sum(cd.total_soles)::float8 AS supply_debt_soles
          FROM public.customer_debts cd
          WHERE cd.customer_supply_id = cs.id
            AND cd.status NOT IN ('pagada', 'condonada')
        ) debt ON true
        WHERE cs.supply_code = %s
        LIMIT 1
        """,
        [supply_code],
    )
    if not row:
        return None
    debt = row.get("debt") or 0.0
    return {
        "customerName": row.get("customer_name"),
        "district": row.get("district"),
        "classification": _classify_segment(row.get("segment_name"), row.get("office_name")),
        "payerClassification": _map_payer_classification(row.get("payer_classification")),
        "serviceStatus": "Pendiente" if debt > 0 else "Activo",
        "debt": debt,
    }


async def build_supply_analysis(pool: AsyncConnectionPool, supply_code: str) -> dict:
    """Análisis estadístico de consumo (MDAS-2.0), calculado enteramente en
    este backend contra bd_facturacion_local -- sin depender de ningún
    servicio externo."""
    billing_rows = await fetch_facturacion(pool, supply_code)
    monthly_water = build_monthly_water(billing_rows)
    analysis = analyze_supply_consumption(supply_code, monthly_water)
    analysis["billingRows"] = billing_rows
    return analysis


async def fetch_supply_details(pool: AsyncConnectionPool, supply_code: str) -> dict:
    state_readings = await fetch_all(
        pool,
        """
        SELECT reading_date::text AS "readingDate", reading_type AS "readingType",
               meter_type AS "meterType", meter_serial AS "meterSerial", diameter_mm AS "diameterMm",
               reading_value AS "readingValue", incidence_label AS "incidenceLabel",
               incidence_detail AS "incidenceDetail", observation
        FROM public.customer_supply_state_readings
        WHERE supply_code = %s
        ORDER BY reading_date DESC NULLS LAST, id DESC
        LIMIT 100
        """,
        [supply_code],
    )
    meter_installations = await fetch_all(
        pool,
        """
        SELECT installation_date::text AS "installationDate", process_date::text AS "processDate",
               meter_serial AS "meterSerial", previous_meter_serial AS "previousMeterSerial",
               diameter_mm AS "diameterMm", status_code AS status,
               work_order_number::text AS "workOrderNumber",
               service_order_number::text AS "serviceOrderNumber",
               current_reading::float8 AS "currentReading", previous_reading::float8 AS "previousReading",
               useful_life_observation AS observation
        FROM public.meter_park_snapshots
        WHERE supply_code = %s
        ORDER BY installation_date DESC NULLS LAST, process_date DESC NULLS LAST
        LIMIT 100
        """,
        [supply_code],
    )
    work_orders = await fetch_all(
        pool,
        """
        SELECT wo.code, wo.order_type::text AS "orderType", wo.status::text AS status,
               wo.priority::text AS priority, wo.scheduled_date::text AS "scheduledDate",
               wo.completed_at::text AS "completedAt", wo.title, wo.description, wo.result_notes AS "resultNotes"
        FROM public.work_orders wo
        LEFT JOIN public.meters m ON m.id = wo.meter_id
        LEFT JOIN public.domestic_connections dc ON dc.id = coalesce(wo.connection_id, m.connection_id)
        WHERE dc.supply_code_ref = %s OR EXISTS (
          SELECT 1 FROM public.anomalies a WHERE a.work_order_id = wo.id AND a.supply_code = %s
        )
        ORDER BY wo.scheduled_date DESC NULLS LAST, wo.code
        LIMIT 100
        """,
        [supply_code, supply_code],
    )
    anomalies = await fetch_all(
        pool,
        """
        SELECT anomaly_type AS "anomalyType", detected_at::text AS "detectedAt",
               detected_value::float8 AS "detectedValue", expected_value::float8 AS "expectedValue",
               deviation_pct::float8 AS "deviationPercent", resolved,
               resolved_at::text AS "resolvedAt", resolution_notes AS "resolutionNotes",
               anomaly_status AS status, reading_observation AS "readingObservation",
               billing_observation AS "billingObservation", inspection_observation AS "inspectionObservation"
        FROM public.anomalies
        WHERE supply_code = %s
        ORDER BY detected_at DESC NULLS LAST
        LIMIT 100
        """,
        [supply_code],
    )
    inspections = await fetch_all(
        pool,
        """
        SELECT inspection_date::text AS "inspectionDate", visit_date::text AS "visitDate",
               work_order_number AS "workOrderNumber", inspection_typology AS typology,
               inspection_result AS result, service_status AS "serviceStatus",
               meter_serial AS "meterSerial", reading_value AS "readingValue", observation
        FROM public.commercial_inspections
        WHERE supply_code = %s
        ORDER BY coalesce(visit_date, inspection_date::date) DESC NULLS LAST, id DESC
        LIMIT 100
        """,
        [supply_code],
    )
    return {
        "stateReadings": state_readings,
        "meterInstallations": meter_installations,
        "workOrders": work_orders,
        "anomalies": anomalies,
        "inspections": inspections,
    }


async def fetch_supply_indicators(pool: AsyncConnectionPool, supply_code: str) -> dict:
    """Indicadores trazables calculados sobre facturacion canonica y GIS real.

    Las comparaciones usan el ultimo periodo de agua disponible del suministro.
    Los indicadores que requieren lote solo se publican cuando el punto cae dentro
    de una geometria catastral; no se aproximan areas ni perimetros.
    """
    territorial = await fetch_one(
        pool,
        """
        WITH target AS (
          SELECT cs.supply_code, gsl.geom, cst.district_code,
                 lot.id AS lot_id, lot.lot_code, lot.levels,
                 ST_Area(lot.geom::geography)::float8 AS lot_area_m2,
                 ST_Perimeter(lot.geom::geography)::float8 AS lot_perimeter_m,
                 coalesce(lot.block_id, point_block.id) AS block_id,
                 coalesce(lot_block.block_code, point_block.block_code) AS block_code,
                 coalesce(lot_block.geom, point_block.geom) AS block_geom,
                 ST_Perimeter(coalesce(lot_block.geom, point_block.geom)::geography)::float8 AS block_perimeter_m
          FROM public.customer_supplies cs
          LEFT JOIN public.gis_supply_locations gsl ON gsl.supply_code = cs.supply_code
          LEFT JOIN public.customer_supplies_territory cst ON cst.supply_code = cs.supply_code
          LEFT JOIN LATERAL (
            SELECT l.* FROM public.gis_lots l
            WHERE gsl.geom IS NOT NULL
              AND l.geom && ST_Expand(gsl.geom, 0.00002)
              AND ST_DWithin(l.geom::geography, gsl.geom::geography, 1)
            ORDER BY CASE WHEN ST_Covers(l.geom, gsl.geom) THEN 0 ELSE 1 END,
                     ST_Distance(l.geom::geography, gsl.geom::geography), ST_Area(l.geom)
            LIMIT 1
          ) lot ON true
          LEFT JOIN public.gis_blocks lot_block ON lot_block.id = lot.block_id
          LEFT JOIN LATERAL (
            SELECT b.* FROM public.gis_blocks b
            WHERE gsl.geom IS NOT NULL
              AND b.geom && ST_Expand(gsl.geom, 0.00002)
              AND ST_DWithin(b.geom::geography, gsl.geom::geography, 1)
            ORDER BY CASE WHEN ST_Covers(b.geom, gsl.geom) THEN 0 ELSE 1 END,
                     ST_Distance(b.geom::geography, gsl.geom::geography), ST_Area(b.geom)
            LIMIT 1
          ) point_block ON true
          WHERE cs.supply_code = %s
          LIMIT 1
        ), target_period AS (
          SELECT period_year, period_month FROM (
            SELECT cd.period_year::int AS period_year, cd.period_month::int AS period_month
            FROM public.customer_debts cd
            WHERE cd.supply_code = %s AND lower(cd.concept) = 'consumo_agua'
            UNION ALL
            SELECT extract(year FROM b.issue_date)::int, extract(month FROM b.issue_date)::int
            FROM public.customer_supply_billing_daily b
            WHERE b.supply_code = %s AND b.issue_date IS NOT NULL
              AND lower(b.concept) = 'consumo_agua'
          ) periods
          ORDER BY period_year DESC, period_month DESC LIMIT 1
        ), debt_ranked AS (
          SELECT cd.supply_code, lower(cd.concept) AS concept,
                 cd.billed_volume_m3::float8 AS volume, cd.amount_soles::float8 AS amount,
                 row_number() OVER (
                   PARTITION BY cd.supply_code, lower(cd.concept)
                   ORDER BY cd.updated_at DESC NULLS LAST, cd.created_at DESC NULLS LAST, cd.id DESC
                 ) AS source_rank
          FROM public.customer_debts cd, target_period period
          WHERE cd.period_year = period.period_year AND cd.period_month = period.period_month
        ), daily_ranked AS (
          SELECT b.supply_code, lower(b.concept) AS concept,
                 b.billed_volume_m3::float8 AS volume, b.amount_soles::float8 AS amount,
                 row_number() OVER (
                   PARTITION BY b.supply_code, lower(b.concept)
                   ORDER BY b.source_batch_date DESC NULLS LAST, b.imported_at DESC NULLS LAST,
                            b.source_file DESC NULLS LAST, b.source_line_number DESC NULLS LAST, b.id DESC
                 ) AS source_rank
          FROM public.customer_supply_billing_daily b, target_period period
          WHERE extract(year FROM b.issue_date) = period.period_year
            AND extract(month FROM b.issue_date) = period.period_month
        ), canonical_rows AS (
          SELECT supply_code, concept, volume, amount FROM debt_ranked WHERE source_rank = 1
          UNION ALL
          SELECT daily.supply_code, daily.concept, daily.volume, daily.amount
          FROM daily_ranked daily
          WHERE daily.source_rank = 1 AND NOT EXISTS (
            SELECT 1 FROM debt_ranked debt
            WHERE debt.source_rank = 1 AND debt.supply_code = daily.supply_code
              AND debt.concept = daily.concept
          )
        ), current_values AS (
          SELECT supply_code,
                 max(volume) FILTER (WHERE concept = 'consumo_agua')::float8 AS volume,
                 sum(coalesce(amount, 0))::float8 AS billed_amount
          FROM canonical_rows GROUP BY supply_code
        ), district_peers AS (
          SELECT peer.supply_code, values.volume, values.billed_amount
          FROM target
          JOIN public.customer_supplies_territory peer ON peer.district_code = target.district_code
          JOIN current_values values ON values.supply_code = peer.supply_code
          WHERE values.volume IS NOT NULL
        ), lot_peers AS (
          -- 1. Suministros encontrados por proximidad espacial al lote catastral
          SELECT DISTINCT locations.supply_code, values.volume, values.billed_amount, locations.geom
          FROM target
          JOIN public.gis_lots current_lot ON current_lot.id = target.lot_id
          JOIN public.gis_supply_locations locations
            ON locations.geom && ST_Expand(current_lot.geom, 0.00002)
           AND ST_DWithin(current_lot.geom::geography, locations.geom::geography, 1)
          JOIN current_values values ON values.supply_code = locations.supply_code
          WHERE values.volume IS NOT NULL
          -- 2. Suministros vinculados al mismo lote por cup_code; usa centroide del lote si no tiene GPS
          UNION
          SELECT DISTINCT peer_link.supply_code, cv.volume, cv.billed_amount,
                 coalesce(loc.geom, ST_PointOnSurface(current_lot.geom))
          FROM target
          JOIN public.gis_lots current_lot ON current_lot.id = target.lot_id
          JOIN public.gis_supply_lot_links peer_link ON peer_link.cup_code = current_lot.cup_code
          JOIN current_values cv ON cv.supply_code = peer_link.supply_code
          LEFT JOIN public.gis_supply_locations loc ON loc.supply_code = peer_link.supply_code
          WHERE cv.volume IS NOT NULL AND current_lot.cup_code IS NOT NULL
          -- 3. Siempre incluir el suministro actual; centroide del lote si no tiene GPS propio
          UNION
          SELECT target.supply_code, cv.volume, cv.billed_amount,
                 coalesce(target.geom, ST_PointOnSurface(current_lot.geom))
          FROM target
          LEFT JOIN public.gis_lots current_lot ON current_lot.id = target.lot_id
          LEFT JOIN current_values cv ON cv.supply_code = target.supply_code
          WHERE target.geom IS NOT NULL OR current_lot.geom IS NOT NULL
        ), block_peers AS (
          SELECT DISTINCT locations.supply_code, values.volume, values.billed_amount
          FROM target
          JOIN public.gis_lots block_lot ON block_lot.block_id = target.block_id
          JOIN public.gis_supply_locations locations
            ON locations.geom && ST_Expand(block_lot.geom, 0.00002)
           AND ST_DWithin(block_lot.geom::geography, locations.geom::geography, 1)
          JOIN current_values values ON values.supply_code = locations.supply_code
          WHERE values.volume IS NOT NULL
        ), block_supplies_geo AS (
          -- Suministros de la manzana con sus coordenadas GPS para mostrar en el mapa
          SELECT DISTINCT locations.supply_code, values.volume, values.billed_amount, locations.geom
          FROM target
          JOIN public.gis_lots block_lot ON block_lot.block_id = target.block_id
          JOIN public.gis_supply_locations locations
            ON locations.geom && ST_Expand(block_lot.geom, 0.00002)
           AND ST_DWithin(block_lot.geom::geography, locations.geom::geography, 1)
          JOIN current_values values ON values.supply_code = locations.supply_code
          WHERE values.volume IS NOT NULL AND target.block_id IS NOT NULL
          -- Incluir también los suministros del lote (con sus puntos/centroides)
          UNION
          SELECT lp.supply_code, lp.volume, lp.billed_amount, lp.geom
          FROM lot_peers lp WHERE lp.geom IS NOT NULL
        ), neighbor_peers AS (
          SELECT locations.supply_code, values.volume
          FROM target
          JOIN public.gis_supply_locations locations
            ON target.geom IS NOT NULL
           AND locations.geom && ST_Expand(target.geom, 0.003)
           AND ST_DWithin(locations.geom::geography, target.geom::geography, 250)
          JOIN current_values values ON values.supply_code = locations.supply_code
          WHERE values.volume IS NOT NULL AND locations.supply_code <> target.supply_code
        -- Área agregada por cup_code: un lote logico puede tener varios poligonos
        -- (MULTIPARCEL_SAME_BLOCK), por lo que se suma en vez de unir 1:N y duplicar consumo.
        ), lot_area_by_cup AS (
          SELECT cup_code, sum(ST_Area(geom::geography))::float8 AS area_m2
          FROM public.gis_lots
          WHERE cup_code IS NOT NULL
          GROUP BY cup_code
        ), current_link AS (
          SELECT link.cua_catalog_id
          FROM public.gis_supply_lot_links link, target
          WHERE link.supply_code = target.supply_code
        ), district_lot_peers AS (
          SELECT peer_link.supply_code, values.volume, area_by_cup.area_m2
          FROM target
          JOIN public.customer_supplies_territory peer_territory ON peer_territory.district_code = target.district_code
          JOIN public.gis_supply_lot_links peer_link ON peer_link.supply_code = peer_territory.supply_code
          JOIN lot_area_by_cup area_by_cup ON area_by_cup.cup_code = peer_link.cup_code
          JOIN current_values values ON values.supply_code = peer_link.supply_code
          WHERE area_by_cup.area_m2 > 0 AND values.volume IS NOT NULL
        -- Lotes "similares": misma clasificacion de uso de agua (CUA) y area
        -- dentro de +/-30 pct de la del lote actual, sin importar distrito.
        ), similar_lot_peers AS (
          SELECT peer_link.supply_code, values.volume
          FROM target
          CROSS JOIN current_link
          JOIN public.gis_supply_lot_links peer_link
            ON peer_link.cua_catalog_id = current_link.cua_catalog_id
           AND peer_link.supply_code <> target.supply_code
          JOIN lot_area_by_cup area_by_cup ON area_by_cup.cup_code = peer_link.cup_code
          JOIN current_values values ON values.supply_code = peer_link.supply_code
          WHERE current_link.cua_catalog_id IS NOT NULL
            AND target.lot_area_m2 IS NOT NULL
            AND values.volume IS NOT NULL
            AND area_by_cup.area_m2 BETWEEN target.lot_area_m2 * 0.7 AND target.lot_area_m2 * 1.3
        )
        SELECT target.district_code AS "districtCode", target.geom IS NOT NULL AS "hasGeolocation",
               target.lot_id IS NOT NULL AS "hasLot", target.block_id IS NOT NULL AS "hasBlock",
               target.block_code AS "blockCode",
               ST_AsGeoJSON(target.block_geom)::jsonb AS "blockGeometry",
               coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id', block_lot.id::text,
                   'lotCode', block_lot.lot_code,
                   'areaM2', ST_Area(block_lot.geom::geography)::float8,
                   'isCurrent', block_lot.id = target.lot_id,
                   'geometry', ST_AsGeoJSON(block_lot.geom)::jsonb
                 ) ORDER BY block_lot.lot_code)
                 FROM public.gis_lots block_lot
                 WHERE block_lot.block_id = target.block_id
               ), '[]'::jsonb) AS "blockLots",
               target.lot_area_m2 AS "lotAreaM2", target.lot_perimeter_m AS "lotPerimeterM",
               target.block_perimeter_m AS "blockPerimeterM",
               (SELECT sum(ST_Area(block_lot.geom::geography))::float8
                  FROM public.gis_lots block_lot WHERE block_lot.block_id = target.block_id) AS "blockLotAreaM2",
               target.levels AS "lotLevels", period.period_year AS "periodYear",
               period.period_month AS "periodMonth", current.volume AS "currentConsumptionM3",
               current.billed_amount AS "currentBillingSoles",
               (SELECT avg(volume)::float8 FROM district_peers) AS "districtAverageM3",
               (SELECT sum(volume)::float8 FROM district_peers) AS "districtConsumptionM3",
               (SELECT sum(billed_amount)::float8 FROM district_peers) AS "districtBillingSoles",
               (SELECT count(*)::int FROM district_peers) AS "districtSupplyCount",
               CASE WHEN current.volume IS NULL THEN NULL ELSE
                 (SELECT count(*)::int + 1 FROM district_peers WHERE volume > current.volume)
               END AS "districtRank",
               (SELECT count(*)::float8 * 100 / nullif((SELECT count(*) FROM district_peers), 0)
                  FROM district_peers WHERE volume <= current.volume) AS "consumptionPercentile",
               (SELECT avg(volume)::float8 FROM block_peers) AS "blockAverageM3",
               (SELECT sum(volume)::float8 FROM lot_peers) AS "lotConsumptionM3",
               (SELECT count(*)::int FROM lot_peers) AS "lotSupplyCount",
               (SELECT jsonb_agg(jsonb_build_object(
                  'supplyCode', lot_peers.supply_code,
                  'volume', lot_peers.volume,
                  'billingSoles', lot_peers.billed_amount,
                  'isCurrent', lot_peers.supply_code = target.supply_code,
                  'point', ST_AsGeoJSON(lot_peers.geom)::jsonb
                ) ORDER BY lot_peers.volume DESC NULLS LAST)
                FROM lot_peers) AS "lotSupplies",
               (SELECT jsonb_agg(jsonb_build_object(
                   'supplyCode', bsg.supply_code,
                   'volume', bsg.volume,
                   'isCurrent', bsg.supply_code = target.supply_code,
                   'isLotSupply', EXISTS (
                     SELECT 1 FROM lot_peers lp WHERE lp.supply_code = bsg.supply_code
                   ),
                   'point', ST_AsGeoJSON(bsg.geom)::jsonb
                 ) ORDER BY bsg.volume DESC NULLS LAST)
                 FROM block_supplies_geo bsg) AS "blockSupplies",
               (SELECT sum(volume)::float8 FROM block_peers) AS "blockConsumptionM3",
               (SELECT sum(billed_amount)::float8 FROM block_peers) AS "blockBillingSoles",
               (SELECT count(*)::int FROM block_peers) AS "blockSupplyCount",
               CASE WHEN target.block_id IS NULL OR current.volume IS NULL THEN NULL ELSE
                 (SELECT count(*)::int + 1 FROM block_peers WHERE volume > current.volume)
               END AS "blockRank",
               (SELECT avg(volume)::float8 FROM neighbor_peers) AS "neighborAverageM3",
               (SELECT count(*)::int FROM neighbor_peers) AS "neighborCount",
               CASE WHEN target.lot_area_m2 IS NULL OR target.lot_area_m2 <= 0 OR current.volume IS NULL THEN NULL ELSE
                 (SELECT count(*)::int + 1 FROM district_lot_peers
                    WHERE volume / area_m2 > current.volume / target.lot_area_m2)
               END AS "districtPerAreaRank",
               (SELECT count(*)::int FROM district_lot_peers) AS "districtPerAreaSupplyCount",
               (SELECT avg(volume)::float8 FROM similar_lot_peers) AS "similarLotsAverageM3",
               (SELECT count(*)::int FROM similar_lot_peers) AS "similarLotsCount"
        FROM target
        LEFT JOIN target_period period ON true
        LEFT JOIN current_values current ON current.supply_code = target.supply_code
        """,
        [supply_code, supply_code, supply_code],
    )
    economic = await fetch_one(
        pool,
        """
        WITH debt_ranked AS (
          SELECT cd.period_year::int AS year, cd.period_month::int AS month,
                 lower(cd.concept) AS concept, cd.amount_soles::float8 AS amount,
                 row_number() OVER (
                   PARTITION BY cd.period_year, cd.period_month, lower(cd.concept)
                   ORDER BY cd.updated_at DESC NULLS LAST, cd.created_at DESC NULLS LAST, cd.id DESC
                 ) AS source_rank
          FROM public.customer_debts cd WHERE cd.supply_code = %s
        ), daily_ranked AS (
          SELECT extract(year FROM b.issue_date)::int AS year,
                 extract(month FROM b.issue_date)::int AS month, lower(b.concept) AS concept,
                 b.amount_soles::float8 AS amount,
                 row_number() OVER (
                   PARTITION BY extract(year FROM b.issue_date), extract(month FROM b.issue_date), lower(b.concept)
                   ORDER BY b.source_batch_date DESC NULLS LAST, b.imported_at DESC NULLS LAST,
                            b.source_file DESC NULLS LAST, b.source_line_number DESC NULLS LAST, b.id DESC
                 ) AS source_rank
          FROM public.customer_supply_billing_daily b
          WHERE b.supply_code = %s AND b.issue_date IS NOT NULL
        ), canonical AS (
          SELECT year, month, concept, amount FROM debt_ranked WHERE source_rank = 1
          UNION ALL
          SELECT daily.year, daily.month, daily.concept, daily.amount FROM daily_ranked daily
          WHERE daily.source_rank = 1 AND NOT EXISTS (
            SELECT 1 FROM debt_ranked debt WHERE debt.source_rank = 1
              AND debt.year = daily.year AND debt.month = daily.month AND debt.concept = daily.concept
          )
        ), monthly AS (
          SELECT year, month, sum(coalesce(amount, 0))::float8 AS amount
          FROM canonical GROUP BY year, month
        ), latest AS (
          SELECT * FROM monthly ORDER BY year DESC, month DESC LIMIT 1
        )
        SELECT latest.year AS "latestYear", latest.month AS "latestMonth",
               latest.amount AS "monthlyBillingSoles",
               (SELECT sum(amount)::float8 FROM monthly WHERE year = latest.year) AS "annualBillingSoles",
               (SELECT avg(amount)::float8 FROM (SELECT amount FROM monthly ORDER BY year DESC, month DESC LIMIT 12) recent) AS "averageTicketSoles",
               (SELECT count(*)::int FROM monthly) AS "billedPeriodCount"
        FROM latest
        """,
        [supply_code, supply_code],
    )
    operations = await fetch_one(
        pool,
        """
        SELECT
          (SELECT count(*)::int FROM public.commercial_inspections i WHERE i.supply_code = %s) AS "inspectionCount",
          (SELECT max(i.inspection_date) FROM public.commercial_inspections i WHERE i.supply_code = %s) AS "lastInspectionAt",
          (SELECT count(*)::int FROM public.anomalies a WHERE a.supply_code = %s AND NOT coalesce(a.resolved, false)) AS "openAnomalyCount",
          (SELECT count(*)::int FROM public.meter_contrastations m WHERE m.supply_code = %s) AS "contrastationCount",
          (SELECT m.result FROM public.meter_contrastations m WHERE m.supply_code = %s ORDER BY m.test_date DESC NULLS LAST LIMIT 1) AS "lastContrastationResult"
        """,
        [supply_code, supply_code, supply_code, supply_code, supply_code],
    )
    spatial = territorial or {}
    current = spatial.get("currentConsumptionM3")
    lot_consumption = spatial.get("lotConsumptionM3")
    block_consumption = spatial.get("blockConsumptionM3")
    area = spatial.get("lotAreaM2")
    perimeter = spatial.get("lotPerimeterM")
    block_area = spatial.get("blockLotAreaM2")
    block_perimeter = spatial.get("blockPerimeterM")
    neighbor_average = spatial.get("neighborAverageM3")
    per_area = lot_consumption / area if lot_consumption is not None and area and area > 0 else None
    per_perimeter = lot_consumption / perimeter if lot_consumption is not None and perimeter and perimeter > 0 else None
    current_per_area = current / area if current is not None and area and area > 0 else None
    current_per_perimeter = current / perimeter if current is not None and perimeter and perimeter > 0 else None
    block_density = block_consumption / block_area if block_consumption is not None and block_area and block_area > 0 else None
    block_per_linear_meter = block_consumption / block_perimeter if block_consumption is not None and block_perimeter and block_perimeter > 0 else None
    neighbor_deviation = (
        (current - neighbor_average) / neighbor_average * 100
        if current is not None and neighbor_average and neighbor_average > 0 else None
    )
    return {
        "coverage": {
            "billing": bool(economic),
            "district": bool(spatial.get("districtCode")),
            "geolocation": bool(spatial.get("hasGeolocation")),
            "block": bool(spatial.get("hasBlock")),
            "lot": bool(spatial.get("hasLot")),
            "operations": bool((operations or {}).get("inspectionCount") or (operations or {}).get("openAnomalyCount")),
        },
        "spatial": {
            **spatial,
            "consumptionPerM2": per_area,
            "consumptionPerLinearMeter": per_perimeter,
            "currentSupplyConsumptionPerM2": current_per_area,
            "currentSupplyConsumptionPerLinearMeter": current_per_perimeter,
            "blockConsumptionDensityM3PerM2": block_density,
            "blockConsumptionPerLinearMeter": block_per_linear_meter,
            "neighborDeviationPercent": neighbor_deviation,
        },
        "economic": economic or {},
        "operations": operations or {},
    }


async def fetch_abrupt_consumption_drops(pool: AsyncConnectionPool) -> dict:
    """Devuelve suministros cuyo consumo mensual cae a cero o a <=15% de su
    referencia inmediata. El cálculo se hace en PostgreSQL para no transferir
    toda la facturación al visor."""
    rows = await fetch_all(
        pool,
        """
        WITH debt_ranked AS (
          SELECT cd.supply_code, cd.period_year::int AS year, cd.period_month::int AS month,
                 cd.billed_volume_m3::float8 AS volume,
                 row_number() OVER (
                   PARTITION BY cd.supply_code, cd.period_year::int, cd.period_month::int, lower(cd.concept)
                   ORDER BY cd.updated_at DESC NULLS LAST, cd.created_at DESC NULLS LAST, cd.id DESC
                 ) AS source_rank
          FROM public.customer_debts cd
          WHERE lower(cd.concept) = 'consumo_agua'
        ), daily_ranked AS (
          SELECT b.supply_code, extract(year FROM b.issue_date)::int AS year,
                 extract(month FROM b.issue_date)::int AS month, b.billed_volume_m3::float8 AS volume,
                 row_number() OVER (
                   PARTITION BY b.supply_code, extract(year FROM b.issue_date)::int, extract(month FROM b.issue_date)::int, lower(b.concept)
                   ORDER BY b.source_batch_date DESC NULLS LAST, b.imported_at DESC NULLS LAST,
                            b.source_file DESC NULLS LAST, b.source_line_number DESC NULLS LAST, b.id DESC
                 ) AS source_rank
          FROM public.customer_supply_billing_daily b
          WHERE b.issue_date IS NOT NULL AND lower(b.concept) = 'consumo_agua'
        ), monthly AS (
          SELECT supply_code, make_date(year, month, 1) AS period, coalesce(volume, 0) AS volume
          FROM debt_ranked WHERE source_rank = 1
          UNION ALL
          SELECT daily.supply_code, make_date(daily.year, daily.month, 1), coalesce(daily.volume, 0)
          FROM daily_ranked daily
          WHERE daily.source_rank = 1
            AND NOT EXISTS (
              SELECT 1 FROM debt_ranked debt
              WHERE debt.source_rank = 1 AND debt.supply_code = daily.supply_code
                AND debt.year = daily.year AND debt.month = daily.month
            )
        ), compared AS (
          SELECT supply_code, period, volume,
                 lag(period) OVER timeline AS previous_period,
                 lag(volume) OVER timeline AS previous_volume,
                 avg(nullif(volume, 0)) OVER (
                   PARTITION BY supply_code ORDER BY period ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING
                 ) AS prior_average
          FROM monthly
          WINDOW timeline AS (PARTITION BY supply_code ORDER BY period)
        ), matches AS (
          SELECT compared.*, count(*) OVER()::int AS total
          FROM compared
          WHERE previous_period = period - interval '1 month'
            AND previous_volume >= 5
            AND prior_average >= 5
            AND volume <= greatest(2, prior_average * 0.15)
        )
        SELECT matches.supply_code AS "supplyCode", coalesce(cs.customer_name, c.business_name, c.full_name) AS "customerName",
               coalesce(cs.district, c.district) AS district, matches.period::text AS period,
               matches.volume AS "currentVolume", matches.prior_average AS "referenceVolume",
               round((1 - matches.volume / nullif(matches.prior_average, 0)) * 100)::int AS "dropPercent",
               CASE WHEN matches.volume = 0 THEN 'zero' ELSE 'extremely_low' END AS kind,
               matches.total AS total
        FROM matches
        LEFT JOIN public.customer_supplies cs ON cs.supply_code = matches.supply_code
        LEFT JOIN public.customers c ON c.id = cs.customer_id
        ORDER BY matches.period DESC, "dropPercent" DESC, matches.supply_code
        LIMIT 500
        """,
    )
    total = int(rows[0]["total"]) if rows else 0
    return {"total": total, "items": [{key: value for key, value in row.items() if key != "total"} for row in rows]}
