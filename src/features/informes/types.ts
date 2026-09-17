export type ItcRecordStatus = "uploaded" | "queued" | "ready" | "completed"

export type ItcFolder = {
  id: number
  code: string
  label: string
  assetCount: number
}

export type ItcRecord = {
  id: number
  row_number: number
  status: ItcRecordStatus
  job_status?: "queued" | "processing" | "completed" | "failed" | null
  job_error_message?: string | null
  source_data: Record<string, unknown>
  created_at: string
  original_file_name: string
  folders: ItcFolder[]
  assigned_to_user_id: number | null
  assigned_to_username: string | null
  assigned_to_full_name: string | null
}

export type ItcAssignableUser = {
  id: number
  username: string
  full_name: string
}

export type ItcRecordsPage = {
  data: ItcRecord[]
  page: number
  page_size: number
  total: number
}

export type ItcAsset = {
  id: number
  original_file_name: string
  content_type: string
  byte_size: number
  created_at: string
}

export type ItcAssetData = {
  mimeType: string
  base64: string
}

export type ItcImportResult = {
  importId: number
  fileName: string
  importedAt: string
  importedRecords: number
}
