BEGIN;

CREATE TABLE IF NOT EXISTS public.gis_geometry_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind text NOT NULL CHECK (target_kind IN ('block', 'lot')),
  block_id uuid REFERENCES public.gis_blocks(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES public.gis_lots(id) ON DELETE CASCADE,
  delta_lng double precision NOT NULL DEFAULT 0,
  delta_lat double precision NOT NULL DEFAULT 0,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (target_kind = 'block' AND block_id IS NOT NULL AND lot_id IS NULL)
    OR (target_kind = 'lot' AND lot_id IS NOT NULL AND block_id IS NULL)
  ),
  CHECK (abs(delta_lng) <= 0.05 AND abs(delta_lat) <= 0.05)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gis_geometry_corrections_block
  ON public.gis_geometry_corrections (block_id)
  WHERE target_kind = 'block';
CREATE UNIQUE INDEX IF NOT EXISTS idx_gis_geometry_corrections_lot
  ON public.gis_geometry_corrections (lot_id)
  WHERE target_kind = 'lot';

COMMIT;
