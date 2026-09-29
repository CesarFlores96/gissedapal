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
import threading
import time
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests

import open_sgc


FOLDERS = {
    "listaIC": "commercial-inspections", "listaTdE": "state-reading",
    "listaDyC": "distribution-communications", "listaDAC": "billing-notices",
    "listaMed": "meters", "listaSGIO": "sgio",
}
METERS_RESULT_KEY = "listaMed"
LOGIN_PATH = "/api/credenciales/login"
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


def agc_accounts() -> list[tuple[str, str]]:
    """Cuentas AGC para repartir las sesiones.

    `AGC_ACCOUNTS="USUARIO1:CLAVE1;USUARIO2:CLAVE2"`; si no esta, la cuenta
    unica de `AGC_USERNAME`/`AGC_PASSWORD`. Dos sesiones de la misma cuenta
    conviven sin invalidarse (comprobado el 2026-09-29).
    """

    raw = os.environ.get("AGC_ACCOUNTS", "").strip()
    if not raw:
        return [(require_env("AGC_USERNAME"), require_env("AGC_PASSWORD"))]
    accounts = []
    for entry in raw.split(";"):
        user, separator, password = entry.strip().partition(":")
        if not separator or not user.strip() or not password:
            raise RuntimeError("AGC_ACCOUNTS debe tener el formato USUARIO:CLAVE;USUARIO:CLAVE.")
        accounts.append((user.strip(), password))
    return accounts


class TransientError(RuntimeError):
    """Fallo pasajero (AGC o AWS caidos un momento): el trabajo vuelve a la cola."""


def is_transient(error: Exception) -> bool:
    if isinstance(error, (TransientError, requests.ConnectionError, requests.Timeout)):
        return True
    response = getattr(error, "response", None)
    return isinstance(error, requests.HTTPError) and response is not None and response.status_code >= 500


class Shared:
    """Estado comun a los trabajadores de una corrida."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cooldown_until = 0.0
        self.batch_supported = True

    def pause_all(self, seconds: float) -> None:
        # Si AGC fallo para uno, casi seguro falla para todos: que ningun
        # trabajador reclame otro registro hasta que pase la pausa.
        with self.lock:
            self.cooldown_until = max(self.cooldown_until, time.time() + seconds)

    def wait_cooldown(self) -> None:
        while (remaining := self.cooldown_until - time.time()) > 0:
            time.sleep(min(remaining, 5))


# Binarios acumulados antes de enviar un lote a AWS (~11 MB en Base64, por
# debajo del tope de 40 MB del endpoint /assets/batch).
BATCH_MAX_BYTES = 8 * 1024 * 1024
TRANSIENT_PAUSE_SECONDS = 30


class Emitter:
    def __init__(self, username: str, password: str, shared: Shared | None = None, name: str = "itc") -> None:
        self.api = require_env("SEDAPAL_AWS_API_BASE_URL").rstrip("/")
        self.api_key = require_env("SEDAPAL_AWS_API_KEY")
        self.agc = require_env("AGC_API_BASE_URL").rstrip("/")
        self.username = username
        self.password = password
        self.shared = shared or Shared()
        self.name = name
        self.logged_in = False
        self.pending: list[dict[str, Any]] = []
        self.pending_bytes = 0
        self.aws_session = requests.Session()
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
        response = self.aws_session.post(f"{self.api}/api/informes{suffix}", json=payload, headers={"x-api-key": self.api_key}, timeout=180)
        response.raise_for_status()
        return response.json()

    def agc_post(self, suffix: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
        if suffix != LOGIN_PATH:
            self.ensure_login()
        try:
            return self._agc_post(suffix, payload, timeout)
        except requests.HTTPError as error:
            # El token se reutiliza en toda la corrida; si AGC lo vence,
            # un login nuevo y un solo reintento.
            if suffix == LOGIN_PATH or error.response is None or error.response.status_code != 401:
                raise
            self.logged_in = False
            self.ensure_login()
            return self._agc_post(suffix, payload, timeout)

    def _agc_post(self, suffix: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
        # AGC responde 500/502/503/504 de forma intermitente bajo carga (p. ej.
        # al procesar varios registros seguidos, visto en el login el
        # 2026-09-29); reintentar con espera evita marcar el informe como
        # fallido por un error transitorio.
        for attempt in range(4):
            try:
                response = self.agc_session.post(f"{self.agc}{suffix}", json=payload, timeout=timeout)
                if response.status_code in {500, 502, 503, 504} and attempt < 3:
                    time.sleep(3 * (attempt + 1))
                    continue
                break
            except (requests.ConnectionError, requests.Timeout):
                if attempt == 3:
                    raise
                time.sleep(3 * (attempt + 1))
        response.raise_for_status()
        data = response.json()
        if data.get("estado") not in {None, "OK"}:
            raise RuntimeError("AGC rechazó la consulta documental.")
        return data

    def ensure_login(self) -> None:
        """Una sola sesion AGC por trabajador para toda la corrida."""

        if self.logged_in:
            return
        data = self._agc_post(LOGIN_PATH, {"usuario": self.username, "clave": self.password, "token": "", "ip": ""}, 60)
        token = (data.get("resultado") or {}).get("token")
        if not token:
            raise TransientError("AGC no devolvió una sesión válida.")
        self.agc_session.headers["Authorization"] = f"Bearer {token}"
        self.logged_in = True

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
        """Acumula el archivo; se envia en lote al juntar BATCH_MAX_BYTES o al cerrar el trabajo."""

        self.pending.append({
            "folderCode": folder, "fileName": name, "contentType": content_type,
            "contentBase64": base64.b64encode(content).decode("ascii"), "sourceMetadata": source,
        })
        self.pending_bytes += len(content)
        if self.pending_bytes >= BATCH_MAX_BYTES:
            self.flush_uploads(job_id)

    def flush_uploads(self, job_id: int) -> None:
        # Se vacia la lista recien despues de enviar: si el envio falla dentro
        # de un paso que se traga errores (medidores), el cierre del trabajo
        # lo reintenta en vez de perder archivos en silencio.
        if not self.pending:
            return
        sent = False
        if self.shared.batch_supported:
            try:
                self.aws_post(f"/emitter/{job_id}/assets/batch", {"emitterId": self.emitter_id, "files": self.pending})
                sent = True
            except requests.HTTPError as error:
                # Backend aun sin /assets/batch (desplegado despues que este
                # script): se sigue archivo por archivo con el endpoint anterior.
                if error.response is None or error.response.status_code != 404:
                    raise
                self.shared.batch_supported = False
        if not sent:
            for item in self.pending:
                self.aws_post(f"/emitter/{job_id}/assets", {"emitterId": self.emitter_id, **item})
        self.pending, self.pending_bytes = [], 0

    def query_digitalizados(self, supply: str, start: date | None, end: date | None) -> dict[str, Any]:
        """Consulta "Digitalizados" del AGC; sin fechas trae todo el historial."""

        return self.agc_post("/digitalizado/digitalizados?pagina=1&registros=1000000", {
            "suministro": int(supply) if supply.isdigit() else supply, "numeroCarga": None, "ordenServicio": None,
            "ordenTrabajo": None, "numeroCedula": None, "numeroReclamo": None,
            "fechaInicio": f"{start:%Y-%m-%d}T05:00:00.000Z" if start else None,
            "fechaFin": f"{end:%Y-%m-%d}T23:59:59.000Z" if end else None,
            "digitalizado": 0, "actividad": {"codigo": None, "descripcion": None}, "oficina": {"codigo": self.office_code, "descripcion": None},
        }).get("resultado") or {}

    def archive_item(self, job_id: int, folder: str, index: int, item: dict[str, Any], prefix: str, metadata: dict[str, Any]) -> None:
        """Descarga el PDF y las fotos de un documento del AGC y los sube a AWS."""

        payload = self.document_payload(item)
        if int(item.get("cantAdj") or 0) > 0:
            url = self.agc_post("/digitalizado/visor-digitalizado", payload).get("resultado")
            if url:
                pdf = self.agc_session.get(str(url), timeout=60); pdf.raise_for_status()
                self.upload(job_id, folder, f"{prefix}_{index:03d}_documento.pdf", pdf.content, "application/pdf", metadata)
        if int(item.get("cantImg") or 0) > 0:
            images = self.agc_post("/digitalizado/visor-digitalizado-jpg", payload).get("resultado") or []
            for image_index, encoded in enumerate(images, 1):
                self.upload(job_id, folder, f"{prefix}_{index:03d}_foto_{image_index:03d}.jpg", base64.b64decode(encoded, validate=True), "image/jpeg", metadata)

    def archive_latest_meter(self, job_id: int, supply: str, claim_end: date) -> None:
        """ANEXO 1 del informe: el registro mas reciente de Medidores hasta el mes reclamado.

        Consulta adicional a la de los meses reclamados: solo con el suministro,
        sin fechas. De ahi se descartan los medidores ejecutados despues del fin
        del ultimo mes reclamado (`claim_end`): un medidor posterior no acredita
        lo que se reclama. Entre los restantes se toma el mas reciente. Si falla,
        los documentos de los meses reclamados igual se entregan y el analista
        puede subir el ANEXO 1 a mano.
        """

        try:
            meters = self.query_digitalizados(supply, None, None).get(METERS_RESULT_KEY) or []
            eligible: list[tuple[date, dict[str, Any]]] = []
            for item in meters:
                try:
                    executed_on = datetime.strptime(str(item.get("fechaEjecucion") or "").strip(), "%d/%m/%Y").date()
                except ValueError:
                    continue  # sin fecha valida no se puede saber si es posterior al reclamo
                if executed_on <= claim_end:
                    eligible.append((executed_on, item))
            if not eligible:
                return
            executed_on, item = max(eligible, key=lambda pair: pair[0])
            self.archive_item(job_id, FOLDERS[METERS_RESULT_KEY], 1, item, document_prefix(item, executed_on), {**item, "itcLatestMeter": True})
        except Exception as error:  # noqa: BLE001 - un fallo aqui no debe tumbar el resto del informe
            print(f"[medidores] suministro {supply}: {error}")

    def send_open_sgc(self, job_id: int, supply: str) -> None:
        """Ficha de Open SGC (Oracle) del suministro -> AWS.

        Es un complemento: medidor, fecha de instalacion, lecturas y direccion
        vigentes para el borrador. Si esta PC no tiene Oracle configurado o la
        consulta falla, los documentos del AGC igual se entregan y el borrador
        sigue usando los TXT importados.
        """

        if not open_sgc.is_configured() or not supply.isdigit():
            return
        try:
            snapshot = open_sgc.fetch_supply(supply)
            if snapshot:
                self.aws_post(f"/emitter/{job_id}/open-sgc", {
                    "emitterId": self.emitter_id, "supplyCode": supply, "snapshot": snapshot,
                })
        except Exception as error:  # noqa: BLE001 - Oracle no debe tumbar el AGC
            print(f"[open-sgc] suministro {supply}: {error}")

    def run_one(self) -> bool:
        self.shared.wait_cooldown()
        claimed = self.aws_post("/emitter/claim", {"emitterId": self.emitter_id}).get("job")
        if not claimed:
            return False
        job_id, record_id, source = claimed["jobId"], claimed["recordId"], claimed["sourceData"]
        self.pending, self.pending_bytes = [], 0
        started = time.time()
        try:
            fields = {re.sub(r"[^a-z0-9]", "", normalize(key).lower()): value for key, value in source.items()}
            supply = str(fields.get("suministroocodigodeusuario", "")).strip()
            ranges = parse_ranges(fields.get("mesreclamado", ""))
            if not supply:
                raise ValueError("El registro no tiene SUMINISTRO O CODIGO DE USUARIO.")
            for start, end in ranges:
                result = self.query_digitalizados(supply, start, end)
                for result_key, folder in FOLDERS.items():
                    if result_key == METERS_RESULT_KEY:
                        # Medidores (ANEXO 1) no sale de los meses reclamados: viene
                        # de la consulta sin fecha de `archive_latest_meter`.
                        continue
                    for index, item in enumerate(result.get(result_key) or [], 1):
                        metadata = {**item, "itcQueryRange": {"start": start.isoformat(), "end": end.isoformat()}}
                        self.archive_item(job_id, folder, index, item, document_prefix(item, start), metadata)
            self.archive_latest_meter(job_id, supply, max(end for _, end in ranges))
            self.flush_uploads(job_id)
            self.send_open_sgc(job_id, supply)
            self.aws_post(f"/emitter/{job_id}/complete", {"emitterId": self.emitter_id})
            print(f"[{self.name}] registro {record_id} listo en {time.time() - started:.1f}s")
            with self.shared.lock:
                self.state_path.write_text(json.dumps({"lastJobId": job_id, "recordId": record_id, "completedAt": time.time()}), encoding="utf-8")
        except Exception as error:
            retryable = is_transient(error)
            print(f"[{self.name}] registro {record_id} {'reencolado' if retryable else 'fallido'}: {error}")
            if retryable:
                self.logged_in = False  # la sesion pudo quedar inservible
                self.shared.pause_all(TRANSIENT_PAUSE_SECONDS)
            self.aws_post(f"/emitter/{job_id}/fail", {"emitterId": self.emitter_id, "message": str(error)[:500], "retryable": retryable})
        return True

    def drain(self, watch: bool, interval: int) -> None:
        while True:
            try:
                if self.run_one():
                    # Sigue drenando la cola: cada `run_one()` reclama un solo
                    # trabajo y una importación de Excel encola varios a la vez.
                    continue
            except Exception as error:  # noqa: BLE001 - un tropiezo con AWS no debe matar al trabajador
                print(f"[{self.name}] error con AWS: {error}")
                if not watch:
                    return  # la proxima corrida programada reintenta
                self.shared.pause_all(TRANSIENT_PAUSE_SECONDS)
                continue
            if not watch:
                return
            time.sleep(max(5, interval))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--interval", type=int, default=20)
    args = parser.parse_args()
    # Tope de sesiones AGC simultaneas en total (pedido del usuario el
    # 2026-09-29: AGC no debe cargar mas de 3 a la vez). Se reparten por turno
    # entre las cuentas: con 2 cuentas quedan 2 + 1.
    sessions = max(1, min(int(os.environ.get("AGC_MAX_SESSIONS", "3")), 3))
    accounts = agc_accounts()
    shared = Shared()
    workers = [
        Emitter(*accounts[index % len(accounts)], shared=shared, name=f"w{index + 1}:{accounts[index % len(accounts)][0]}")
        for index in range(sessions)
    ]
    threads = []
    for worker in workers:
        thread = threading.Thread(target=worker.drain, args=(args.watch, args.interval), name=worker.name)
        thread.start()
        threads.append(thread)
        time.sleep(1)  # escalonar los logins en AGC
    for thread in threads:
        thread.join()


if __name__ == "__main__":
    main()
