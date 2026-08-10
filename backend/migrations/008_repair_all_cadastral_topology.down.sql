DO $$
BEGIN
  RAISE EXCEPTION
    'La reparacion topologica no se revierte automaticamente; las geometrias originales permanecen en gis.geometry_repair_audit';
END;
$$;
