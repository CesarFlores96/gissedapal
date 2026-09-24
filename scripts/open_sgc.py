"""Consulta de un suministro en Open SGC (Oracle DBPROD) para el emisor ITC.

Adaptado de `D:\\WEB SCRAPPING OPEN\\consultar_nis.py`: mismas tablas y mismos
cruces, pero solo lo que usa el informe ITC (predio, medidor activo, medidores
anteriores y lecturas) y con dos cambios de seguridad:

- Las credenciales salen de variables de entorno de esta PC
  (`OPEN_SGC_USER`, `OPEN_SGC_PASSWORD`, opcionales `OPEN_SGC_TNS` y
  `OPEN_SGC_SQLPLUS`). Nunca se suben a AWS ni se escriben en el codigo.
- La conexion se hace con `CONNECT` por stdin, no en la linea de comandos,
  para que la clave no quede visible en la lista de procesos.

Solo ejecuta SELECT. DBPROD solo es alcanzable desde la red corporativa, por
eso vive en el emisor y no en AWS.
"""
from __future__ import annotations

import os
import re
import subprocess
from typing import Any

DEFAULT_SQLPLUS = r"C:\Oracle11g\product\11.2.0\client_1\bin\sqlplus.exe"
READINGS_LIMIT = 60  # cinco años de lecturas mensuales


def is_configured() -> bool:
    return bool(os.environ.get("OPEN_SGC_USER", "").strip() and os.environ.get("OPEN_SGC_PASSWORD", "").strip())


def _run_sqlplus(sql_text: str) -> str:
    user = os.environ["OPEN_SGC_USER"].strip()
    password = os.environ["OPEN_SGC_PASSWORD"].strip()
    tns = os.environ.get("OPEN_SGC_TNS", "DBPROD").strip()
    sqlplus = os.environ.get("OPEN_SGC_SQLPLUS", DEFAULT_SQLPLUS).strip()
    script = (
        "WHENEVER SQLERROR EXIT FAILURE\n"
        f'CONNECT {user}/"{password}"@{tns}\n'
        "SET LINESIZE 32767 TRIMSPOOL ON WRAP OFF PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF ECHO OFF\n"
        f"{sql_text}\nexit;\n"
    )
    proc = subprocess.run(
        [sqlplus, "-s", "-L", "/nolog"], input=script, capture_output=True,
        text=True, encoding="latin-1", errors="replace", timeout=120,
    )
    if proc.returncode != 0 or "ORA-" in proc.stdout or "SP2-" in proc.stdout:
        # Solo la primera linea de error: el resto puede traer el script.
        detail = next((line for line in proc.stdout.splitlines() if "ORA-" in line or "SP2-" in line), "")
        raise RuntimeError(f"Open SGC no respondio la consulta. {detail}".strip())
    return proc.stdout


def _sections(stdout: str) -> dict[str, list[list[str]]]:
    sections: dict[str, list[list[str]]] = {}
    current = None
    for raw in stdout.splitlines():
        line = raw.strip()
        if line.startswith("===") and line.endswith("==="):
            current = line.strip("=").strip()
            sections[current] = []
        elif current and ";;" in line:
            sections[current].append([part.strip() for part in line.split(";;")])
    return sections


def _iso(value: str) -> str:
    """YYYYMMDD / YYYY-MM-DD -> YYYY-MM-DD; lo demas (29991231, vacio) -> ""."""

    clean = re.sub(r"[^0-9]", "", value or "")
    if len(clean) != 8 or clean.startswith("2999"):
        return ""
    return f"{clean[0:4]}-{clean[4:6]}-{clean[6:8]}"


def fetch_supply(nis: str) -> dict[str, Any] | None:
    """Ficha del NIS con las claves de `consultar_nis.py`, o None si no existe."""

    if not nis.isdigit():
        raise ValueError("El NIS debe ser numerico.")
    sql = f"""
PROMPT ===MAIN===
SELECT NVL(TRIM(C.NOM_CLI || ' ' || C.APE1_CLI || ' ' || C.APE2_CLI), '') || ';;' ||
       NVL(TRIM(CJ.NOM_CALLE || ' ' || F.NUM_PUERTA || ' ' || F.DUPLICADOR || ' ' || F.REF_DIR), '') || ';;' ||
       NVL(TRIM(L.NOM_LOCAL), '') || ';;' ||
       NVL(TRIM(M.NOM_MUNIC), '')
FROM SUMCON S, CLIENTES C, FINCAS F, CALLEJERO CJ, LOCALIDADES L, MUNICIPIOS M
WHERE S.NIS_RAD = {nis}
  AND S.COD_CLI = C.COD_CLI (+)
  AND S.NIF = F.NIF (+)
  AND F.COD_CALLE = CJ.COD_CALLE (+)
  AND CJ.COD_MUNIC = M.COD_MUNIC (+)
  AND CJ.COD_LOCAL = L.COD_LOCAL (+)
  AND ROWNUM = 1;

PROMPT ===MEDIDOR===
SELECT NVL(A.NUM_APA, '') || ';;' || NVL(A.F_INST, '')
FROM APMEDIDA_AP A
WHERE A.NIS_RAD = {nis} AND ROWNUM = 1;

PROMPT ===LECTURAS===
SELECT NUM_APA || ';;' || LECT || ';;' || CSMO || ';;' || F_LECT || ';;' || TIPO || ';;' || INCIDENCIA
FROM (
  SELECT C.NUM_APA, C.LECT, TO_CHAR(C.CSMO, 'FM999990.00') CSMO, C.F_LECT,
         NVL(T_LECT.DESC_TIPO, C.TIP_LECT) TIPO, NVL(CD.DESC_COD, '') INCIDENCIA
  FROM APMEDIDA_CO C, TIPOS T_LECT, CODIGOS CD
  WHERE C.NIS_RAD = {nis}
    AND T_LECT.TIPO (+) = C.TIP_LECT
    AND CD.COD (+) = C.CO_AL
  ORDER BY C.F_LECT DESC
)
WHERE ROWNUM <= {READINGS_LIMIT};

PROMPT ===HMED===
SELECT H.NUM_APA || ';;' || TO_CHAR(H.F_INST, 'YYYYMMDD') || ';;' ||
       TO_CHAR(H.F_LVTO, 'YYYYMMDD') || ';;' || NVL(C.DESC_COD, H.CO_MOT_LEVAN)
FROM HAPMEDIDA_AP H, CODIGOS C
WHERE H.NIS_RAD = {nis}
  AND C.COD (+) = H.CO_MOT_LEVAN
ORDER BY H.F_LVTO DESC;
"""
    sections = _sections(_run_sqlplus(sql))
    main = (sections.get("MAIN") or [[]])[0]
    if len(main) < 4:
        return None

    meter = (sections.get("MEDIDOR") or [[]])[0]
    return {
        "nis": nis,
        "cliente": {"titular": main[0]},
        "predio": {"direccion": main[1], "localidad_urb": main[2], "distrito": main[3]},
        "medidor": {
            "numero": meter[0] if len(meter) >= 2 else "",
            "fecha_instalacion": _iso(meter[1]) if len(meter) >= 2 else "",
        },
        "medidores_anteriores": [
            {"numero": row[0], "fecha_instalacion": _iso(row[1]), "fecha_retiro": _iso(row[2]), "motivo_retiro": row[3]}
            for row in sections.get("HMED", []) if len(row) >= 4 and row[0]
        ],
        "historial_lecturas": [
            {
                "numero_medidor": row[0], "lectura": row[1], "consumo_m3": row[2],
                "fecha_lectura": _iso(row[3]), "tipo_lectura": row[4], "incidencia": row[5],
            }
            for row in sections.get("LECTURAS", []) if len(row) >= 6
        ],
    }


if __name__ == "__main__":
    # Prueba manual, sin tocar AWS:  python open_sgc.py 5302831
    import json
    import sys

    print(json.dumps(fetch_supply(sys.argv[1].strip()), indent=2, ensure_ascii=False))
