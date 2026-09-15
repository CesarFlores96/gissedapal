//! Estado durable de la cola de fotos.
//!
//! SQLite vive bajo LocalAppData y contiene solo metadatos, informes y el
//! outbox. La carpeta de fotos sigue siendo la fuente de las imágenes; no se
//! copia ni se abre fuera de una carpeta elegida por el diálogo nativo.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::AppError;

const DB_NAME: &str = "meter-analysis.sqlite3";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DurableRunSummary {
    pub(crate) run_id: String,
    pub(crate) folder: String,
    pub(crate) status: String,
    pub(crate) total: usize,
    pub(crate) pending: usize,
    pub(crate) processing: usize,
    pub(crate) done: usize,
    pub(crate) error: usize,
    pub(crate) needs_attention: usize,
    pub(crate) pending_sync: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DurableItem {
    pub(crate) relative_path: String,
    /// Ruta absoluta lista para IPC (`get_meter_photo`, etc.). Se calcula con
    /// `Path::join`, nunca concatenando strings: la raíz viene canonicalizada
    /// (`\\?\` en Windows), y ese prefijo desactiva la traducción normal de
    /// '/' a '\', así que un join manual con '/' deja una ruta que Windows no
    /// resuelve. Vacía en items que nunca cruzan a IPC (ver cada sitio).
    pub(crate) file_path: String,
    pub(crate) file_name: String,
    pub(crate) size_bytes: u64,
    pub(crate) modified_ms: i64,
    pub(crate) sha256: String,
    pub(crate) status: String,
    pub(crate) attempts: u32,
    pub(crate) result: Option<Value>,
    pub(crate) attention_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DurablePage {
    pub(crate) data: Vec<DurableItem>,
    pub(crate) page: usize,
    pub(crate) page_size: usize,
    pub(crate) total: usize,
}

#[derive(Clone)]
pub(crate) struct MeterQueueStore {
    path: PathBuf,
}

impl MeterQueueStore {
    pub(crate) fn new() -> Result<Self, AppError> {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| AppError::PhotoFolder("No se encontró LocalAppData.".into()))?
            .join("SEDAPALGIS");
        std::fs::create_dir_all(&base).map_err(store_error)?;
        Self::new_at(base.join(DB_NAME))
    }

    pub(crate) fn new_at(path: PathBuf) -> Result<Self, AppError> {
        let store = Self { path };
        store.migrate()?;
        Ok(store)
    }

    fn open(&self) -> Result<Connection, AppError> {
        let connection = Connection::open(&self.path).map_err(store_error)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(store_error)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(store_error)?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(store_error)?;
        Ok(connection)
    }

    fn migrate(&self) -> Result<(), AppError> {
        let connection = self.open()?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                folder TEXT NOT NULL,
                recursive INTEGER NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('preparing','running','paused','cancelled','completed')),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS items (
                run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
                relative_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                modified_ms INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','error','cancelled','needs_attention')),
                attempts INTEGER NOT NULL DEFAULT 0,
                result_json TEXT,
                attention_reason TEXT,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(run_id, relative_path)
            );
            CREATE INDEX IF NOT EXISTS items_run_status_idx ON items(run_id, status);
            CREATE TABLE IF NOT EXISTS outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
                relative_path TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                sent_at INTEGER,
                UNIQUE(run_id, relative_path)
            );
            CREATE INDEX IF NOT EXISTS outbox_unsent_idx ON outbox(run_id, sent_at, id);
            ",
        ).map_err(store_error)
    }

    pub(crate) fn create_run(
        &self,
        run_id: &str,
        folder: &Path,
        recursive: bool,
        items: &[DurableItem],
    ) -> Result<(), AppError> {
        let mut connection = self.open()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let now = now_ms();
        tx.execute(
            "INSERT INTO runs(run_id, folder, recursive, status, created_at, updated_at) VALUES(?1, ?2, ?3, 'preparing', ?4, ?4)",
            params![run_id, folder.to_string_lossy(), i64::from(recursive), now],
        ).map_err(store_error)?;
        {
            let mut statement = tx.prepare(
                "INSERT INTO items(run_id, relative_path, file_name, size_bytes, modified_ms, sha256, status, attempts, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7)",
            ).map_err(store_error)?;
            for item in items {
                statement
                    .execute(params![
                        run_id,
                        item.relative_path,
                        item.file_name,
                        item.size_bytes as i64,
                        item.modified_ms,
                        item.sha256,
                        now
                    ])
                    .map_err(store_error)?;
            }
        }
        tx.execute(
            "UPDATE runs SET status = 'paused', updated_at = ?2 WHERE run_id = ?1",
            params![run_id, now],
        )
        .map_err(store_error)?;
        tx.commit().map_err(store_error)
    }

    pub(crate) fn mark_status(&self, run_id: &str, status: &str) -> Result<(), AppError> {
        self.open()?
            .execute(
                "UPDATE runs SET status = ?2, updated_at = ?3 WHERE run_id = ?1",
                params![run_id, status, now_ms()],
            )
            .map_err(store_error)?;
        Ok(())
    }

    pub(crate) fn pause_run(&self, run_id: &str) -> Result<(), AppError> {
        let mut connection = self.open()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        tx.execute(
            "UPDATE items SET status = 'pending', updated_at = ?2 WHERE run_id = ?1 AND status = 'processing'",
            params![run_id, now_ms()],
        )
        .map_err(store_error)?;
        tx.execute(
            "UPDATE runs SET status = 'paused', updated_at = ?2 WHERE run_id = ?1",
            params![run_id, now_ms()],
        )
        .map_err(store_error)?;
        tx.commit().map_err(store_error)
    }

    pub(crate) fn cancel_run(&self, run_id: &str) -> Result<(), AppError> {
        let mut connection = self.open()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        tx.execute(
            "UPDATE items SET status = 'cancelled', updated_at = ?2 WHERE run_id = ?1 AND status IN ('pending', 'processing')",
            params![run_id, now_ms()],
        )
        .map_err(store_error)?;
        tx.execute(
            "UPDATE runs SET status = 'cancelled', updated_at = ?2 WHERE run_id = ?1",
            params![run_id, now_ms()],
        )
        .map_err(store_error)?;
        tx.commit().map_err(store_error)
    }

    pub(crate) fn claim_next(&self, run_id: &str) -> Result<Option<DurableItem>, AppError> {
        let mut connection = self.open()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let item = tx
            .query_row(
                "SELECT relative_path, file_name, size_bytes, modified_ms, sha256, status, attempts, result_json, attention_reason
                 FROM items WHERE run_id = ?1 AND status = 'pending' ORDER BY relative_path LIMIT 1",
                params![run_id],
                durable_item_from_row,
            )
            .optional()
            .map_err(store_error)?;
        let Some(mut item) = item else {
            tx.commit().map_err(store_error)?;
            return Ok(None);
        };
        item.status = "processing".to_string();
        item.attempts = item.attempts.saturating_add(1);
        tx.execute(
            "UPDATE items SET status = 'processing', attempts = ?3, updated_at = ?4 WHERE run_id = ?1 AND relative_path = ?2",
            params![run_id, item.relative_path, item.attempts, now_ms()],
        )
        .map_err(store_error)?;
        tx.commit().map_err(store_error)?;
        Ok(Some(item))
    }

    pub(crate) fn needs_attention(
        &self,
        run_id: &str,
        relative_path: &str,
    ) -> Result<bool, AppError> {
        self.open()?
            .query_row(
                "SELECT status = 'needs_attention' FROM items WHERE run_id = ?1 AND relative_path = ?2",
                params![run_id, relative_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)
            .map(|value| value.unwrap_or(false))
    }

    pub(crate) fn list_runs(&self) -> Result<Vec<DurableRunSummary>, AppError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT r.run_id, r.folder, r.status, COUNT(i.relative_path),
              COUNT(i.relative_path) FILTER (WHERE i.status = 'pending'),
              COUNT(i.relative_path) FILTER (WHERE i.status = 'processing'),
              COUNT(i.relative_path) FILTER (WHERE i.status = 'done'),
              COUNT(i.relative_path) FILTER (WHERE i.status = 'error'),
              COUNT(i.relative_path) FILTER (WHERE i.status = 'needs_attention'),
              (SELECT COUNT(*) FROM outbox o WHERE o.run_id = r.run_id AND o.sent_at IS NULL)
             FROM runs r LEFT JOIN items i ON i.run_id = r.run_id
             GROUP BY r.run_id ORDER BY r.updated_at DESC",
            )
            .map_err(store_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(DurableRunSummary {
                    run_id: row.get(0)?,
                    folder: row.get(1)?,
                    status: row.get(2)?,
                    total: row.get::<_, i64>(3)? as usize,
                    pending: row.get::<_, i64>(4)? as usize,
                    processing: row.get::<_, i64>(5)? as usize,
                    done: row.get::<_, i64>(6)? as usize,
                    error: row.get::<_, i64>(7)? as usize,
                    needs_attention: row.get::<_, i64>(8)? as usize,
                    pending_sync: row.get::<_, i64>(9)? as usize,
                })
            })
            .map_err(store_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(store_error)
    }

    pub(crate) fn page_items(
        &self,
        run_id: &str,
        page: usize,
        page_size: usize,
        search: Option<&str>,
    ) -> Result<DurablePage, AppError> {
        let size = page_size.clamp(1, 100) as i64;
        let offset = page.saturating_sub(1) as i64 * size;
        let pattern = search.map(|value| format!("%{}%", value.to_lowercase()));
        let connection = self.open()?;
        let folder: String = connection
            .query_row(
                "SELECT folder FROM runs WHERE run_id = ?1",
                params![run_id],
                |row| row.get(0),
            )
            .map_err(store_error)?;
        let where_sql = if pattern.is_some() {
            " AND (lower(file_name) LIKE ?2 OR lower(relative_path) LIKE ?2)"
        } else {
            ""
        };
        let total: i64 = if let Some(ref value) = pattern {
            connection
                .query_row(
                    &format!("SELECT COUNT(*) FROM items WHERE run_id = ?1{where_sql}"),
                    params![run_id, value],
                    |row| row.get(0),
                )
                .map_err(store_error)?
        } else {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM items WHERE run_id = ?1",
                    params![run_id],
                    |row| row.get(0),
                )
                .map_err(store_error)?
        };
        let sql = format!("SELECT relative_path,file_name,size_bytes,modified_ms,sha256,status,attempts,result_json,attention_reason FROM items WHERE run_id = ?1{where_sql} ORDER BY relative_path LIMIT ?{} OFFSET ?{}", if pattern.is_some() { 3 } else { 2 }, if pattern.is_some() { 4 } else { 3 });
        let mut statement = connection.prepare(&sql).map_err(store_error)?;
        let mut map = |row: &rusqlite::Row<'_>| -> rusqlite::Result<DurableItem> {
            let relative_path: String = row.get(0)?;
            // `Path::join`, no un template string: la carpeta viene canonicalizada
            // (`\\?\` en Windows) y ese prefijo hace que Windows deje de tratar
            // '/' como separador, así que concatenar a mano rompe la ruta.
            let file_path = Path::new(&folder)
                .join(&relative_path)
                .to_string_lossy()
                .to_string();
            Ok(DurableItem {
                relative_path,
                file_path,
                file_name: row.get(1)?,
                size_bytes: row.get::<_, i64>(2)? as u64,
                modified_ms: row.get(3)?,
                sha256: row.get(4)?,
                status: row.get(5)?,
                attempts: row.get::<_, i64>(6)? as u32,
                result: row
                    .get::<_, Option<String>>(7)?
                    .and_then(|value| serde_json::from_str(&value).ok()),
                attention_reason: row.get(8)?,
            })
        };
        let data = if let Some(value) = pattern {
            statement.query_map(params![run_id, value, size, offset], &mut map)
        } else {
            statement.query_map(params![run_id, size, offset], &mut map)
        }
        .map_err(store_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(store_error)?;
        Ok(DurablePage {
            data,
            page: page.max(1),
            page_size: size as usize,
            total: total as usize,
        })
    }

    pub(crate) fn enqueue_result(
        &self,
        run_id: &str,
        item: &DurableItem,
        payload: &Value,
    ) -> Result<(), AppError> {
        let mut connection = self.open()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let serialized = serde_json::to_string(payload)
            .map_err(|error| AppError::PhotoFolder(error.to_string()))?;
        tx.execute(
            "UPDATE items SET status=?3, attempts=?4, result_json=?5, attention_reason=?6, updated_at=?7 WHERE run_id=?1 AND relative_path=?2",
            params![run_id, item.relative_path, item.status, item.attempts as i64, serialized, item.attention_reason, now_ms()],
        ).map_err(store_error)?;
        tx.execute(
            "INSERT INTO outbox(run_id,relative_path,payload_json,created_at,sent_at) VALUES(?1,?2,?3,?4,NULL)
             ON CONFLICT(run_id,relative_path) DO UPDATE SET payload_json=excluded.payload_json, created_at=excluded.created_at, sent_at=NULL",
            params![run_id, item.relative_path, serde_json::to_string(payload).map_err(|error| AppError::PhotoFolder(error.to_string()))?, now_ms()],
        ).map_err(store_error)?;
        tx.commit().map_err(store_error)
    }

    pub(crate) fn enqueue_outcome(
        &self,
        run_id: &str,
        relative_path: &str,
        status: &str,
        attempts: u32,
        attention_reason: Option<&str>,
        payload: &Value,
    ) -> Result<(), AppError> {
        let item = DurableItem {
            relative_path: relative_path.to_string(),
            file_path: String::new(), // solo sirve para llamar a enqueue_result, que no la lee.
            file_name: String::new(),
            size_bytes: 0,
            modified_ms: 0,
            sha256: String::new(),
            status: status.to_string(),
            attempts,
            result: None,
            attention_reason: attention_reason.map(str::to_string),
        };
        self.enqueue_result(run_id, &item, payload)
    }

    pub(crate) fn unsent_batch(
        &self,
        run_id: &str,
        limit: usize,
    ) -> Result<Vec<(i64, Value)>, AppError> {
        let connection = self.open()?;
        let mut statement = connection.prepare("SELECT id,payload_json FROM outbox WHERE run_id=?1 AND sent_at IS NULL ORDER BY id LIMIT ?2").map_err(store_error)?;
        let result = statement
            .query_map(params![run_id, limit.clamp(1, 100) as i64], |row| {
                let text: String = row.get(1)?;
                Ok((
                    row.get(0)?,
                    serde_json::from_str::<Value>(&text).unwrap_or(Value::Null),
                ))
            })
            .map_err(store_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_error);
        result
    }

    pub(crate) fn mark_sent(&self, ids: &[i64]) -> Result<(), AppError> {
        if ids.is_empty() {
            return Ok(());
        }
        let marks = std::iter::repeat_n("?", ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("UPDATE outbox SET sent_at=?1 WHERE id IN ({marks})");
        let mut values: Vec<rusqlite::types::Value> = vec![now_ms().into()];
        values.extend(ids.iter().copied().map(Into::into));
        self.open()?
            .execute(&sql, rusqlite::params_from_iter(values))
            .map_err(store_error)?;
        Ok(())
    }

    pub(crate) fn mark_sent_by_paths(
        &self,
        run_id: &str,
        paths: &[String],
    ) -> Result<(), AppError> {
        if paths.is_empty() {
            return Ok(());
        }
        let marks = std::iter::repeat_n("?", paths.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql =
            format!("UPDATE outbox SET sent_at=?1 WHERE run_id=?2 AND relative_path IN ({marks})");
        let mut values: Vec<rusqlite::types::Value> =
            vec![now_ms().into(), run_id.to_string().into()];
        values.extend(paths.iter().cloned().map(Into::into));
        self.open()?
            .execute(&sql, rusqlite::params_from_iter(values))
            .map_err(store_error)?;
        Ok(())
    }

    pub(crate) fn validate_folder(&self, run_id: &str, root: &Path) -> Result<usize, AppError> {
        let page = self.page_items(run_id, 1, 100, None)?;
        let mut changed = 0usize;
        // La paginación evita leer toda la cola en memoria; se recorren páginas
        // porque la verificación puede tratar 35k rutas tras elegir la carpeta.
        for number in 1..=page.total.div_ceil(100).max(1) {
            for item in self.page_items(run_id, number, 100, None)?.data {
                if item.status == "done" || item.status == "error" || item.status == "cancelled" {
                    continue;
                }
                let candidate = root.join(&item.relative_path);
                let same = fingerprint(&candidate)
                    .map(|current| {
                        current.size_bytes == item.size_bytes
                            && current.modified_ms == item.modified_ms
                            && current.sha256 == item.sha256
                    })
                    .unwrap_or(false);
                if !same {
                    self.mark_needs_attention(run_id, &item)?;
                    changed += 1;
                }
            }
        }
        Ok(changed)
    }

    fn mark_needs_attention(&self, run_id: &str, item: &DurableItem) -> Result<(), AppError> {
        let reason = "El archivo falta o cambió desde el manifiesto";
        let mut connection = self.open()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let folder: String = tx
            .query_row(
                "SELECT folder FROM runs WHERE run_id = ?1",
                params![run_id],
                |row| row.get(0),
            )
            .map_err(store_error)?;
        let payload = serde_json::json!({
            "fileName": item.file_name,
            "filePath": Path::new(&folder).join(&item.relative_path).to_string_lossy(),
            "relativePath": item.relative_path,
            "fileSizeBytes": item.size_bytes,
            "fileModifiedAt": Value::Null,
            "status": "needs_attention",
            "requiereRevision": true,
            "postProcessApplied": [],
            "rawResponse": Value::Null,
            "errorMessage": reason,
            "attemptCount": item.attempts,
            "durationMs": Value::Null,
        });
        let serialized = serde_json::to_string(&payload)
            .map_err(|error| AppError::PhotoFolder(error.to_string()))?;
        let now = now_ms();
        tx.execute(
            "UPDATE items SET status='needs_attention', attention_reason=?3, result_json=?4, updated_at=?5 WHERE run_id=?1 AND relative_path=?2",
            params![run_id, item.relative_path, reason, serialized, now],
        )
        .map_err(store_error)?;
        tx.execute(
            "INSERT INTO outbox(run_id,relative_path,payload_json,created_at,sent_at) VALUES(?1,?2,?3,?4,NULL)
             ON CONFLICT(run_id,relative_path) DO UPDATE SET payload_json=excluded.payload_json, created_at=excluded.created_at, sent_at=NULL",
            params![run_id, item.relative_path, serde_json::to_string(&payload).map_err(|error| AppError::PhotoFolder(error.to_string()))?, now],
        )
        .map_err(store_error)?;
        tx.commit().map_err(store_error)
    }

    pub(crate) fn prepare_resume(
        &self,
        run_id: &str,
        root: &Path,
    ) -> Result<DurableRunSummary, AppError> {
        let stored: String = self
            .open()?
            .query_row(
                "SELECT folder FROM runs WHERE run_id = ?1",
                params![run_id],
                |row| row.get(0),
            )
            .map_err(store_error)?;
        if Path::new(&stored) != root {
            return Err(AppError::PathNotAllowed);
        }
        self.pause_run(run_id)?;
        self.validate_folder(run_id, root)?;
        let summary = self
            .list_runs()?
            .into_iter()
            .find(|run| run.run_id == run_id)
            .ok_or(AppError::InvalidResponse)?;
        self.mark_status(
            run_id,
            if summary.pending == 0 && summary.processing == 0 {
                "completed"
            } else {
                "running"
            },
        )?;
        self.list_runs()?
            .into_iter()
            .find(|run| run.run_id == run_id)
            .ok_or(AppError::InvalidResponse)
    }
}

/// Usada solo por `claim_next`: el worker reconstruye la ruta absoluta con
/// `run.folder.join(&item.relative_path)`, así que `file_path` no se llena aquí.
fn durable_item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DurableItem> {
    Ok(DurableItem {
        relative_path: row.get(0)?,
        file_path: String::new(),
        file_name: row.get(1)?,
        size_bytes: row.get::<_, i64>(2)? as u64,
        modified_ms: row.get(3)?,
        sha256: row.get(4)?,
        status: row.get(5)?,
        attempts: row.get::<_, i64>(6)? as u32,
        result: row
            .get::<_, Option<String>>(7)?
            .and_then(|value| serde_json::from_str(&value).ok()),
        attention_reason: row.get(8)?,
    })
}

pub(crate) fn fingerprint(path: &Path) -> Result<DurableItem, AppError> {
    let metadata = std::fs::metadata(path).map_err(store_error)?;
    let modified_ms = metadata
        .modified()
        .map_err(store_error)?
        .duration_since(UNIX_EPOCH)
        .map_err(store_error)?
        .as_millis() as i64;
    let mut file = File::open(path).map_err(store_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(store_error)?;
        if read == 0 {
            break;
        }
        digest.update(buffer.get(..read).unwrap_or_default());
    }
    Ok(DurableItem {
        relative_path: String::new(),
        file_path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        size_bytes: metadata.len(),
        modified_ms,
        sha256: format!("{:x}", digest.finalize()),
        status: "pending".to_string(),
        attempts: 0,
        result: None,
        attention_reason: None,
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}
fn store_error(error: impl std::fmt::Display) -> AppError {
    AppError::PhotoFolder(format!("No se pudo actualizar la cola local: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbox_is_idempotent_and_survives_reopen() {
        let path = std::env::temp_dir().join(format!("meter-queue-{}.sqlite3", now_ms()));
        let store = MeterQueueStore::new_at(path.clone()).unwrap();
        let item = DurableItem {
            relative_path: "a.jpg".into(),
            file_path: "C:/fotos/a.jpg".into(),
            file_name: "a.jpg".into(),
            size_bytes: 1,
            modified_ms: 1,
            sha256: "a".repeat(64),
            status: "done".into(),
            attempts: 1,
            result: None,
            attention_reason: None,
        };
        store
            .create_run("run", Path::new("C:/fotos"), false, &[item.clone()])
            .unwrap();
        store
            .enqueue_result(
                "run",
                &item,
                &serde_json::json!({"filePath":"C:/fotos/a.jpg"}),
            )
            .unwrap();
        store
            .enqueue_result(
                "run",
                &item,
                &serde_json::json!({"filePath":"C:/fotos/a.jpg","attemptCount":2}),
            )
            .unwrap();
        drop(store);
        let reopened = MeterQueueStore::new_at(path.clone()).unwrap();
        assert_eq!(reopened.unsent_batch("run", 100).unwrap().len(), 1);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn changed_or_missing_files_require_attention_before_resume() {
        let root = std::env::temp_dir().join(format!("meter-queue-files-{}", now_ms()));
        std::fs::create_dir_all(&root).unwrap();
        let photo = root.join("a.jpg");
        std::fs::write(&photo, b"original").unwrap();
        let db = root.join("queue.sqlite3");
        let store = MeterQueueStore::new_at(db).unwrap();
        let mut item = fingerprint(&photo).unwrap();
        item.relative_path = "a.jpg".to_string();
        store.create_run("run", &root, false, &[item]).unwrap();
        std::fs::write(&photo, b"modificado").unwrap();
        assert_eq!(store.validate_folder("run", &root).unwrap(), 1);
        assert_eq!(
            store.page_items("run", 1, 100, None).unwrap().data[0].status,
            "needs_attention"
        );
        assert_eq!(store.unsent_batch("run", 100).unwrap().len(), 1);
        assert!(store.needs_attention("run", "a.jpg").unwrap());
        assert_eq!(store.prepare_resume("run", &root).unwrap().pending, 0);
        assert_eq!(store.list_runs().unwrap()[0].status, "completed");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn page_items_file_path_resolves_to_a_real_file_in_a_subfolder() {
        // Regresión: la raíz que llega aquí ya viene canonicalizada por
        // `ensure_allowed` (`\\?\` en Windows), y ese prefijo desactiva la
        // traducción normal de '/' a '\'. Un join manual con template string
        // en el frontend (`${folder}/${relativePath}`) producía una ruta que
        // Windows no resolvía, aunque la carpeta sí estuviera permitida.
        let root = std::env::temp_dir().join(format!("meter-queue-nested-{}", now_ms()));
        let sub = root.join("Varios");
        std::fs::create_dir_all(&sub).unwrap();
        let photo = sub.join("2020222_1.jpg");
        std::fs::write(&photo, b"foto").unwrap();
        let canonical_root = std::fs::canonicalize(&root).unwrap();
        let db = root.join("queue.sqlite3");
        let store = MeterQueueStore::new_at(db).unwrap();
        let mut item = fingerprint(&photo).unwrap();
        item.relative_path = "Varios/2020222_1.jpg".to_string();
        store
            .create_run("run", &canonical_root, false, &[item])
            .unwrap();
        let page = store.page_items("run", 1, 100, None).unwrap();
        let file_path = &page.data[0].file_path;
        assert!(
            std::path::Path::new(file_path).is_file(),
            "file_path '{file_path}' debe apuntar a un archivo real"
        );
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn paginates_a_manifest_of_35k_without_returning_all_rows() {
        let path = std::env::temp_dir().join(format!("meter-queue-scale-{}.sqlite3", now_ms()));
        let store = MeterQueueStore::new_at(path.clone()).unwrap();
        let items = (0..35_000)
            .map(|index| DurableItem {
                relative_path: format!("sector/{index:05}.jpg"),
                file_path: format!("C:/fotos/sector/{index:05}.jpg"),
                file_name: format!("{index:05}.jpg"),
                size_bytes: 1,
                modified_ms: 1,
                sha256: "b".repeat(64),
                status: "pending".into(),
                attempts: 0,
                result: None,
                attention_reason: None,
            })
            .collect::<Vec<_>>();
        store
            .create_run("scale", Path::new("C:/fotos"), false, &items)
            .unwrap();
        let page = store.page_items("scale", 1, 100, None).unwrap();
        assert_eq!(page.total, 35_000);
        assert_eq!(page.data.len(), 100);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn workers_claim_one_item_transactionally_and_pause_returns_it_to_pending() {
        let path = std::env::temp_dir().join(format!("meter-queue-claim-{}.sqlite3", now_ms()));
        let store = MeterQueueStore::new_at(path.clone()).unwrap();
        let item = DurableItem {
            relative_path: "a.jpg".into(),
            file_path: "C:/fotos/a.jpg".into(),
            file_name: "a.jpg".into(),
            size_bytes: 1,
            modified_ms: 1,
            sha256: "c".repeat(64),
            status: "pending".into(),
            attempts: 0,
            result: None,
            attention_reason: None,
        };
        store
            .create_run("claim", Path::new("C:/fotos"), false, &[item])
            .unwrap();
        store.mark_status("claim", "running").unwrap();
        let claimed = store.claim_next("claim").unwrap().unwrap();
        assert_eq!(claimed.status, "processing");
        assert_eq!(claimed.attempts, 1);
        assert!(store.claim_next("claim").unwrap().is_none());
        store.pause_run("claim").unwrap();
        assert_eq!(store.list_runs().unwrap()[0].pending, 1);
        store.cancel_run("claim").unwrap();
        assert_eq!(
            store.page_items("claim", 1, 100, None).unwrap().data[0].status,
            "cancelled"
        );
        std::fs::remove_file(path).ok();
    }
}
