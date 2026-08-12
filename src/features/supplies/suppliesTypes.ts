export type ClientMaster = {
  id: string
  name: string
  document: string
  address: string
  district: string
  status: "activo" | "inactivo"
  supplies: SupplyItem[]
}

export type SupplyItem = {
  id: string
  code: string
  clientId: string
  clientName: string
  address: string
  district: string
  status: "activo" | "suspendido" | "cortado"
  lat: number
  lng: number
  meterCode: string
  meterDiameter: string
  meterStatus: "instalado" | "retirado" | "en_almacen" | "mantenimiento"
  installationDate: string
}

export type MeterItem = {
  id: string
  code: string
  diameter: string
  status: "instalado" | "retirado" | "en_almacen" | "mantenimiento"
  installationDate: string
  supplyCode: string | null
  clientName: string | null
}

export type SupplyFilter = {
  search: string
  district: string
  status: string
  page: number
  pageSize: number
}

export type MeterFilter = {
  search: string
  status: string
  page: number
  pageSize: number
}

export type SupplyFormData = {
  code: string
  clientId: string
  clientName?: string
  address: string
  district: string
  status: "activo" | "suspendido" | "cortado"
  lat: number
  lng: number
  meterCode: string
  meterDiameter: string
  meterStatus: "instalado" | "retirado" | "en_almacen" | "mantenimiento"
  installationDate: string
}

export type LocationFormData = {
  supplyCode: string
  address: string
  district: string
  lat: number
  lng: number
}

export type MeterFormData = {
  code: string
  diameter: string
  status: "instalado" | "retirado" | "en_almacen" | "mantenimiento"
  installationDate: string
  supplyCode: string
}
