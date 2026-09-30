"""Consulta de un suministro en Open SGC (Oracle DBPROD) para el emisor ITC.

Adaptado de `D:\\WEB SCRAPPING OPEN\\consultar_nis.py`: mismas tablas y mismos
cruces, pero solo lo que usa el informe ITC (predio, medidor activo, medidores
anteriores y lecturas) y con dos cambios de seguridad:

- Las credenciales salen del mismo `db_config.ini` que usa `consultar_nis.py`
  (seccion `[ORACLE]`: `USER`, `PASS`, `TNS_ALIAS`, `SQLPLUS_PATH`), que vive
  fuera de Git en esta PC. Ruta por defecto `D:\\WEB SCRAPPING OPEN\\db_config.ini`,
  cambiable con `OPEN_SGC_CONFIG`. Las variables `OPEN_SGC_USER`,
  `OPEN_SGC_PASSWORD`, `OPEN_SGC_TNS` y `OPEN_SGC_SQLPLUS`, si existen, mandan
  sobre el archivo. Nada de esto se sube a AWS ni queda en el codigo.
- La conexion se hace con `CONNECT` por stdin, no en la linea de comandos,
  para que la clave no quede visible en la lista de procesos.

Solo ejecuta SELECT. DBPROD solo es alcanzable desde la red corporativa, por
eso vive en el emisor y no en AWS.
"""
from __future__ import annotations

import configparser
import os
import re
import subprocess
import sys
from typing import Any

DEFAULT_SQLPLUS = r"C:\Oracle11g\product\11.2.0\client_1\bin\sqlplus.exe"
DEFAULT_CONFIG = r"D:\WEB SCRAPPING OPEN\db_config.ini"
READINGS_LIMIT = 60  # cinco años de lecturas mensuales
ORDERS_LIMIT = 50  # mismo tope que consultar_nis.py
BILLS_LIMIT = 24  # dos años de recibos para el portal de reclamos


def _settings() -> dict[str, str]:
    """Conexion a Oracle: `db_config.ini` y, encima, las variables de entorno."""

    config = configparser.ConfigParser()
    config.read(os.environ.get("OPEN_SGC_CONFIG", DEFAULT_CONFIG), encoding="utf-8")
    ini = config["ORACLE"] if config.has_section("ORACLE") else {}

    def pick(env: str, key: str, default: str = "") -> str:
        return (os.environ.get(env) or ini.get(key) or default).strip()

    return {
        "user": pick("OPEN_SGC_USER", "USER"),
        "password": pick("OPEN_SGC_PASSWORD", "PASS"),
        "tns": pick("OPEN_SGC_TNS", "TNS_ALIAS", "DBPROD"),
        "sqlplus": pick("OPEN_SGC_SQLPLUS", "SQLPLUS_PATH", DEFAULT_SQLPLUS),
    }


def is_configured() -> bool:
    settings = _settings()
    return bool(settings["user"] and settings["password"])


def _run_sqlplus(sql_text: str) -> str:
    settings = _settings()
    if not (settings["user"] and settings["password"]):
        raise RuntimeError("Falta usuario o clave de Oracle en db_config.ini (seccion [ORACLE]).")
    user, password, tns, sqlplus = settings["user"], settings["password"], settings["tns"], settings["sqlplus"]
    if not os.path.isfile(sqlplus):
        raise RuntimeError(f"No se encontro sqlplus en {sqlplus}.")
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


def analyze_inspection(text: str, order_type: str = "") -> dict[str, Any]:
    """Analisis estructurado del informe de campo de una orden.

    Mismo motor que `analizar_inspeccion_ia` de `D:\\WEB SCRAPPING OPEN\\consultar_nis.py`
    (pestaña "Analisis por Periodo"), recortado a lo que usa el informe ITC:
    lectura constatada, medidor, giro, caja, dispositivos y geofono. NO se
    calculan ni suben quien atendio (nombre, DNI, telefono), el censo sanitario
    ni el dictamen: el texto de las visitas trae telefonos y correos y se queda
    en esta PC.
    """

    t = (text or "").strip()
    result: dict[str, Any] = {
        "tuvo_lectura": False, "lectura": None, "medidor": None, "estado_giro": "No especificado",
        "estado_caja": "No especificado", "tipo_caja": "No especificado", "dispositivo_seguridad": None,
        "fugas_geofono": "No aplica / No evaluado", "motivo_imposibilidad": None,
    }
    if not t:
        return result

    blacklist = {"CON", "SIN", "DEL", "PARA", "ROTO", "PROFUNDO", "DEVUELTO", "RESUELTO", "ESTADO", "BUENO",
                 "PARALIZADO", "IMPOSIBLE", "OTRO", "MAS"}
    found = re.search(r"\b(?:MD|num_med|medidor\s*(?:N[°º]|num)?)\s*[:=]?\s*([A-Z0-9]{4,14})\b", t, re.IGNORECASE)
    if found:
        serial = found.group(1).upper()
        if serial not in blacklist and any(char.isdigit() for char in serial):
            result["medidor"] = serial

    reading = (
        re.search(r"\blec(?:tura)?\s*[:=]?\s*(\d{2,8})\b", t, re.IGNORECASE)
        or re.search(r"\bcon\s+lectura\s*[:=]?\s*(\d{2,8})\b", t, re.IGNORECASE)
        or re.search(r"\blectura\s+(\d{2,8})\s*m3\b", t, re.IGNORECASE)
    )
    impossible = re.search(
        r"(LECTURA\s+IMPOSIBLE|IMPIDE\s+EFECTUAR\s+LECTURA|TAPAD[AO]\s+CON\s+TIERRA[A-Z\s]*IMPOSIBILITA|"
        r"imposibilidad\s+[A-Z0-9]+|serv\s+IMPOSIB|NO\s+SE\s+PUDO\s+TOMAR\s+LECTURA|NO\s+SE\s+UBICA\s+CONEXION|"
        r"CONEXION\s+CUBIERT[AO]|CAJA\s+PROFUNDA)",
        t, re.IGNORECASE,
    )
    if reading:
        result["tuvo_lectura"] = True
        result["lectura"] = int(reading.group(1))
    elif impossible:
        result["motivo_imposibilidad"] = impossible.group(1).strip()
        detail = re.search(
            r"((?:CONEXION|CAJA|MEDIDOR|TAPADA|CNX)[^.,;/]{5,90}(?:IMPOSIBILITA|IMPIDE|IMPOSIBLE)[^.,;/]*)", t, re.IGNORECASE
        )
        if detail:
            result["motivo_imposibilidad"] = detail.group(1).strip()
    else:
        result["motivo_imposibilidad"] = "Sin lectura registrada en la visita técnica"

    if re.search(r"\bNO\s+REGISTRA\b", t, re.IGNORECASE):
        result["estado_giro"] = "NO REGISTRA CONSUMO"
    elif re.search(r"\bREGISTRA\b", t, re.IGNORECASE):
        result["estado_giro"] = "REGISTRA (GIRANDO CORRECTAMENTE)"
    elif re.search(r"\b(TRABADO|PARALIZAD[AO]|AVERIA|ROTO|REGISTRADOR\s+SUELTO)\b", t, re.IGNORECASE):
        result["estado_giro"] = "PARALIZADO / TRABADO"

    # Solo los codigos del formulario (`caja VER|PIST|OTRA`): el motor original aceptaba
    # cualquier palabra y capturaba "DE" de "caja de control".
    box = re.search(r"\bcaja\s+(VER|PIST|OTRA)\b", t, re.IGNORECASE)
    if box:
        kind = box.group(1).upper()
        result["tipo_caja"] = "Vereda" if kind == "VER" else ("Pista" if kind == "PIST" else "Otra")
    box_state = re.search(r"\best_caja\s+(BUENO|ROTO|MALO|[A-Z]+)", t, re.IGNORECASE)
    upper = t.upper()
    if box_state:
        result["estado_caja"] = box_state.group(1).capitalize()
    elif "CAJA DE CONTROL ROTA" in upper or "CAJA ROTA" in upper:
        result["estado_caja"] = "Rota / Deteriorada"
    elif "CAJA Y TAPA OK" in upper:
        result["estado_caja"] = "Bueno (OK)"

    devices = []
    if "PROTECTOR METALICO" in upper or "CAJA CHINA" in upper or "disposit PROTECTOR" in t:
        devices.append("Protector metálico (Caja China)")
    if "CANDADO" in upper:
        devices.append("Candado de seguridad")
    if "PRECINTO" in upper or "precint " in t:
        devices.append("Precinto de calibración")
    if "ANCLAJE" in upper or "disposit ANCLAJE" in t:
        devices.append("Anclaje de medidor")
    if devices:
        result["dispositivo_seguridad"] = " + ".join(devices)

    if "GEOFONO" in upper or "GEOF" in upper or "GEOFONO" in (order_type or "").upper():
        if re.search(r"NO\s+DETECT[A-Z\s]+FUGA", t, re.IGNORECASE) or "SIN FUGA" in upper:
            result["fugas_geofono"] = "CONFORME: Geófono NO detectó fugas internas"
        elif re.search(r"SE\s+DETECT[OÓ]\s+FUGA", t, re.IGNORECASE) or "FUGA DETECTADA" in upper:
            result["fugas_geofono"] = "ALERTA: Se detectó fuga no visible en predio"
        else:
            result["fugas_geofono"] = "Inspección acústica con geófono realizada"
    return result


def _fetch_visits(nis: str) -> dict[str, list[tuple[str, str]]]:
    """Visitas de campo (fecha, observaciones) de las ultimas ordenes del NIS.

    Consulta aparte y tolerante a fallos: si Oracle no responde esta parte, la
    ficha se sube igual, solo que sin el analisis por inspeccion.
    """

    sql = f"""
PROMPT ===VISITAS===
SELECT V.NUM_OS || ';;' || TO_CHAR(V.F_VIS, 'YYYYMMDD') || ';;' ||
       NVL(TRIM(REPLACE(REPLACE(V.OBSERVACIONES, CHR(10), ' '), CHR(13), ' ')), '')
FROM VISITA V
WHERE V.NUM_OS IN (
  SELECT NUM_OS FROM (
    SELECT O.NUM_OS FROM ORDENES O WHERE O.NIS_RAD = {nis} ORDER BY O.F_GEN DESC NULLS LAST, O.F_UCE DESC
  ) WHERE ROWNUM <= {ORDERS_LIMIT}
)
ORDER BY V.NUM_OS, V.F_VIS;
"""
    try:
        rows = _sections(_run_sqlplus(sql)).get("VISITAS", [])
    except Exception as error:  # noqa: BLE001 - las visitas no deben tumbar la ficha
        print(f"open_sgc: visitas no disponibles para el NIS {nis}: {error}", file=sys.stderr)
        return {}
    visits: dict[str, list[tuple[str, str]]] = {}
    for row in rows:
        if len(row) >= 3 and row[0]:
            # Las observaciones pueden traer ";;": se vuelven a unir.
            visits.setdefault(row[0], []).append((_iso(row[1]), ";;".join(row[2:]).strip()))
    return visits


def _order_entry(row: list[str], visits: list[tuple[str, str]]) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "num_os": row[0], "tipo_os": row[1], "estado": row[2],
        "fecha_generacion": _iso(row[3]), "fecha_ejecucion": _iso(row[4]),
    }
    if visits:
        entry["fecha_visita"] = next((date for date, _ in visits if date), "")
        text = " ".join(observation for _, observation in visits if observation)
        try:
            entry["analisis"] = analyze_inspection(text, row[1])
        except Exception as error:  # noqa: BLE001 - un texto raro no debe tumbar toda la ficha
            print(f"open_sgc: sin analisis para la O/S {row[0]}: {error}", file=sys.stderr)
    return entry


def _amount(value: str) -> float | None:
    try:
        return float((value or "").replace(",", "."))
    except ValueError:
        return None


def _bill_entry(row: list[str]) -> dict[str, Any] | None:
    amount = _amount(row[2]) if len(row) >= 4 else None
    if amount is None or not _iso(row[0]):
        return None
    paid_on = _iso(row[3])
    return {
        "f_facturacion": _iso(row[0]),
        "nro_factura": row[1],
        "importe": amount,
        "f_cobro": paid_on or None,
        "estado_pago": "PAGADO" if paid_on else "PENDIENTE",
        "f_vencimiento": _iso(row[4]) if len(row) > 4 else "",
    }


def _fetch_details(nis: str) -> dict[str, Any]:
    """Resto de la ficha de `consultar_nis.py` para el portal de reclamos.

    Consulta aparte y tolerante a fallos (como las visitas): si Oracle no
    responde esta parte, la ficha base que usa el informe ITC se sube igual.
    Deja fuera telefono, correo y documento del cliente, y el usuario que
    registro cada precinto: el portal no los muestra.
    """

    sql = f"""
PROMPT ===SUMINISTRO===
SELECT NVL(TRIM(P.NOM_PROV), '') || ';;' ||
       NVL(TRIM(D.NOM_DEPTO), '') || ';;' ||
       NVL(TO_CHAR(F.NIF), '') || ';;' ||
       NVL(TRIM(E_SUM.DESC_EST), S.EST_SUM) || ';;' ||
       NVL(TRIM(T_SUM.DESC_TIPO), S.TIP_SUMINISTRO) || ';;' ||
       NVL(TO_CHAR(S.F_ALTA_CONT, 'YYYYMMDD'), '') || ';;' ||
       NVL(TO_CHAR(S.F_BAJA, 'YYYYMMDD'), '') || ';;' ||
       NVL(TO_CHAR(S.DIAMETRO_CONEXION), '') || ';;' ||
       NVL(TO_CHAR(S.NUM_CORT), '0') || ';;' ||
       NVL(S.F_CORTE, '') || ';;' ||
       S.COD_UNICOM || ';;' ||
       NVL(TRIM(U.NOM_UNICOM), '') || ';;' ||
       NVL(TRIM(T.DESC_TAR), S.COD_TAR) || ';;' ||
       DECODE(S.NUM_IDENT_SIPO, 'SUBSIDIADO', 'SI', 'NO') || ';;' ||
       NVL(TRIM(T_ASOC.DESC_TIPO), NVL(S.TIP_ASOC, 'Directa'))
FROM SUMCON S, FINCAS F, CALLEJERO CJ, PROVINCIAS P, DEPTOS D, UNICOM U, MTARIFAS T,
     TIPOS T_ASOC, ESTADOS E_SUM, TIPOS T_SUM
WHERE S.NIS_RAD = {nis}
  AND S.NIF = F.NIF (+)
  AND F.COD_CALLE = CJ.COD_CALLE (+)
  AND CJ.COD_PROV = P.COD_PROV (+)
  AND CJ.COD_DEPTO = D.COD_DEPTO (+)
  AND S.COD_UNICOM = U.COD_UNICOM (+)
  AND S.COD_TAR = T.COD_TAR (+)
  AND T_ASOC.TIPO (+) = S.TIP_ASOC
  AND E_SUM.ESTADO (+) = S.EST_SUM
  AND T_SUM.TIPO (+) = S.TIP_SUMINISTRO
  AND ROWNUM = 1;

PROMPT ===FICHA===
SELECT NVL(C_MARCA.DESC_COD, NVL(A.CO_MARCA, '')) || ';;' ||
       NVL(T_APA.DESC_TIPO, NVL(A.TIP_APA, '')) || ';;' ||
       NVL(E.DESC_EST, NVL(A.EST_APA, '')) || ';;' ||
       NVL(T_CSMO.DESC_TIPO, NVL(CO.TIP_CSMO, '')) || ';;' ||
       NVL(TO_CHAR(CO.LECT), '') || ';;' ||
       NVL(CO.F_LECT, '') || ';;' ||
       NVL(TO_CHAR(CO.COEF_PER), '0') || ';;' ||
       NVL(T_NORMA.DESC_TIPO, NVL(MO.NORMA, '')) || ';;' ||
       NVL(TO_CHAR(A.DIAMETRO), '') || ';;' ||
       NVL(TO_CHAR(A.CTE_APA), '1') || ';;' ||
       NVL(C_MET.DESC_COD, '') || ';;' ||
       NVL(A.F_UREVIS, '') || ';;' ||
       NVL(T_MAT.DESC_TIPO, NVL(A.TIP_MATERIAL, ''))
FROM APMEDIDA_AP A,
     (SELECT * FROM (
        SELECT NIS_RAD, LECT, F_LECT, TIP_CSMO, COEF_PER,
               ROW_NUMBER() OVER(PARTITION BY NIS_RAD ORDER BY F_LECT DESC) RN
        FROM APMEDIDA_CO WHERE NIS_RAD = {nis}
     ) WHERE RN = 1) CO,
     SIM_MEDIDORES SM, SIM_MODELOS MO, CODIGOS C_MARCA, TIPOS T_APA, ESTADOS E,
     TIPOS T_CSMO, TIPOS T_NORMA, TIPOS T_MAT, CODIGOS C_MET
WHERE A.NIS_RAD = {nis}
  AND A.NIS_RAD = CO.NIS_RAD (+)
  AND A.NUM_APA = SM.NUM_MEDIDOR (+)
  AND A.CO_MARCA = SM.CODIGO_MCA (+)
  AND SM.CODIGO_MCA = MO.CODIGO_MCA (+)
  AND SM.COD_MODELO = MO.COD_MODELO (+)
  AND C_MARCA.COD (+) = A.CO_MARCA
  AND T_APA.TIPO (+) = A.TIP_APA
  AND E.ESTADO (+) = A.EST_APA
  AND T_CSMO.TIPO (+) = CO.TIP_CSMO
  AND T_NORMA.TIPO (+) = MO.NORMA
  AND T_MAT.TIPO (+) = A.TIP_MATERIAL
  AND C_MET.COD (+) = MO.CLASE_MET
  AND ROWNUM = 1;

PROMPT ===DSEG===
SELECT TO_CHAR(D.F_ACTUAL, 'YYYYMMDD') || ';;' || D.NUM_DSEG || ';;' ||
       TO_CHAR(D.F_INST, 'YYYYMMDD') || ';;' || NVL(T.DESC_TIPO, D.TIP_DSEG)
FROM APMEDIDA_DSEG D, TIPOS T, APMEDIDA_AP A
WHERE A.NIS_RAD = {nis}
  AND D.NUM_APA = A.NUM_APA
  AND T.TIPO (+) = D.TIP_DSEG
ORDER BY D.F_INST DESC;

PROMPT ===DEUDA===
SELECT NVL(SUM(IMP_TOT_REC), 0) || ';;' || COUNT(*)
FROM RECIBOS
WHERE NIS_RAD = {nis}
  AND F_COBRO = '29991231'
  AND TIP_REC NOT IN ('TR085');

PROMPT ===CONCEPTOS===
SELECT CODIGOS.DESC_COD || ';;' || SUM(IMP_CONCEPTO.IMP_CONCEPTO)
FROM CODIGOS, IMP_CONCEPTO
WHERE IMP_CONCEPTO.CO_CONCEPTO = CODIGOS.COD
  AND IMP_CONCEPTO.NIS_RAD = {nis}
  AND IMP_CONCEPTO.F_FACT = (SELECT MAX(F_FACT) FROM RECIBOS WHERE NIS_RAD = {nis} AND SEC_REC = 0)
  AND IMP_CONCEPTO.SEC_REC = 0
GROUP BY CODIGOS.DESC_COD
ORDER BY SUM(IMP_CONCEPTO.IMP_CONCEPTO) DESC;
"""
    try:
        sections = _sections(_run_sqlplus(sql))
    except Exception as error:  # noqa: BLE001 - el detalle no debe tumbar la ficha
        print(f"open_sgc: detalle no disponible para el NIS {nis}: {error}", file=sys.stderr)
        return {}

    details: dict[str, Any] = {}
    supply = (sections.get("SUMINISTRO") or [[]])[0]
    if len(supply) >= 15:
        details["predio"] = {"provincia": supply[0], "departamento": supply[1], "nif": supply[2]}
        details["suministro"] = {
            "estado": supply[3], "tipo_suministro": supply[4], "fecha_alta": _iso(supply[5]),
            "fecha_baja": _iso(supply[6]), "diametro_conexion_mm": supply[7],
            "cantidad_cortes": int(supply[8]) if supply[8].isdigit() else 0,
            "fecha_ultimo_corte": _iso(supply[9]), "unicom_codigo": supply[10], "unicom_nombre": supply[11],
            "tarifa": supply[12], "subsidio_sisfoh": supply[13], "tipo_asociacion": supply[14],
        }
    sheet = (sections.get("FICHA") or [[]])[0]
    if len(sheet) >= 13:
        details["medidor"] = {
            "marca": sheet[0], "tipo_medidor": sheet[1], "estado": sheet[2], "tipo_consumo": sheet[3],
            "ultima_lectura": sheet[4], "fecha_ultima_lectura": _iso(sheet[5]), "coef_perdida": sheet[6],
            "norma": sheet[7], "diametro_mm": sheet[8], "cte_aparato": sheet[9], "clase_metrologica": sheet[10],
            "fecha_ultima_revision": _iso(sheet[11]), "material": sheet[12],
        }
    details["dispositivos_seguridad"] = [
        {"fecha_actualizacion": _iso(row[0]), "numero": row[1], "fecha_instalacion": _iso(row[2]), "tipo_dispositivo": row[3]}
        for row in sections.get("DSEG", []) if len(row) >= 4 and row[1]
    ]
    debt = (sections.get("DEUDA") or [[]])[0]
    if len(debt) >= 2 and _amount(debt[0]) is not None:
        details["deuda"] = {"total_pendiente": _amount(debt[0]), "recibos_impagos": int(debt[1]) if debt[1].isdigit() else 0}
    details["conceptos_ultimo_recibo"] = [
        {"concepto": row[0], "importe": _amount(row[1])}
        for row in sections.get("CONCEPTOS", []) if len(row) >= 2 and _amount(row[1]) is not None
    ]
    return details


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
SELECT NUM_APA || ';;' || LECT || ';;' || CSMO || ';;' || F_LECT || ';;' || TIPO || ';;' || INCIDENCIA || ';;' ||
       TIPO_CSMO || ';;' || NUM_RUE
FROM (
  SELECT C.NUM_APA, C.LECT, TO_CHAR(C.CSMO, 'FM999990.00') CSMO, C.F_LECT,
         NVL(T_LECT.DESC_TIPO, C.TIP_LECT) TIPO, NVL(CD.DESC_COD, '') INCIDENCIA,
         NVL(T_CSMO.DESC_TIPO, C.TIP_CSMO) TIPO_CSMO, NVL(TO_CHAR(C.NUM_RUE), '') NUM_RUE
  FROM APMEDIDA_CO C, TIPOS T_LECT, CODIGOS CD, TIPOS T_CSMO
  WHERE C.NIS_RAD = {nis}
    AND T_LECT.TIPO (+) = C.TIP_LECT
    AND CD.COD (+) = C.CO_AL
    AND T_CSMO.TIPO (+) = C.TIP_CSMO
  ORDER BY C.F_LECT DESC
)
WHERE ROWNUM <= {READINGS_LIMIT};

PROMPT ===HMED===
SELECT H.NUM_APA || ';;' || TO_CHAR(H.F_INST, 'YYYYMMDD') || ';;' ||
       TO_CHAR(H.F_LVTO, 'YYYYMMDD') || ';;' || NVL(C.DESC_COD, H.CO_MOT_LEVAN) || ';;' ||
       NVL(C_MARCA.DESC_COD, H.CO_MARCA) || ';;' || H.DIAMETRO
FROM HAPMEDIDA_AP H, CODIGOS C, CODIGOS C_MARCA
WHERE H.NIS_RAD = {nis}
  AND C.COD (+) = H.CO_MOT_LEVAN
  AND C_MARCA.COD (+) = H.CO_MARCA
ORDER BY H.F_LVTO DESC;

PROMPT ===ORDENES===
SELECT * FROM (
  SELECT O.NUM_OS || ';;' || NVL(T.DESC_TIPO, O.TIP_OS) || ';;' || NVL(E.DESC_EST, O.EST_OS) || ';;' ||
         TO_CHAR(O.F_GEN, 'YYYYMMDD') || ';;' || TO_CHAR(O.F_UCE, 'YYYYMMDD')
  FROM ORDENES O, TIPOS T, ESTADOS E
  WHERE O.NIS_RAD = {nis}
    AND T.TIPO (+) = O.TIP_OS
    AND E.ESTADO (+) = O.EST_OS
  ORDER BY O.F_GEN DESC NULLS LAST, O.F_UCE DESC
) WHERE ROWNUM <= {ORDERS_LIMIT};

PROMPT ===RECIBOS===
SELECT R.F_FACT || ';;' || TO_CHAR(R.NRO_FACTURA) || ';;' || R.IMP_TOT_REC || ';;' || R.F_COBRO || ';;' || R.F_VCTO_FAC
FROM (
  SELECT F_FACT, NRO_FACTURA, IMP_TOT_REC, F_COBRO, F_VCTO_FAC
  FROM RECIBOS
  WHERE NIS_RAD = {nis} AND TIP_REC NOT IN ('TR085')
  ORDER BY F_FACT DESC
) R
WHERE ROWNUM <= {BILLS_LIMIT};
"""
    sections = _sections(_run_sqlplus(sql))
    main = (sections.get("MAIN") or [[]])[0]
    if len(main) < 4:
        return None
    visits = _fetch_visits(nis)
    details = _fetch_details(nis)

    meter = (sections.get("MEDIDOR") or [[]])[0]
    return {
        "nis": nis,
        "cliente": {"titular": main[0]},
        "predio": {"direccion": main[1], "localidad_urb": main[2], "distrito": main[3], **details.get("predio", {})},
        "suministro": details.get("suministro", {}),
        "medidor": {
            "numero": meter[0] if len(meter) >= 2 else "",
            "fecha_instalacion": _iso(meter[1]) if len(meter) >= 2 else "",
            **details.get("medidor", {}),
        },
        "dispositivos_seguridad": details.get("dispositivos_seguridad", []),
        "deuda": details.get("deuda", {}),
        "conceptos_ultimo_recibo": details.get("conceptos_ultimo_recibo", []),
        "medidores_anteriores": [
            {
                "numero": row[0], "fecha_instalacion": _iso(row[1]), "fecha_retiro": _iso(row[2]), "motivo_retiro": row[3],
                "marca": row[4] if len(row) > 4 else "", "diametro_mm": row[5] if len(row) > 5 else "",
            }
            for row in sections.get("HMED", []) if len(row) >= 4 and row[0]
        ],
        "historial_lecturas": [
            {
                "numero_medidor": row[0], "lectura": row[1], "consumo_m3": row[2],
                "fecha_lectura": _iso(row[3]), "tipo_lectura": row[4], "incidencia": row[5],
                "tipo_consumo": row[6] if len(row) > 6 else "", "num_ruedas": row[7] if len(row) > 7 else "",
            }
            for row in sections.get("LECTURAS", []) if len(row) >= 6
        ],
        # Pestaña "Inspecciones y O/S" de consultar_nis_gui.py, sin el texto de
        # las visitas (trae telefonos y correos que el informe no usa): de ellas
        # solo sube `fecha_visita` y el `analisis` estructurado (ver
        # `analyze_inspection`).
        # Historial de recibos de consultar_nis.py (mismos filtros); el portal
        # publico de reclamos toma de aqui el importe facturado por mes.
        "recibos": [bill for bill in (_bill_entry(row) for row in sections.get("RECIBOS", [])) if bill],
        "ordenes_e_inspecciones": [
            _order_entry(row, visits.get(row[0], []))
            for row in sections.get("ORDENES", []) if len(row) >= 5 and row[0]
        ],
    }


if __name__ == "__main__":
    # Prueba manual, sin tocar AWS:  python open_sgc.py 5302831
    import json
    import sys

    print(json.dumps(fetch_supply(sys.argv[1].strip()), indent=2, ensure_ascii=False))
