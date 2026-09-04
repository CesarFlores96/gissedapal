BEGIN;

DROP MATERIALIZED VIEW IF EXISTS public.reporting_monthly_facts;
DROP FUNCTION IF EXISTS public.enqueue_cache_invalidation();
DROP TABLE IF EXISTS public.cache_outbox;
DROP TABLE IF EXISTS public.cache_revisions;

COMMIT;
