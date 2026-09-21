"""Emisor local de adjuntos ITC: AGC privado -> AWS/S3.

No lee, mueve ni escribe en OneDrive. Su estado queda bajo PROGRAMDATA para no
mezclarse con las carpetas corporativas ya sincronizadas.
"""
from __future__ import annotations

import argparse
import base64
import calendar
import json
import os
import re
import time
import unicodedata
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import requests


FOLDERS = {
    "listaIC": "commercial-inspections", "listaTdE": "state-reading",
    "listaDyC": "distribution-communications", "listaDAC": "billing-notices",
    "listaMed": "meters", "listaSGIO": "sgio",
}
MONTHS = {name: number for number, name in enumerate(
    ("ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"), 1
)}
MONTHS["SEPTIEMBRE"] = 9


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Falta configurar {name} fuera de Git.")
    return value


def normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", text.upper()).strip()


def document_prefix(item: dict[str, Any], period_start: date) -> str:
    """Cuando MES RECLAMADO cubre varios tramos, el mismo indice de item se
    repite en cada tramo (cada uno reinicia su propia lista de AGC); sin la OS
    y el periodo en el nombre, dos documentos de meses distintos son
    indistinguibles al ordenar la carpeta. Formato: "OS<numero> - dd-mm-yyyy"
    (fecha = inicio del tramo/mes reclamado). Si AGC no trae OS para ese item,
    se omite ese segmento en vez de inventar un valor."""

    raw_os = item.get("ordTrabOrdServCedu") or item.get("numeroOT")
    safe_os = re.sub(r"[^A-Za-z0-9]+", "", str(raw_os)) if raw_os else ""
    period_text = period_start.strftime("%d-%m-%Y")
    return f"OS{safe_os} - {period_text}" if safe_os else period_text


def parse_ranges(value: object) -> list[tuple[date, date]]:
    text = normalize(value)
    match = re.fullmatch(r"(.+?)\s+(20\d{2})", text)
    if not match:
        raise ValueError("MES RECLAMADO debe incluir meses y año de cuatro dígitos.")
    expression, raw_year = match.groups()
    year = int(raw_year)
    ranges: list[tuple[date, date]] = []
    for section in re.split(r"\s*,\s*|\s+Y\s+", expression):
        part = section.strip()
        between = re.fullmatch(r"([A-Z]+)\s+A\s+([A-Z]+)", part)
        if between:
            start, end = (MONTHS.get(item) for item in between.groups())
            if not start or not end or start > end:
                raise ValueError("MES RECLAMADO contiene un tramo inválido.")
            ranges.append((date(year, start, 1), date(year, end, calendar.monthrange(year, end)[1])))
        elif part in MONTHS:
            month = MONTHS[part]
            ranges.append((date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])))
        else:
            raise ValueError("MES RECLAMADO no tiene un formato determinista; debe corregirse antes de emitir.")
    ordered = sorted(ranges)
    if not ordered or any(current[0] <= previous[1] for previous, current in zip(ordered, ordered[1:])):
        raise ValueError("MES RECLAMADO contiene tramos vacíos o superpuestos.")
    return with_baseline_month(ordered)


def with_baseline_month(ranges: list[tuple[date, date]]) -> list[tuple[date, date]]:
    """Extiende cada tramo un mes hacia atras y fusiona los que quedan pegados.

    El informe de CONSUMO MEDIDO sustenta el volumen como *diferencia de
    lecturas*, asi que la lectura del mes anterior al primer mes reclamado es
    parte del sustento: un reclamo de ABRIL necesita tambien los digitalizados
    de MARZO. Se aplica por tramo -- `ENERO, JULIO A SETIEMBRE` son dos
    reclamos y cada uno necesita su propia lectura de partida.

    Debe mantenerse igual que `with_baseline_month()` en
    `sedapal-backend-aws/app/services/itc_claim_periods.py`.
    """

    extended = [
        ((date(start.year - 1, 12, 1) if start.month == 1 else date(start.year, start.month - 1, 1)), end)
        for start, end in sorted(ranges)
    ]
    merged = [extended[0]]
    for start, end in extended[1:]:
        last_start, last_end = merged[-1]
        # Se funden los que se solapan y los que solo se tocan: tras retroceder
        # un mes, `FEBRERO, ABRIL` queda como cuatro meses seguidos y una sola
        # consulta trae los mismos documentos que dos.
        if start <= last_end + timedelta(days=1):
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


class Emitter:
    def __init__(self) -> None:
        self.api = require_env("SEDAPAL_AWS_API_BASE_URL").rstrip("/")
        self.api_key = require_env("SEDAPAL_AWS_API_KEY")
        self.agc = require_env("AGC_API_BASE_URL").rstrip("/")
        self.username = require_env("AGC_USERNAME")
        self.password = require_env("AGC_PASSWORD")
        self.office_code = int(os.environ.get("AGC_OFFICE_CODE", "1001"))
        self.emitter_id = os.environ.get("SEDAPAL_ITC_EMITTER_ID", os.environ.get("COMPUTERNAME", "itc-local")).strip()
        if not re.fullmatch(r"[A-Za-z0-9._-]{8,120}", self.emitter_id):
            raise RuntimeError("SEDAPAL_ITC_EMITTER_ID debe tener entre 8 y 120 caracteres seguros.")
        root = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "SEDAPALGIS" / "itc-emitter"
        root.mkdir(parents=True, exist_ok=True)
        self.state_path = root / "state.json"
        agc_web_url = os.environ.get("AGC_WEB_URL", "http://prdnginx.sedapal.com.pe")
        self.agc_session = requests.Session()
        self.agc_session.headers.update({
            # AGC devuelve 401 sin estos encabezados de navegador, aunque las
            # credenciales sean validas -- comprobado contra sedapal_client.py.
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": f"{agc_web_url}/",
            "Origin": agc_web_url,
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            # AGC rechaza con 401 cualquier solicitud sin esta clave, aunque
            # vaya vacia -- su proxy la usa como huella del cliente web real.
            "authorization": "",
        })

    def aws_post(self, suffix: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(f"{self.api}/api/informes{suffix}", json=payload, headers={"x-api-key": self.api_key}, timeout=120)
        response.raise_for_status()
        return response.json()

    def agc_post(self, suffix: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
        response = self.agc_session.post(f"{self.agc}{suffix}", json=payload, timeout=timeout)
        response.raise_for_status()
        data = response.json()
        if data.get("estado") not in {None, "OK"}:
            raise RuntimeError("AGC rechazó la consulta documental.")
        return data

    def login_agc(self) -> None:
        data = self.agc_post("/api/credenciales/login", {"usuario": self.username, "clave": self.password, "token": "", "ip": ""})
        token = (data.get("resultado") or {}).get("token")
        if not token:
            raise RuntimeError("AGC no devolvió una sesión válida.")
        self.agc_session.headers["Authorization"] = f"Bearer {token}"

    def document_payload(self, item: dict[str, Any]) -> dict[str, Any]:
        activity = item.get("actividad") or {}
        return {
            "suministro": item.get("suministro"), "numeroCarga": item.get("numeroCarga"),
            "idCargaDetalle": item.get("idCargaDetalle"), "ordTrabOrdServCedu": item.get("ordTrabOrdServCedu"),
            "tipologia": item.get("tipologia"), "numeroOT": item.get("numeroOT"),
            "actividad": activity.get("codigo") if isinstance(activity, dict) else str(activity),
            "accion": "V", "usuario": self.username, "ip": "",
        }

    def upload(self, job_id: int, folder: str, name: str, content: bytes, content_type: str, source: dict[str, Any]) -> None:
        self.aws_post(f"/emitter/{job_id}/assets", {
            "emitterId": self.emitter_id, "folderCode": folder, "fileName": name,
            "contentType": content_type, "contentBase64": base64.b64encode(content).decode("ascii"),
            "sourceMetadata": source,
        })

    def run_one(self) -> bool:
        claimed = self.aws_post("/emitter/claim", {"emitterId": self.emitter_id}).get("job")
        if not claimed:
            return False
        job_id, record_id, source = claimed["jobId"], claimed["recordId"], claimed["sourceData"]
        try:
            fields = {re.sub(r"[^a-z0-9]", "", normalize(key).lower()): value for key, value in source.items()}
            supply = str(fields.get("suministroocodigodeusuario", "")).strip()
            ranges = parse_ranges(fields.get("mesreclamado", ""))
            if not supply:
                raise ValueError("El registro no tiene SUMINISTRO O CODIGO DE USUARIO.")
            self.login_agc()
            for start, end in ranges:
                result = self.agc_post("/digitalizado/digitalizados?pagina=1&registros=1000000", {
                    "suministro": int(supply) if supply.isdigit() else supply, "numeroCarga": None, "ordenServicio": None,
                    "ordenTrabajo": None, "numeroCedula": None, "numeroReclamo": None,
                    "fechaInicio": f"{start:%Y-%m-%d}T05:00:00.000Z", "fechaFin": f"{end:%Y-%m-%d}T23:59:59.000Z",
                    "digitalizado": 0, "actividad": {"codigo": None, "descripcion": None}, "oficina": {"codigo": self.office_code, "descripcion": None},
                }).get("resultado") or {}
                for result_key, folder in FOLDERS.items():
                    for index, item in enumerate(result.get(result_key) or [], 1):
                        metadata = {**item, "itcQueryRange": {"start": start.isoformat(), "end": end.isoformat()}}
                        payload = self.document_payload(item)
                        prefix = document_prefix(item, start)
                        if int(item.get("cantAdj") or 0) > 0:
                            url = self.agc_post("/digitalizado/visor-digitalizado", payload).get("resultado")
                            if url:
                                pdf = self.agc_session.get(str(url), timeout=60); pdf.raise_for_status()
                                self.upload(job_id, folder, f"{prefix}_{index:03d}_documento.pdf", pdf.content, "application/pdf", metadata)
                        if int(item.get("cantImg") or 0) > 0:
                            images = self.agc_post("/digitalizado/visor-digitalizado-jpg", payload).get("resultado") or []
                            for image_index, encoded in enumerate(images, 1):
                                self.upload(job_id, folder, f"{prefix}_{index:03d}_foto_{image_index:03d}.jpg", base64.b64decode(encoded, validate=True), "image/jpeg", metadata)
            self.aws_post(f"/emitter/{job_id}/complete", {"emitterId": self.emitter_id})
            self.state_path.write_text(json.dumps({"lastJobId": job_id, "recordId": record_id, "completedAt": time.time()}), encoding="utf-8")
        except Exception as error:
            self.aws_post(f"/emitter/{job_id}/fail", {"emitterId": self.emitter_id, "message": str(error)[:500]})
        return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--interval", type=int, default=20)
    args = parser.parse_args()
    emitter = Emitter()
    while True:
        processed = emitter.run_one()
        if processed:
            # Sigue drenando la cola: puede haber varios registros encolados
            # casi al mismo tiempo (una misma importación de Excel) y cada
            # `run_one()` solo reclama un trabajo. Sin este bucle, una
            # ejecución sin --watch se detenía tras el primero y dejaba el
            # resto "En cola" hasta la siguiente corrida programada.
            continue
        if not args.watch:
            break
        time.sleep(max(5, args.interval))


if __name__ == "__main__":
    main()
