BEGIN;

-- Soporta el agrupamiento por cup_code que usan los indicadores comparativos
-- (ranking por m2 y lotes similares en fetch_supply_indicators): sin este
-- indice, esa consulta hace un full scan de gis_lots en cada apertura del tab.
CREATE INDEX IF NOT EXISTS idx_gis_lots_cup_code
  ON public.gis_lots (cup_code)
  WHERE cup_code IS NOT NULL;

COMMIT;
