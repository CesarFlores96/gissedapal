-- Asigna el codigo oficial SEDAPAL a los 50 distritos de Lima y Callao.
--
-- Fuente: exportacion "distritos_codigos" del ArcGIS de Catastro Comercial
-- (campos "Codigo del distrito" / "Nombre del distrito"). Los codigos van de
-- 001 a 044 en Lima (043 no existe) y de 101 a 107 en Callao.
--
-- Antes de esta migracion solo EL AGUSTINO tenia district_code (ver 002), por lo
-- que el ORDER BY del catalogo de distritos era arbitrario.

BEGIN;

-- El GeoJSON del IGN traia el nombre con mojibake: los bytes almacenados son
-- 'MI PER' + chr(195) + chr(122) en vez de 'MI PERU' con U acentuada. Se corrige
-- aqui porque el backend filtra los suministros por nombre de distrito, de modo
-- que hoy ese distrito no es filtrable.
UPDATE public.gis_districts
SET name = 'MI PER' || chr(218), updated_at = now()
WHERE name LIKE 'MI PER%'
  AND name <> 'MI PER' || chr(218);

-- El emparejamiento normaliza a mayusculas sin acentos y colapsa la puntuacion a
-- espacios, porque el IGN y el catalogo SEDAPAL difieren en dos casos:
--   IGN "CARMEN DE LA LEGUA REYNOSO" vs SEDAPAL "CARMEN DE LA LEGUA-REYNOSO"
--   IGN "BRENA" con enye vs catalogo con enye
UPDATE public.gis_districts d
SET district_code = c.code,
    updated_at = now()
FROM (VALUES
    ('001', 'LIMA'),
    ('002', 'ANCON'),
    ('003', 'ATE'),
    ('004', 'BARRANCO'),
    ('005', 'BRENA'),
    ('006', 'CARABAYLLO'),
    ('007', 'COMAS'),
    ('008', 'CHACLACAYO'),
    ('009', 'CHORRILLOS'),
    ('010', 'EL AGUSTINO'),
    ('011', 'JESUS MARIA'),
    ('012', 'LA MOLINA'),
    ('013', 'LA VICTORIA'),
    ('014', 'LINCE'),
    ('015', 'LURIGANCHO'),
    ('016', 'LURIN'),
    ('017', 'MAGDALENA DEL MAR'),
    ('018', 'MIRAFLORES'),
    ('019', 'PACHACAMAC'),
    ('020', 'PUCUSANA'),
    ('021', 'PUEBLO LIBRE'),
    ('022', 'PUENTE PIEDRA'),
    ('023', 'PUNTA NEGRA'),
    ('024', 'PUNTA HERMOSA'),
    ('025', 'RIMAC'),
    ('026', 'SAN BARTOLO'),
    ('027', 'SAN ISIDRO'),
    ('028', 'INDEPENDENCIA'),
    ('029', 'SAN JUAN DE MIRAFLORES'),
    ('030', 'SAN LUIS'),
    ('031', 'SAN MARTIN DE PORRES'),
    ('032', 'SAN MIGUEL'),
    ('033', 'SANTIAGO DE SURCO'),
    ('034', 'SURQUILLO'),
    ('035', 'VILLA MARIA DEL TRIUNFO'),
    ('036', 'SAN JUAN DE LURIGANCHO'),
    ('037', 'SANTA MARIA DEL MAR'),
    ('038', 'SANTA ROSA'),
    ('039', 'LOS OLIVOS'),
    ('040', 'CIENEGUILLA'),
    ('041', 'SAN BORJA'),
    ('042', 'VILLA EL SALVADOR'),
    ('044', 'SANTA ANITA'),
    ('101', 'CALLAO'),
    ('102', 'BELLAVISTA'),
    ('103', 'CARMEN DE LA LEGUA REYNOSO'),
    ('104', 'LA PERLA'),
    ('105', 'LA PUNTA'),
    ('106', 'VENTANILLA'),
    ('107', 'MI PERU')
) AS c(code, name)
WHERE btrim(regexp_replace(
        translate(upper(d.name), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ', 'AAAAEEEEIIIIOOOOUUUUNC'),
        '[^A-Z0-9]+', ' ', 'g')) = c.name
  AND d.district_code IS DISTINCT FROM c.code;

-- La migracion se aborta si algun distrito quedo sin codigo: eso significaria que
-- el nombre en gis_districts no coincide con el catalogo y que el combo volveria
-- a ordenarse de forma arbitraria.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name)
  INTO missing
  FROM public.gis_districts
  WHERE district_code IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Distritos sin district_code tras la migracion: %', missing;
  END IF;
END;
$$;

COMMIT;
