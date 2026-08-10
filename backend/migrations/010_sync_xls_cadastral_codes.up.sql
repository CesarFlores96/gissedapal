BEGIN;

UPDATE gis.lots target
SET cadastral_code = COALESCE(
      NULLIF(btrim(legacy.cup_code), ''),
      NULLIF(btrim(legacy.property_code), ''),
      target.cadastral_code
    ),
    updated_at = now()
FROM public.gis_lots legacy
WHERE legacy.id = target.id
  AND target.cadastral_code IS DISTINCT FROM COALESCE(
    NULLIF(btrim(legacy.cup_code), ''),
    NULLIF(btrim(legacy.property_code), ''),
    target.cadastral_code
  );

COMMIT;
