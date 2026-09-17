import { invoke } from "@tauri-apps/api/core"

import type { ItcAsset, ItcAssetData, ItcAssignableUser, ItcImportResult, ItcRecordsPage } from "./types"

export function getItcRecords(input: { page: number; pageSize: number; search?: string }): Promise<ItcRecordsPage> {
  return invoke("list_itc_records", input)
}

export function createItcReport(recordId: number): Promise<{ id: number; status: string; reused: boolean }> {
  return invoke("create_itc_report", { recordId })
}

export function pickAndImportItcExcel(): Promise<ItcImportResult | null> {
  return invoke("pick_and_import_itc_excel")
}

export function listItcFolderAssets(recordId: number, folderId: number): Promise<{ data: ItcAsset[] }> {
  return invoke("list_itc_folder_assets", { recordId, folderId })
}

export function getItcAssetData(recordId: number, assetId: number): Promise<ItcAssetData> {
  return invoke("get_itc_asset_data", { recordId, assetId })
}

export function deleteItcAsset(recordId: number, assetId: number): Promise<void> {
  return invoke("delete_itc_asset", { recordId, assetId })
}

export function pickAndUploadItcAsset(recordId: number, folderId: number): Promise<{ asset: ItcAsset } | null> {
  return invoke("pick_and_upload_itc_asset", { recordId, folderId })
}

export function exportItcRecordZip(recordId: number, suggestedName: string): Promise<string | null> {
  return invoke("export_itc_record_zip", { recordId, suggestedName })
}

export function exportItcReportDocx(recordId: number, suggestedName: string): Promise<string | null> {
  return invoke("export_itc_report_docx", { recordId, suggestedName })
}

export function listItcAssignableUsers(): Promise<{ data: ItcAssignableUser[] }> {
  return invoke("list_itc_assignable_users")
}

export function assignItcRecord(recordId: number, userId: number | null): Promise<{ assignedToUserId: number | null; assignedToUsername: string | null; assignedToFullName: string | null }> {
  return invoke("assign_itc_record", { recordId, userId })
}
