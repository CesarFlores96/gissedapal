-- Revierte la asignacion masiva de codigos SEDAPAL, dejando unicamente el de
-- EL AGUSTINO que introdujo la migracion 002.
--
-- No se revierte la correccion del nombre de MI PERU: restaurar el mojibake
-- volveria a romper el filtro de suministros por distrito.

BEGIN;

UPDATE public.gis_districts
SET district_code = NULL, updated_at = now()
WHERE district_code IS NOT NULL
  AND upper(name) <> 'EL AGUSTINO';

COMMIT;
