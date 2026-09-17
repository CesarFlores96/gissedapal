import { invoke } from "@tauri-apps/api/core"

export type SignatureStatus = {
  hasSignature: boolean
  updatedAt: string | null
  dataUrl?: string
}

export function getMySignature(includeContent: boolean): Promise<SignatureStatus> {
  return invoke("get_my_signature", { includeContent })
}

export function pickAndUploadMySignature(): Promise<boolean> {
  return invoke("pick_and_upload_my_signature")
}

export function deleteMySignature(): Promise<void> {
  return invoke("delete_my_signature")
}
