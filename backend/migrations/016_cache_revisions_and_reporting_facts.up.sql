BEGIN;

CREATE TABLE IF NOT EXISTS public.cache_revisions (
  domain text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cache_outbox (
  id bigserial PRIMARY KEY,
  domain text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processing_at timestamptz,
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cache_outbox_pending_idx
  ON public.cache_outbox (id) WHERE processed_at IS NULL;

INSERT INTO public.cache_revisions (domain)
VALUES ('reports'), ('spatial:lots'), ('spatial:water_pipes'), ('spatial:water_connections')
ON CONFLICT (domain) DO NOTHING;

-- Una fila por suministro/concepto/mes. La precedencia de deuda sobre el
-- archivo diario se calcula una vez por refresh, no en cada reporte.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.reporting_monthly_facts AS
WITH debt_ranked AS (
  SELECT cd.supply_code, lower(cd.concept) AS concept,
         make_date(cd.period_year::int, cd.period_month::int, 1) AS period,
         cd.billed_volume_m3::float8 AS volume, cd.total_soles::float8 AS amount,
         row_number() OVER (
           PARTITION BY cd.supply_code, cd.period_year::int, cd.period_month::int, lower(cd.concept)
           ORDER BY cd.updated_at DESC NULLS LAST, cd.created_at DESC NULLS LAST, cd.id DESC
         ) AS source_rank
  FROM public.customer_debts cd
), daily_ranked AS (
  SELECT b.supply_code, lower(b.concept) AS concept,
         date_trunc('month', b.issue_date)::date AS period,
         b.billed_volume_m3::float8 AS volume, b.total_soles::float8 AS amount,
         row_number() OVER (
           PARTITION BY b.supply_code, date_trunc('month', b.issue_date)::date, lower(b.concept)
           ORDER BY b.source_batch_date DESC NULLS LAST, b.imported_at DESC NULLS LAST,
                    b.source_file DESC NULLS LAST, b.source_line_number DESC NULLS LAST, b.id DESC
         ) AS source_rank
  FROM public.customer_supply_billing_daily b
)
SELECT supply_code, concept, period, coalesce(volume, 0)::float8 AS volume, amount, 'debt'::text AS source
FROM debt_ranked
WHERE source_rank = 1
UNION ALL
SELECT daily.supply_code, daily.concept, daily.period, coalesce(daily.volume, 0)::float8, daily.amount, 'daily'::text
FROM daily_ranked daily
WHERE daily.source_rank = 1
  AND NOT EXISTS (
    SELECT 1 FROM debt_ranked debt
    WHERE debt.source_rank = 1 AND debt.supply_code = daily.supply_code
      AND debt.concept = daily.concept AND debt.period = daily.period
  );

CREATE UNIQUE INDEX IF NOT EXISTS reporting_monthly_facts_unique_idx
  ON public.reporting_monthly_facts (supply_code, concept, period);
CREATE INDEX IF NOT EXISTS reporting_monthly_facts_period_idx
  ON public.reporting_monthly_facts (concept, period, supply_code);

CREATE INDEX IF NOT EXISTS customer_debts_report_monthly_idx
  ON public.customer_debts (supply_code, concept, period_year, period_month, updated_at DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_supply_billing_daily_report_monthly_idx
  ON public.customer_supply_billing_daily
  (supply_code, concept, issue_date, source_batch_date DESC, imported_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_debts_open_supply_idx
  ON public.customer_debts (customer_supply_id)
  WHERE status NOT IN ('pagada', 'condonada');

CREATE OR REPLACE FUNCTION public.enqueue_cache_invalidation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.cache_outbox (domain, payload)
  VALUES (TG_ARGV[0], jsonb_build_object('table', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME));
  RETURN NULL;
END;
$$;

DO $$
DECLARE relation_name text;
DECLARE domain_name text;
BEGIN
  FOR relation_name, domain_name IN
    SELECT * FROM (VALUES
      ('public.customer_debts', 'reports'),
      ('public.customer_supply_billing_daily', 'reports'),
      ('public.customer_supplies', 'reports'),
      ('utility.pipes', 'spatial:water_pipes'),
      ('utility.service_connections', 'spatial:water_connections')
    ) AS sources(relation_name, domain_name)
  LOOP
    IF to_regclass(relation_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS cache_invalidation_%s ON %s', replace(relation_name, '.', '_'), relation_name);
      EXECUTE format(
        'CREATE TRIGGER cache_invalidation_%s AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_cache_invalidation(%L)',
        replace(relation_name, '.', '_'), relation_name, domain_name
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
