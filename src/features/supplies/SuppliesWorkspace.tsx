import {
  ChevronDown,
  ChevronRight,
  Edit2,
  Filter,
  Gauge,
  Layers,
  MapPin,
  Plus,
  Search,
} from "lucide-react"
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import React, { useMemo, useState } from "react"

import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ShadcnBadge } from "@/components/ui/shadcn-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import {
  addMeterToStore,
  addSupplyToStore,
  getAllMeters,
  getClientsStore,
  loadClientsFromBackend,
  updateSupplyInStore,
  updateSupplyLocationInStore,
} from "./suppliesData"
import type { LocationFormData, MeterFormData, MeterItem, SupplyFormData, SupplyItem } from "./suppliesTypes"

const DISTRICT_OPTIONS = [
  "Todos",
  "LIMA",
  "ATE",
  "BREÑA",
  "CALLAO",
  "CARABAYLLO",
  "CHACLACAYO",
  "CHORRILLOS",
  "CIENEGUILLA",
  "COMAS",
  "EL AGUSTINO",
  "INDEPENDENCIA",
  "JESUS MARIA",
  "LA MOLINA",
  "LA VICTORIA",
  "LINCE",
  "LOS OLIVOS",
  "LURIGANCHO-CHOSICA",
  "LURIN",
  "MAGDALENA DEL MAR",
  "MIRAFLORES",
  "PACHACAMAC",
  "PUCOUSANA",
  "PUEBLO LIBRE",
  "PUENTE PIEDRA",
  "PUNTA HERMOSA",
  "RIMAC",
  "SAN BARTOLO",
  "SAN BORJA",
  "SAN ISIDRO",
  "SAN JUAN DE LURIGANCHO",
  "SAN JUAN DE MIRAFLORES",
  "SAN LUIS",
  "SAN MARTIN DE PORRES",
  "SAN MIGUEL",
  "SANTA ANITA",
  "SANTIAGO DE SURCO",
  "SURQUILLO",
  "VENTANILLA",
  "VILLA EL SALVADOR",
  "VILLA MARIA DEL TRIUNFO",
]

function getStatusBadge(status: string): React.JSX.Element {
  switch (status.toLowerCase()) {
    case "activo":
    case "instalado":
      return <ShadcnBadge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium">Activo</ShadcnBadge>
    case "suspendido":
    case "mantenimiento":
      return <ShadcnBadge variant="secondary" className="bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">Suspendido</ShadcnBadge>
    case "cortado":
    case "retirado":
      return <ShadcnBadge variant="destructive" className="font-medium">Cortado</ShadcnBadge>
    default:
      return <ShadcnBadge variant="outline" className="font-medium">{status}</ShadcnBadge>
  }
}

export function SuppliesWorkspace(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"suministros" | "medidores">("suministros")

  // Force re-render state increment
  const [storeVersion, setStoreVersion] = useState(0)
  const refreshStore = () => setStoreVersion((v) => v + 1)

  React.useEffect(() => {
    let active = true
    void loadClientsFromBackend().then(() => {
      if (active) refreshStore()
    })
    return () => {
      active = false
    }
  }, [])

  // Suministros tab states
  const [search, setSearch] = useState("")
  const [districtFilter, setDistrictFilter] = useState("Todos")
  const [statusFilter, setStatusFilter] = useState("Todos")
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({})
  const [suppliesPage, setSuppliesPage] = useState(1)
  const [suppliesPageSize, setSuppliesPageSize] = useState(10)

  // Medidores tab states
  const [meterSearch, setMeterSearch] = useState("")
  const [meterStatusFilter, setMeterStatusFilter] = useState("Todos")
  const [metersPage, setMetersPage] = useState(1)
  const [metersPageSize, setMetersPageSize] = useState(10)

  // Modals state
  const [editSupply, setEditSupply] = useState<SupplyItem | null>(null)
  const [locationSupply, setLocationSupply] = useState<SupplyItem | null>(null)
  const [isAddSupplyOpen, setIsAddSupplyOpen] = useState(false)
  const [isAddMeterOpen, setIsAddMeterOpen] = useState(false)
  const [editMeter, setEditMeter] = useState<MeterItem | null>(null)

  // Store data getters
  const clientsData = useMemo(() => getClientsStore(), [storeVersion])
  const metersData = useMemo(() => getAllMeters(), [storeVersion])

  // Filtering for Supplies Master
  const filteredClients = useMemo(() => {
    return clientsData.filter((client) => {
      const matchSearch =
        search === "" ||
        client.name.toLowerCase().includes(search.toLowerCase()) ||
        client.document.toLowerCase().includes(search.toLowerCase()) ||
        client.supplies.some(
          (s) =>
            s.code.toLowerCase().includes(search.toLowerCase()) ||
            s.address.toLowerCase().includes(search.toLowerCase()),
        )

      const matchDistrict = districtFilter === "Todos" || client.district === districtFilter

      const matchStatus =
        statusFilter === "Todos" ||
        client.supplies.some((s) => s.status.toLowerCase() === statusFilter.toLowerCase())

      return matchSearch && matchDistrict && matchStatus
    })
  }, [clientsData, search, districtFilter, statusFilter])

  // Pagination for Supplies
  const totalSuppliesPages = Math.max(1, Math.ceil(filteredClients.length / suppliesPageSize))
  const paginatedClients = useMemo(() => {
    const start = (suppliesPage - 1) * suppliesPageSize
    return filteredClients.slice(start, start + suppliesPageSize)
  }, [filteredClients, suppliesPage, suppliesPageSize])

  // Filtering for Meters
  const filteredMeters = useMemo(() => {
    return metersData.filter((meter) => {
      const matchSearch =
        meterSearch === "" ||
        meter.code.toLowerCase().includes(meterSearch.toLowerCase()) ||
        (meter.supplyCode !== null && meter.supplyCode.toLowerCase().includes(meterSearch.toLowerCase())) ||
        (meter.clientName !== null && meter.clientName.toLowerCase().includes(meterSearch.toLowerCase()))

      const matchStatus =
        meterStatusFilter === "Todos" || meter.status.toLowerCase() === meterStatusFilter.toLowerCase()

      return matchSearch && matchStatus
    })
  }, [metersData, meterSearch, meterStatusFilter])

  // Pagination for Meters
  const totalMetersPages = Math.max(1, Math.ceil(filteredMeters.length / metersPageSize))
  const paginatedMeters = useMemo(() => {
    const start = (metersPage - 1) * metersPageSize
    return filteredMeters.slice(start, start + metersPageSize)
  }, [filteredMeters, metersPage, metersPageSize])

  const toggleExpandClient = (clientId: string) => {
    setExpandedClients((prev) => ({ ...prev, [clientId]: !prev[clientId] }))
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-y-auto">
      <div className="p-6 space-y-4 w-full">
        <Tabs value={activeTab} onValueChange={(val) => val && setActiveTab(val as "suministros" | "medidores")}>
          <div className="flex items-center justify-between border-b pb-3 mb-4">
            <TabsList className="grid w-80 grid-cols-2">
              <TabsTrigger value="suministros" className="flex items-center gap-2">
                <Layers className="size-4" />
                <span>Suministros</span>
              </TabsTrigger>
              <TabsTrigger value="medidores" className="flex items-center gap-2">
                <Gauge className="size-4" />
                <span>Medidores</span>
              </TabsTrigger>
            </TabsList>
            <div className="text-xs text-muted-foreground">
              Módulo de Administración de Suministros y Medidores
            </div>
          </div>

          {/* TAB 1: SUMINISTROS (MAESTRO DETALLE) */}
          <TabsContent value="suministros" className="space-y-4">
            {/* Filter and Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-3 rounded-lg border shadow-sm">
              <div className="flex flex-1 flex-wrap items-center gap-3 min-w-[280px]">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar cliente, RUC/DNI, suministro..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value)
                      setSuppliesPage(1)
                    }}
                    className="pl-9 h-9 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="size-3.5 text-muted-foreground" />
                  <Select
                    value={districtFilter}
                    onValueChange={(v) => {
                      if (v) {
                        setDistrictFilter(v)
                        setSuppliesPage(1)
                      }
                    }}
                  >
                    <SelectTrigger className="w-[160px] h-9 text-xs">
                      <SelectValue placeholder="Distrito" />
                    </SelectTrigger>
                    <SelectContent>
                      {DISTRICT_OPTIONS.map((d) => (
                        <SelectItem key={d} value={d} className="text-xs">
                          {d === "Todos" ? "Todos los distritos" : d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={statusFilter}
                    onValueChange={(v) => {
                      if (v) {
                        setStatusFilter(v)
                        setSuppliesPage(1)
                      }
                    }}
                  >
                    <SelectTrigger className="w-[140px] h-9 text-xs">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Todos" className="text-xs">
                        Todos los estados
                      </SelectItem>
                      <SelectItem value="activo" className="text-xs">
                        Activo
                      </SelectItem>
                      <SelectItem value="suspendido" className="text-xs">
                        Suspendido
                      </SelectItem>
                      <SelectItem value="cortado" className="text-xs">
                        Cortado
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={() => setIsAddSupplyOpen(true)}
                size="sm"
                className="h-9 px-3 text-xs gap-1.5"
              >
                <Plus className="size-4" />
                <span>Agregar Suministro</span>
              </Button>
            </div>

            {/* Master-Detail Table */}
            <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-10 text-center"></TableHead>
                    <TableHead className="font-semibold text-xs">Cliente / Razón Social</TableHead>
                    <TableHead className="font-semibold text-xs">Documento</TableHead>
                    <TableHead className="font-semibold text-xs">Distrito / Dirección</TableHead>
                    <TableHead className="font-semibold text-xs text-center">Suministros</TableHead>
                    <TableHead className="font-semibold text-xs text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedClients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-xs">
                        No se encontraron clientes o suministros que coincidan con la búsqueda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedClients.map((client) => {
                      const isExpanded = !!expandedClients[client.id]
                      return (
                        <React.Fragment key={client.id}>
                          {/* Master Row */}
                          <TableRow className="hover:bg-muted/40 transition-colors">
                            <TableCell className="text-center p-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => toggleExpandClient(client.id)}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="size-4 text-primary" />
                                ) : (
                                  <ChevronRight className="size-4 text-muted-foreground" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="font-medium text-xs py-3">
                              {client.name}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">
                              {client.document}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{client.district}</span> - {client.address}
                            </TableCell>
                            <TableCell className="text-center">
                              <ShadcnBadge variant="outline" className="font-mono text-xs px-2 py-0.5">
                                {client.supplies.length}
                              </ShadcnBadge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs px-2 gap-1"
                                onClick={() => {
                                  setIsAddSupplyOpen(true)
                                }}
                              >
                                <Plus className="size-3" />
                                <span>Añadir Suministro</span>
                              </Button>
                            </TableCell>
                          </TableRow>

                          {/* Detail Sub-Table (Expanded) */}
                          {isExpanded && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20 border-b">
                              <TableCell colSpan={6} className="p-3 pl-12">
                                <div className="rounded-md border bg-card p-3 shadow-inner">
                                  <div className="text-xs font-semibold mb-2 flex items-center gap-2 text-muted-foreground">
                                    <Layers className="size-3.5 text-primary" />
                                    <span>Detalle de Suministros de {client.name}</span>
                                  </div>
                                  <Table>
                                    <TableHeader className="bg-muted/60">
                                      <TableRow>
                                        <TableHead className="text-[11px] font-semibold">Cód. Suministro</TableHead>
                                        <TableHead className="text-[11px] font-semibold">Medidor / Diámetro</TableHead>
                                        <TableHead className="text-[11px] font-semibold">Dirección de Servicio</TableHead>
                                        <TableHead className="text-[11px] font-semibold">Estado</TableHead>
                                        <TableHead className="text-[11px] font-semibold">Ubicación (Lat, Lng)</TableHead>
                                        <TableHead className="text-[11px] font-semibold text-right">Acciones</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {client.supplies.map((supply) => (
                                        <TableRow key={supply.id} className="hover:bg-muted/30">
                                          <TableCell className="font-mono text-xs font-semibold py-2">
                                            {supply.code}
                                          </TableCell>
                                          <TableCell className="text-xs">
                                            <span className="font-mono">{supply.meterCode}</span>
                                            <span className="text-muted-foreground text-[11px] ml-1.5">
                                              ({supply.meterDiameter} mm)
                                            </span>
                                          </TableCell>
                                          <TableCell className="text-xs text-muted-foreground">
                                            {supply.address}
                                          </TableCell>
                                          <TableCell>{getStatusBadge(supply.status)}</TableCell>
                                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                                            {supply.lat.toFixed(4)}, {supply.lng.toFixed(4)}
                                          </TableCell>
                                          <TableCell className="text-right py-2">
                                            <div className="flex items-center justify-end gap-1.5">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-[11px] px-2 gap-1"
                                                onClick={() => setEditSupply(supply)}
                                              >
                                                <Edit2 className="size-3" />
                                                <span>Editar</span>
                                              </Button>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-[11px] px-2 gap-1 text-primary border-primary/30 hover:bg-primary/10"
                                                onClick={() => setLocationSupply(supply)}
                                              >
                                                <MapPin className="size-3" />
                                                <span>Ubicación</span>
                                              </Button>
                                            </div>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground pt-2">
              <div className="flex items-center gap-3">
                <span>
                  Página {suppliesPage} de {totalSuppliesPages} · Mostrando {paginatedClients.length} de {filteredClients.length} clientes
                </span>
                <div className="flex items-center gap-1.5 border-l pl-3">
                  <span>Mostrar:</span>
                  <Select
                    value={suppliesPageSize.toString()}
                    onValueChange={(v) => {
                      if (v) {
                        setSuppliesPageSize(parseInt(v, 10))
                        setSuppliesPage(1)
                      }
                    }}
                  >
                    <SelectTrigger className="w-[75px] h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10" className="text-xs">10</SelectItem>
                      <SelectItem value="25" className="text-xs">25</SelectItem>
                      <SelectItem value="50" className="text-xs">50</SelectItem>
                      <SelectItem value="100" className="text-xs">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={suppliesPage <= 1}
                  onClick={() => setSuppliesPage((p) => p - 1)}
                  className="h-8 text-xs px-3"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={suppliesPage >= totalSuppliesPages}
                  onClick={() => setSuppliesPage((p) => p + 1)}
                  className="h-8 text-xs px-3"
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: MEDIDORES */}
          <TabsContent value="medidores" className="space-y-4">
            {/* Filter and Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-3 rounded-lg border shadow-sm">
              <div className="flex flex-1 flex-wrap items-center gap-3 min-w-[280px]">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar serie de medidor, suministro o cliente..."
                    value={meterSearch}
                    onChange={(e) => {
                      setMeterSearch(e.target.value)
                      setMetersPage(1)
                    }}
                    className="pl-9 h-9 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="size-3.5 text-muted-foreground" />
                  <Select
                    value={meterStatusFilter}
                    onValueChange={(v) => {
                      if (v) {
                        setMeterStatusFilter(v)
                        setMetersPage(1)
                      }
                    }}
                  >
                    <SelectTrigger className="w-[160px] h-9 text-xs">
                      <SelectValue placeholder="Estado medidor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Todos" className="text-xs">
                        Todos los estados
                      </SelectItem>
                      <SelectItem value="instalado" className="text-xs">
                        Instalado
                      </SelectItem>
                      <SelectItem value="retirado" className="text-xs">
                        Retirado
                      </SelectItem>
                      <SelectItem value="en_almacen" className="text-xs">
                        En Almacén
                      </SelectItem>
                      <SelectItem value="mantenimiento" className="text-xs">
                        Mantenimiento
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={() => setIsAddMeterOpen(true)}
                size="sm"
                className="h-9 px-3 text-xs gap-1.5"
              >
                <Plus className="size-4" />
                <span>Agregar Medidor</span>
              </Button>
            </div>

            {/* Meters Table */}
            <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-semibold text-xs">Serie / Código Medidor</TableHead>
                    <TableHead className="font-semibold text-xs">Diámetro</TableHead>
                    <TableHead className="font-semibold text-xs">Estado</TableHead>
                    <TableHead className="font-semibold text-xs">Fecha Instalación</TableHead>
                    <TableHead className="font-semibold text-xs">Suministro Asociado</TableHead>
                    <TableHead className="font-semibold text-xs">Cliente</TableHead>
                    <TableHead className="font-semibold text-xs text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedMeters.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-xs">
                        No se encontraron medidores registrados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedMeters.map((meter) => (
                      <TableRow key={meter.id} className="hover:bg-muted/40 transition-colors">
                        <TableCell className="font-mono font-semibold text-xs py-3">
                          {meter.code}
                        </TableCell>
                        <TableCell className="text-xs">
                          {meter.diameter} mm
                        </TableCell>
                        <TableCell>{getStatusBadge(meter.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {meter.installationDate}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-primary">
                          {meter.supplyCode ?? "Sin asignar"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {meter.clientName ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2 gap-1"
                            onClick={() => setEditMeter(meter)}
                          >
                            <Edit2 className="size-3" />
                            <span>Editar</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground pt-2">
              <div className="flex items-center gap-3">
                <span>
                  Página {metersPage} de {totalMetersPages} · Mostrando {paginatedMeters.length} de {filteredMeters.length} medidores
                </span>
                <div className="flex items-center gap-1.5 border-l pl-3">
                  <span>Mostrar:</span>
                  <Select
                    value={metersPageSize.toString()}
                    onValueChange={(v) => {
                      if (v) {
                        setMetersPageSize(parseInt(v, 10))
                        setMetersPage(1)
                      }
                    }}
                  >
                    <SelectTrigger className="w-[75px] h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10" className="text-xs">10</SelectItem>
                      <SelectItem value="25" className="text-xs">25</SelectItem>
                      <SelectItem value="50" className="text-xs">50</SelectItem>
                      <SelectItem value="100" className="text-xs">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={metersPage <= 1}
                  onClick={() => setMetersPage((p) => p - 1)}
                  className="h-8 text-xs px-3"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={metersPage >= totalMetersPages}
                  onClick={() => setMetersPage((p) => p + 1)}
                  className="h-8 text-xs px-3"
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* MODAL: EDITAR SUMINISTRO */}
      {editSupply && (
        <EditSupplyModal
          supply={editSupply}
          onClose={() => setEditSupply(null)}
          onSave={(data) => {
            updateSupplyInStore(data)
            refreshStore()
            setEditSupply(null)
          }}
        />
      )}

      {/* MODAL: CAMBIAR UBICACIÓN */}
      {locationSupply && (
        <ChangeLocationModal
          supply={locationSupply}
          onClose={() => setLocationSupply(null)}
          onSave={(data) => {
            updateSupplyLocationInStore(data)
            refreshStore()
            setLocationSupply(null)
          }}
        />
      )}

      {/* MODAL: AGREGAR SUMINISTRO */}
      {isAddSupplyOpen && (
        <AddSupplyModal
          onClose={() => setIsAddSupplyOpen(false)}
          onSave={(data) => {
            addSupplyToStore(data)
            refreshStore()
            setIsAddSupplyOpen(false)
          }}
        />
      )}

      {/* MODAL: AGREGAR / EDITAR MEDIDOR */}
      {(isAddMeterOpen || editMeter) && (
        <MeterModal
          meter={editMeter}
          onClose={() => {
            setIsAddMeterOpen(false)
            setEditMeter(null)
          }}
          onSave={(data) => {
            addMeterToStore(data)
            refreshStore()
            setIsAddMeterOpen(false)
            setEditMeter(null)
          }}
        />
      )}
    </div>
  )
}

// ------------------- MODAL COMPONENTS -------------------

function EditSupplyModal({
  supply,
  onClose,
  onSave,
}: {
  supply: SupplyItem
  onClose: () => void
  onSave: (data: SupplyFormData) => void
}): React.JSX.Element {
  const [formData, setFormData] = useState<SupplyFormData>({
    code: supply.code,
    clientId: supply.clientId,
    clientName: supply.clientName,
    address: supply.address,
    district: supply.district,
    status: supply.status,
    lat: supply.lat,
    lng: supply.lng,
    meterCode: supply.meterCode,
    meterDiameter: supply.meterDiameter,
    meterStatus: supply.meterStatus,
    installationDate: supply.installationDate,
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Editar Suministro {supply.code}</DialogTitle>
          <DialogDescription className="text-xs">
            Modifique los datos principales del suministro y su medidor.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 text-xs">
          <div className="grid gap-1">
            <Label className="text-xs font-medium">Cliente</Label>
            <Input value={formData.clientName} disabled className="h-8 text-xs bg-muted" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Distrito</Label>
              <Input
                value={formData.district}
                onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Estado</Label>
              <Select
                value={formData.status}
                onValueChange={(v) =>
                  v && setFormData({ ...formData, status: v as "activo" | "suspendido" | "cortado" })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activo" className="text-xs">Activo</SelectItem>
                  <SelectItem value="suspendido" className="text-xs">Suspendido</SelectItem>
                  <SelectItem value="cortado" className="text-xs">Cortado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs font-medium">Dirección de Servicio</Label>
            <Input
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="h-8 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Serie de Medidor</Label>
              <Input
                value={formData.meterCode}
                onChange={(e) => setFormData({ ...formData, meterCode: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Diámetro (mm)</Label>
              <Input
                value={formData.meterDiameter}
                onChange={(e) => setFormData({ ...formData, meterDiameter: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSave(formData)} className="h-8 text-xs">
            Guardar Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChangeLocationModal({
  supply,
  onClose,
  onSave,
}: {
  supply: SupplyItem
  onClose: () => void
  onSave: (data: LocationFormData) => void
}): React.JSX.Element {
  const [formData, setFormData] = useState<LocationFormData>({
    supplyCode: supply.code,
    address: supply.address,
    district: supply.district,
    lat: supply.lat,
    lng: supply.lng,
  })

  const mapContainerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const markerRef = React.useRef<maplibregl.Marker | null>(null)

  React.useEffect(() => {
    let animId: number
    let timerId: ReturnType<typeof setTimeout>
    let map: MapLibreMap | null = null
    let marker: maplibregl.Marker | null = null
    let resizeObserver: ResizeObserver | null = null
    let timers: ReturnType<typeof setTimeout>[] = []

    const initMap = () => {
      const containerEl = mapContainerRef.current
      if (!containerEl) return

      const initialLat = formData.lat !== 0 ? formData.lat : -12.04637
      const initialLng = formData.lng !== 0 ? formData.lng : -77.04279

      try {
        map = new maplibregl.Map({
          container: containerEl,
          attributionControl: false,
          style: {
            version: 8,
            sources: {
              "osm-tiles": {
                type: "raster",
                tiles: [
                  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
                  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
                  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
                ],
                tileSize: 256,
                attribution:
                  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
              },
            },
            layers: [
              {
                id: "background",
                type: "background",
                paint: { "background-color": "#e2e8f0" },
              },
              {
                id: "osm-tiles-layer",
                type: "raster",
                source: "osm-tiles",
                minzoom: 0,
                maxzoom: 19,
              },
            ],
          },
          center: [initialLng, initialLat],
          zoom: 15,
          trackResize: true,
        })

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")

        marker = new maplibregl.Marker({ draggable: true, color: "#e11d48" })
          .setLngLat([initialLng, initialLat])
          .addTo(map)

        const updateCoords = (lng: number, lat: number) => {
          setFormData((prev) => ({
            ...prev,
            lat: parseFloat(lat.toFixed(5)),
            lng: parseFloat(lng.toFixed(5)),
          }))
        }

        map.on("click", (e) => {
          const { lng, lat } = e.lngLat
          if (marker) marker.setLngLat([lng, lat])
          updateCoords(lng, lat)
        })

        marker.on("dragend", () => {
          if (marker) {
            const lngLat = marker.getLngLat()
            updateCoords(lngLat.lng, lngLat.lat)
          }
        })

        mapRef.current = map
        markerRef.current = marker

        const triggerResize = () => {
          if (map) {
            map.resize()
          }
        }

        map.on("load", triggerResize)

        resizeObserver = new ResizeObserver(() => {
          triggerResize()
        })
        resizeObserver.observe(containerEl)

        timers = [
          setTimeout(triggerResize, 50),
          setTimeout(triggerResize, 150),
          setTimeout(triggerResize, 350),
          setTimeout(triggerResize, 700),
          setTimeout(triggerResize, 1200),
        ]
      } catch (err) {
        console.error("Failed to initialize MapLibre map:", err)
      }
    }

    animId = requestAnimationFrame(() => {
      timerId = setTimeout(initMap, 60)
    })

    return () => {
      cancelAnimationFrame(animId)
      clearTimeout(timerId)
      timers.forEach(clearTimeout)
      if (resizeObserver) resizeObserver.disconnect()
      if (marker) marker.remove()
      if (map) map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [])

  const handleLatChange = (val: string) => {
    const lat = parseFloat(val) || 0
    setFormData((prev) => {
      const updated = { ...prev, lat }
      if (markerRef.current && mapRef.current && !isNaN(lat) && lat !== 0) {
        markerRef.current.setLngLat([updated.lng, lat])
        mapRef.current.panTo([updated.lng, lat])
      }
      return updated
    })
  }

  const handleLngChange = (val: string) => {
    const lng = parseFloat(val) || 0
    setFormData((prev) => {
      const updated = { ...prev, lng }
      if (markerRef.current && mapRef.current && !isNaN(lng) && lng !== 0) {
        markerRef.current.setLngLat([lng, updated.lat])
        mapRef.current.panTo([lng, updated.lat])
      }
      return updated
    })
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="size-4 text-primary" />
            <span>Cambiar Ubicación del Suministro {supply.code}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Ajuste las coordenadas geográficas mediante los campos o haciendo clic / arrastrando el marcador en el mapa.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2 text-xs">
          <div className="flex flex-col gap-3 justify-between">
            <div className="space-y-3">
              <div className="grid gap-1">
                <Label className="text-xs font-medium">Dirección</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs font-medium">Latitud (WGS84)</Label>
                  <Input
                    type="number"
                    step="0.00001"
                    value={formData.lat}
                    onChange={(e) => handleLatChange(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs font-medium">Longitud (WGS84)</Label>
                  <Input
                    type="number"
                    step="0.00001"
                    value={formData.lng}
                    onChange={(e) => handleLngChange(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="rounded-md bg-muted/40 p-2.5 text-[11px] text-muted-foreground border">
                Coordenadas actuales: <span className="font-mono text-foreground font-semibold">{formData.lat.toFixed(5)}, {formData.lng.toFixed(5)}</span>
              </div>
            </div>

            <div className="rounded-md bg-primary/5 p-2.5 text-[11px] text-primary border border-primary/20 flex items-start gap-2">
              <MapPin className="size-4 shrink-0 mt-0.5" />
              <span>Haga clic sobre el mapa o arrastre el pinchito rojo para ubicar la posición exacta del suministro.</span>
            </div>
          </div>

          <div className="flex flex-col">
            <Label className="text-xs font-medium mb-1 flex items-center justify-between">
              <span>Ubicación en el Mapa</span>
              <span className="text-[10px] text-muted-foreground font-normal">Haga clic para colocar pinchito</span>
            </Label>
            <div
              ref={mapContainerRef}
              style={{ width: "100%", height: "260px", minHeight: "260px", position: "relative" }}
              className="w-full h-[260px] min-h-[260px] rounded-lg border shadow-inner overflow-hidden relative bg-slate-100 dark:bg-slate-800"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSave(formData)} className="h-8 text-xs">
            Actualizar Ubicación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddSupplyModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (data: SupplyFormData) => void
}): React.JSX.Element {
  const [formData, setFormData] = useState<SupplyFormData>({
    code: Math.floor(100000 + Math.random() * 900000).toString(),
    clientId: "UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS",
    clientName: "",
    address: "",
    district: "LIMA",
    status: "activo",
    lat: -12.04637,
    lng: -77.04279,
    meterCode: `MED-${Math.floor(10000 + Math.random() * 90000)}`,
    meterDiameter: "15",
    meterStatus: "instalado",
    installationDate: new Date().toISOString().split("T")[0],
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Agregar Nuevo Suministro</DialogTitle>
          <DialogDescription className="text-xs">
            Complete la información administrativa para registrar un nuevo suministro.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Código Suministro</Label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Distrito</Label>
              <Select
                value={formData.district}
                onValueChange={(v) => v && setFormData({ ...formData, district: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISTRICT_OPTIONS.filter((d) => d !== "Todos").map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs font-medium">Nombre o Razón Social Cliente</Label>
            <Input
              placeholder="Ej. EMPRESA SEDAPAL S.A."
              value={formData.clientName}
              onChange={(e) =>
                setFormData({ ...formData, clientName: e.target.value, clientId: e.target.value })
              }
              className="h-8 text-xs"
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-xs font-medium">Dirección de Servicio</Label>
            <Input
              placeholder="Ej. Av. Nicolás de Piérola 123"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="h-8 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Serie Medidor</Label>
              <Input
                value={formData.meterCode}
                onChange={(e) => setFormData({ ...formData, meterCode: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Diámetro (mm)</Label>
              <Input
                value={formData.meterDiameter}
                onChange={(e) => setFormData({ ...formData, meterDiameter: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSave(formData)} className="h-8 text-xs">
            Registrar Suministro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MeterModal({
  meter,
  onClose,
  onSave,
}: {
  meter: MeterItem | null
  onClose: () => void
  onSave: (data: MeterFormData) => void
}): React.JSX.Element {
  const [formData, setFormData] = useState<MeterFormData>({
    code: meter ? meter.code : `MED-${Math.floor(10000 + Math.random() * 90000)}`,
    diameter: meter ? meter.diameter : "15",
    status: meter ? meter.status : "instalado",
    installationDate: meter ? meter.installationDate : new Date().toISOString().split("T")[0],
    supplyCode: meter ? meter.supplyCode ?? "100001" : "100001",
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {meter ? `Editar Medidor ${meter.code}` : "Agregar Nuevo Medidor"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Ingrese las especificaciones técnicas del medidor de agua.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Serie de Medidor</Label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Diámetro (mm)</Label>
              <Input
                value={formData.diameter}
                onChange={(e) => setFormData({ ...formData, diameter: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Estado</Label>
              <Select
                value={formData.status}
                onValueChange={(v) =>
                  v &&
                  setFormData({
                    ...formData,
                    status: v as "instalado" | "retirado" | "en_almacen" | "mantenimiento",
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instalado" className="text-xs">Instalado</SelectItem>
                  <SelectItem value="retirado" className="text-xs">Retirado</SelectItem>
                  <SelectItem value="en_almacen" className="text-xs">En Almacén</SelectItem>
                  <SelectItem value="mantenimiento" className="text-xs">Mantenimiento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-medium">Fecha Instalación</Label>
              <Input
                type="date"
                value={formData.installationDate}
                onChange={(e) => setFormData({ ...formData, installationDate: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs font-medium">Código de Suministro Asociado</Label>
            <Input
              placeholder="Ej. 100001"
              value={formData.supplyCode}
              onChange={(e) => setFormData({ ...formData, supplyCode: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSave(formData)} className="h-8 text-xs">
            Guardar Medidor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
