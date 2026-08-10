BEGIN;

-- El archivo comercial identifica la manzana por los primeros ocho digitos del
-- CUPCODE y el lote logico por los doce. Un CUPCODE puede representar varios
-- poligonos de gis_lots, por lo que no se fuerza una eleccion arbitraria de
-- geometria: se conserva el conteo y solo se asigna gis_block_id cuando es unico.
CREATE TABLE IF NOT EXISTS public.gis_cadastral_blocks (
  cod_mza text PRIMARY KEY,
  district_code text NOT NULL
    REFERENCES public.territory_districts (district_code) ON DELETE RESTRICT,
  gis_block_id uuid REFERENCES public.gis_blocks (id) ON DELETE SET NULL,
  gis_block_match_count integer NOT NULL DEFAULT 0 CHECK (gis_block_match_count >= 0),
  source_file text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gis_cadastral_blocks_code_format CHECK (cod_mza ~ '^[0-9]{8}$'),
  CONSTRAINT gis_cadastral_blocks_district_consistency
    CHECK (substr(cod_mza, 1, 3) = district_code)
);

CREATE INDEX IF NOT EXISTS idx_gis_cadastral_blocks_district
  ON public.gis_cadastral_blocks (district_code);
CREATE INDEX IF NOT EXISTS idx_gis_cadastral_blocks_gis_block
  ON public.gis_cadastral_blocks (gis_block_id)
  WHERE gis_block_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.gis_cadastral_lot_units (
  cup_code text PRIMARY KEY,
  cod_mza text NOT NULL
    REFERENCES public.gis_cadastral_blocks (cod_mza) ON DELETE RESTRICT,
  district_code text NOT NULL
    REFERENCES public.territory_districts (district_code) ON DELETE RESTRICT,
  gis_lot_match_count integer NOT NULL DEFAULT 0 CHECK (gis_lot_match_count >= 0),
  geometry_match_status text NOT NULL DEFAULT 'NO_GEOMETRY'
    CHECK (geometry_match_status IN (
      'NO_GEOMETRY', 'UNIQUE_GEOMETRY', 'MULTIPARCEL_SAME_BLOCK', 'MULTIBLOCK'
    )),
  source_file text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gis_cadastral_lot_units_code_format CHECK (cup_code ~ '^[0-9]{12}$'),
  CONSTRAINT gis_cadastral_lot_units_block_consistency
    CHECK (substr(cup_code, 1, 8) = cod_mza),
  CONSTRAINT gis_cadastral_lot_units_district_consistency
    CHECK (substr(cup_code, 1, 3) = district_code)
);

CREATE INDEX IF NOT EXISTS idx_gis_cadastral_lot_units_block
  ON public.gis_cadastral_lot_units (cod_mza);
CREATE INDEX IF NOT EXISTS idx_gis_cadastral_lot_units_district
  ON public.gis_cadastral_lot_units (district_code);

CREATE TABLE IF NOT EXISTS public.gis_cadastral_lot_geometries (
  cup_code text NOT NULL
    REFERENCES public.gis_cadastral_lot_units (cup_code) ON DELETE CASCADE,
  gis_lot_id uuid NOT NULL REFERENCES public.gis_lots (id) ON DELETE CASCADE,
  PRIMARY KEY (cup_code, gis_lot_id)
);

CREATE INDEX IF NOT EXISTS idx_gis_cadastral_lot_geometries_gis_lot
  ON public.gis_cadastral_lot_geometries (gis_lot_id);

CREATE TABLE IF NOT EXISTS public.gis_supply_lot_links (
  supply_id uuid PRIMARY KEY
    REFERENCES public.customer_supplies (id) ON DELETE CASCADE,
  supply_code text NOT NULL UNIQUE,
  cup_code text
    REFERENCES public.gis_cadastral_lot_units (cup_code) ON DELETE RESTRICT,
  district_code text
    REFERENCES public.territory_districts (district_code) ON DELETE RESTRICT,
  source_lot_code text,
  source_district_code text,
  source_district_name text,
  district_match_status text NOT NULL
    CHECK (district_match_status IN (
      'MATCHED', 'SOURCE_MISMATCH', 'UNKNOWN_DISTRICT', 'INVALID_LOT_CODE'
    )),
  cua_catalog_id bigint
    REFERENCES public.supervision_code_catalog (id) ON DELETE SET NULL,
  cua_label text,
  cua_match_method text NOT NULL
    CHECK (cua_match_method IN ('EXACT', 'PREFIX', 'UNRESOLVED', 'EMPTY')),
  source_file text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gis_supply_lot_links_cup
  ON public.gis_supply_lot_links (cup_code);
CREATE INDEX IF NOT EXISTS idx_gis_supply_lot_links_district
  ON public.gis_supply_lot_links (district_code);
CREATE INDEX IF NOT EXISTS idx_gis_supply_lot_links_cua
  ON public.gis_supply_lot_links (cua_catalog_id)
  WHERE cua_catalog_id IS NOT NULL;

-- Diez campos del libro no tenian columna propia en el snapshot historico.
-- Se mantienen separados para no requerir ALTER sobre tablas cuyo propietario
-- local es postgres, pero siguen teniendo una fila unica por suministro.
CREATE TABLE IF NOT EXISTS public.customer_supply_catastro_extensions (
  supply_id uuid PRIMARY KEY
    REFERENCES public.customer_supplies (id) ON DELETE CASCADE,
  supply_code text NOT NULL UNIQUE,
  sec_cta text,
  scheme_code text,
  shipping_street text,
  shipping_municipal_number text,
  shipping_duplicator text,
  shipping_locality text,
  shipping_reference text,
  shipping_district_code text,
  shipping_district_name text,
  shipping_zone_name text,
  source_file text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW public.gis_supply_cadastral_hierarchy AS
SELECT
  district.district_code,
  district.name AS district_name,
  block.cod_mza,
  block.gis_block_id,
  lot.cup_code,
  lot.geometry_match_status,
  lot.gis_lot_match_count,
  link.supply_id,
  link.supply_code,
  catalog.code AS cua_code,
  link.cua_label,
  catalog.description AS cua_catalog_description,
  link.cua_match_method,
  link.district_match_status
FROM public.gis_supply_lot_links link
LEFT JOIN public.territory_districts district
  ON district.district_code = link.district_code
LEFT JOIN public.gis_cadastral_lot_units lot
  ON lot.cup_code = link.cup_code
LEFT JOIN public.gis_cadastral_blocks block
  ON block.cod_mza = lot.cod_mza
LEFT JOIN public.supervision_code_catalog catalog
  ON catalog.id = link.cua_catalog_id;

COMMIT;
