import type { FeatureCollection, Geometry } from "geojson"

export const layerKeys = [
  "distritos",
  "manzanas",
  "cuadrantes",
  "lotes",
  "tuberias",
  "conexiones",
  "alcantarillado",
  "suministros",
  "medidores",
] as const

export type LayerKey = (typeof layerKeys)[number]

export type LayerMeta = {
  available: boolean
  hasMore: boolean
  page?: number
  pageSize?: number
  total: number
  totalPages?: number
  minZoom?: number
  streamed?: boolean
  zoomLimited?: boolean
}

export type LayerPayload = {
  data: FeatureCollection<Geometry, Record<string, unknown>>
  meta: LayerMeta
}

export type GisLayersResponse = {
  bbox: { minx: number; miny: number; maxx: number; maxy: number }
  layers: Partial<Record<LayerKey, LayerPayload>>
}

export type DistrictOption = {
  /** Código oficial SEDAPAL: 001-044 en Lima, 101-107 en Callao. */
  code: string | null
  name: string
  supplyCount: number
  /** Envolvente [minLng, minLat, maxLng, maxLat] para encuadrar la cámara. */
  bounds: [number, number, number, number] | null
  /** Punto interior al polígono, no el centroide: sirve para distritos cóncavos. */
  center: [number, number] | null
}

export type SessionUser = {
  id: string
  email: string | null
}

export type SessionSnapshot = {
  authenticated: boolean
  user: SessionUser | null
}

export type SupplyDetail = {
  supply: {
    id: string
    code: string
    customerName: string | null
    address: string | null
    status: string | null
    locationSource: string | null
    locationQuality: string | null
  }
  geometry: Geometry | null
  meter: {
    code: string
    diameter: string | null
    installationDate: string | null
    status: string | null
  } | null
  hierarchy: {
    district: string | null
    quadrant: string | null
    lot: string | null
    provisional: boolean
    geometryAvailable: boolean
  }
  cadastre: {
    districtCode: string | null
    districtName: string | null
    districtMatchStatus: "MATCHED" | "SOURCE_MISMATCH" | "UNKNOWN_DISTRICT" | "INVALID_LOT_CODE"
    blockCode: string | null
    cupCode: string | null
    geometryMatchStatus: "NO_GEOMETRY" | "UNIQUE_GEOMETRY" | "MULTIPARCEL_SAME_BLOCK" | "MULTIBLOCK" | null
    geometryCount: number
    cuaCode: string | null
    cuaLabel: string | null
    cuaCatalogDescription: string | null
    cuaMatchMethod: "EXACT" | "PREFIX" | "UNRESOLVED" | "EMPTY"
  } | null
  /** Lote catastral resuelto espacialmente (distinto de hierarchy.lot, que es
   *  una referencia textual de facturación). Permite saltar al lote real. */
  cadastralLink: {
    kind: "lot"
    recordId: string
    code: string | null
    blockCode: string | null
    method: "CUPCODE" | "SPATIAL"
  } | null
  /** Null cuando no hay facturación cargada para el año en curso todavía. */
  consumption: {
    currentYearAverageM3: number | null
    readingCount: number
    districtAverageM3: number | null
    districtSupplyCount: number
    comparisonPercent: number | null
  } | null
  /** Los cálculos de facturación se solicitan después de abrir la ficha. */
  consumptionLoading: boolean
}

export type RelationshipResult = {
  district: { id: string | number; name: string } | null
  quadrant: { id: string; code: string; name: string | null } | null
  block: {
    id: string
    blockCode: string
    propertyCode: string | null
    blockTypeCode: string | null
    areaM2: number
    perimeterM: number
  } | null
  lot: {
    id: string
    blockCode: string | null
    lotCode: string
    cupCode: string | null
    propertyCode: string | null
    lotTypeCode: string | null
    projectStatus: string | null
    levels: number | null
    areaM2: number
    perimeterM: number
  } | null
  supply: {
    id: string
    supplyCode: string
    sector: string | null
    lotCode: string | null
    distanceMeters: number
  } | null
}

export type CadastralSelection = {
  center?: [number, number]
  id: string
  kind: "block" | "lot"
  properties: Record<string, unknown>
}

export type CadastreSearchResult = CadastralSelection & {
  center: [number, number]
  code: string
}

export type GeometryCorrectionInput = {
  targetKind: "block" | "lot"
  targetId: string
  deltaLng: number
  deltaLat: number
  reset?: boolean
}

export type ReportSeverity = "normal" | "observation" | "probable" | "critical"

export type ReportEvolutionRow = {
  year: number
  month: number
  label: string
  currentVolume: number | null
  previousVolume: number | null
  historicalMedian: number | null
  variationVsMedianPercent: number | null
  variationVsPreviousYearPercent: number | null
  previousYearDifference: number | null
  absoluteDifference: number | null
  isAnomaly: boolean
  severity: ReportSeverity
  type: string
  baselineYears: number[]
  baselineValues: (number | null)[]
  baselineSampleCount: number
  bySupply?: Record<string, number | null>
}

export type ReportSummary = {
  accumulatedVolume: number | null
  historicalAccumulatedMedian: number | null
  medianDeltaPercent: number | null
  medianDeltaM3: number | null
  previousDeltaPercent: number | null
  previousDeltaM3: number | null
  baselineStartYear: number
  baselineEndPeriod: string
}

export type ReportInsightCard = {
  title: string
  description: string
  tone: string
}

export type ReportAnalysisDetail = {
  severity: ReportSeverity
  score: number
  robustZScore: number | null
  reasons: string[]
}

export type ReportYear = {
  evolutionRows: ReportEvolutionRow[]
  summary: ReportSummary
  insightCards: ReportInsightCard[]
  analysis: ReportAnalysisDetail
}

export type SupplyReport = {
  supplyCode: string
  years: number[]
  header: {
    customerName: string | null
    district: string | null
    classification: string
    payerClassification: string
    serviceStatus: string
    debt: number
  }
    analysisByYear: Record<string, ReportYear>
    indicators: {
      coverage: {
        billing: boolean
        district: boolean
        geolocation: boolean
        block: boolean
        lot: boolean
        operations: boolean
      }
      spatial: {
        blockCode: string | null
        blockGeometry: {
          type: "Polygon" | "MultiPolygon"
          coordinates: number[][][] | number[][][][]
        } | null
        blockLots: Array<{
          id: string
          lotCode: string
          areaM2: number | null
          isCurrent: boolean
          geometry: {
            type: "Polygon" | "MultiPolygon"
            coordinates: number[][][] | number[][][][]
          }
        }>
        districtCode: string | null
        hasGeolocation: boolean
        hasLot: boolean
        hasBlock: boolean
        lotAreaM2: number | null
        lotPerimeterM: number | null
        blockPerimeterM: number | null
        blockLotAreaM2: number | null
        lotLevels: number | null
        periodYear: number | null
        periodMonth: number | null
        currentConsumptionM3: number | null
        currentBillingSoles: number | null
        districtAverageM3: number | null
        districtConsumptionM3: number | null
        districtBillingSoles: number | null
        districtSupplyCount: number
        districtRank: number | null
        consumptionPercentile: number | null
        blockAverageM3: number | null
        lotConsumptionM3: number | null
        lotSupplyCount: number
        lotSupplies?: Array<{
          supplyCode: string
          volume: number | null
          billingSoles: number | null
          isCurrent: boolean
          point: { type: "Point"; coordinates: [number, number] } | null
        }>
        blockSupplies?: Array<{
          supplyCode: string
          volume: number | null
          isCurrent: boolean
          isLotSupply: boolean
          point: { type: "Point"; coordinates: [number, number] } | null
        }>
        blockConsumptionM3: number | null
        blockBillingSoles: number | null
        blockSupplyCount: number
        blockRank: number | null
        neighborAverageM3: number | null
        neighborCount: number
        consumptionPerM2: number | null
        consumptionPerLinearMeter: number | null
        currentSupplyConsumptionPerM2: number | null
        currentSupplyConsumptionPerLinearMeter: number | null
        blockConsumptionDensityM3PerM2: number | null
        blockConsumptionPerLinearMeter: number | null
        neighborDeviationPercent: number | null
        districtPerAreaRank: number | null
        districtPerAreaSupplyCount: number
        districtLotPeers: Array<{
          supplyCode: string
          customerName: string
          volume: number
          areaM2: number
        }>
        similarLotsAverageM3: number | null
        similarLotsCount: number
        similarLots: Array<{
          supplyCode: string
          customerName: string
          volume: number
          areaM2?: number
          cua?: string
          point?: { type: "Point"; coordinates: [number, number] } | null
          lotGeometry?: Geometry | null
          blockGeometry?: Geometry | null
        }>
      }
      economic: {
        latestYear?: number
        latestMonth?: number
        monthlyBillingSoles?: number
        annualBillingSoles?: number
        averageTicketSoles?: number
        billedPeriodCount?: number
      }
      operations: {
        inspectionCount?: number
        lastInspectionAt?: string | null
        openAnomalyCount?: number
        contrastationCount?: number
        lastContrastationResult?: string | null
      }
    }
    details: {
      stateReadings: Array<{
        readingDate: string | null
        readingType: string | null
        meterType: string | null
        meterSerial: string | null
        diameterMm: string | null
        readingValue: string | null
        incidenceLabel: string | null
        incidenceDetail: string | null
        observation: string | null
        supplyCode?: string
      }>
      meterInstallations: Array<{
        installationDate: string | null
        processDate: string | null
        meterSerial: string | null
        previousMeterSerial: string | null
        diameterMm: number | null
        status: string | null
        workOrderNumber: string | null
        serviceOrderNumber: string | null
        currentReading: number | null
        previousReading: number | null
        observation: string | null
        supplyCode?: string
      }>
      workOrders: Array<{
        code: string
        orderType: string
        status: string
        priority: string
        scheduledDate: string | null
        completedAt: string | null
        title: string
        description: string | null
        resultNotes: string | null
        supplyCode?: string
      }>
      billing: Array<{
        period_year: number
        period_month: number
        concept: string
        billed_volume_m3: number | null
        amount_soles: number | null
      }>
      anomalies: Array<{
        anomalyType: string
        detectedAt: string
        detectedValue: number | null
        expectedValue: number | null
        deviationPercent: number | null
        resolved: boolean
        resolvedAt: string | null
        resolutionNotes: string | null
        status: string | null
        readingObservation: string | null
        billingObservation: string | null
        inspectionObservation: string | null
        supplyCode?: string
      }>
      inspections: Array<{
        inspectionDate: string | null
        visitDate: string | null
        workOrderNumber: string | null
        typology: string | null
        result: string | null
        serviceStatus: string | null
        meterSerial: string | null
        readingValue: string | null
        observation: string | null
        supplyCode?: string
      }>
      /** Lecturas comerciales mensuales (customer_supply_readings). */
      readings?: Array<{
        readingDate: string | null
        readingYear: number | null
        readingMonth: number | null
        meterSerial: string | null
        previousReading: string | null
        currentReading: string | null
        readingObservation: string | null
        incidenceCode1: string | null
        incidenceDetail1: string | null
        incidenceCode2: string | null
        incidenceDetail2: string | null
        tariffLabel: string | null
        routeCode: string | null
        readerCode: string | null
        supplyCode?: string
      }>
      /** Contrastaciones de medidor (meter_contrastations). */
      contrastations?: Array<{
        testDate: string | null
        scheduledDate: string | null
        claimDate: string | null
        returnDate: string | null
        orderNumber: string | null
        contrastationType: string | null
        testType: string | null
        status: string | null
        result: string | null
        meterSerial: string | null
        brand: string | null
        diameterMm: number | null
        relativeErrorPermanent: number | null
        relativeErrorTransition: number | null
        relativeErrorMinimum: number | null
        reportNumber: string | null
        claimCode: string | null
        observation: string | null
        supplyCode?: string
      }>
      /** Padrón de medidores (meter_registry). */
      meterRegistry?: Array<{
        meterSerial: string | null
        registryStatus: string | null
        currentState: string | null
        brandCode: string | null
        diameterCode: string | null
        readingType: string | null
        boxType: string | null
        manufacturedAt: string | null
        contractorCode: string | null
        importedAt: string | null
        supplyCode?: string
      }>
      /** Notas de crédito/débito y refacturaciones (customer_billing_adjustments). */
      billingAdjustments?: Array<{
        issueDate: string | null
        noteType: string | null
        documentType: string | null
        documentNumber: string | null
        totalAmount: number | null
        currency: string | null
        reason: string | null
        observation: string | null
        createdByUser: string | null
        supplyCode?: string
      }>
      /** Supervisiones de campo (Supabase `supervision`). */
      supervisions?: Array<{
        workOrderNumber: string | null
        typology: string | null
        visitDate: string | null
        resolutionDate: string | null
        status: string | null
        completedAt: string | null
        createdAt: string | null
        supervisor: string | null
        generalObservation: string | null
        observation: string | null
        fieldObservation: string | null
        meterSerial: string | null
        readingValue: string | null
        supplyStatus: string | null
        serviceStatus: string | null
        meterIncident: string | null
        clandestineStatus: string | null
        clandestineDetail: string | null
        impossibility: string | null
        noEntryReason: string | null
        inspectionPerformed: string | null
        propertyAccess: string | null
        propertyLocation: string | null
        boxLeak: string | null
        boxState: string | null
        lidState: string | null
        seal: string | null
        supplyCode?: string
      }>
      /** Planillas de campo (Supabase `planillas`). */
      planillas?: Array<{
        recordDate: string | null
        meterSerial: string | null
        readingValue: string | null
        routeCode: string | null
        itineraryCode: string | null
        cycleCode: string | null
        supervisor: string | null
        requestingArea: string | null
        load: string | null
        observation: string | null
        customerName: string | null
        address: string | null
        district: string | null
        status: string | null
        completedAt: string | null
        supplyCode?: string
      }>
    }
    generatedAt: string | null
}

export type ClientLotReport = Pick<
  SupplyReport,
  "supplyCode" | "years" | "header" | "analysisByYear" | "generatedAt" | "details"
> & {
  group: {
    analysisScope: "property"
    propertyCode: string
    supplyCodes: string[]
    supplyCount: number
  }
}

export type SupplyFocusPoint = {
  supplyCode: string
  geometry: Geometry | null
}

export type ConsumptionDrop = {
  supplyCode: string
  supplyCodes?: string[]
  supplyCount?: number
  supplyPoints?: SupplyFocusPoint[]
  propertyCode?: string | null
  customerName: string | null
  serviceAddress?: string | null
  district: string | null
  period: string
  currentVolume: number
  referenceVolume: number
  averageCurrentVolume?: number
  averageReferenceVolume?: number
  dropPercent: number
  kind: "zero" | "extremely_low"
  analysisScope?: "supply" | "property"
  classification?: "Grandes Clientes" | "Fuente Propia" | "Operativo"
  geometry?: Geometry | null
}

export type ConsumptionDropScan = {
  total: number
  items: ConsumptionDrop[]
  page?: number
  pageSize?: number
}

export type ReportsMasterRow = {
  supplyCode: string
  customerName: string
  district: string
  debt: number
  officeName: string | null
  segmentName: string | null
  meterSerial: string | null
  routeCode: string | null
  itineraryCode: string | null
  trendPeriod: string | null
  currentVolume: number | null
  previousVolume: number | null
  trendPercent: number | null
  baselineMedianM3: number | null
  targetMedianM3: number | null
}

export type ReportsMasterPage = {
  data: ReportsMasterRow[]
  page: number
  pageSize: number
  summary: {
    fuentePropiaDebt: number
    grandesClientesDebt: number
    totalDebt: number
  }
  total: number
}

export type GeometryCorrectionResult = {
  deltaLng: number
  deltaLat: number
  limited: boolean
  limitReason: string | null
  reset: boolean
  targetId: string
  targetKind: "block" | "lot"
}

/**
 * Dashboard corporativo. El backend (`GET /api/dashboard`) devuelve las filas
 * crudas en snake_case y con importes que pueden llegar como texto (`numeric`
 * de Postgres serializado): el tipado lo refleja tal cual y la normalización
 * vive en `features/dashboard/dashboardData.ts`, igual que en la app web.
 */
export type DashboardCustomerRow = {
  customer_code: string | null
  customer_id: string
  customer_name: string | null
  district: string | null
  last_payment_date: string | null
  payer_classification: string | null
  phone_mobile: string | null
  segment_name: string | null
  supply_code: string | null
  supply_debt_soles: number | string | null
  total_debt_soles?: number | string | null
}

export type DashboardPaymentRow = {
  amount_soles: number | string | null
  payment_date: string | null
}

export type DashboardBilledVolumeRow = {
  customer_category: string
  period_month: number | string
  period_year: number | string
  total_volume_m3: number | string
}

export type DashboardBilledAmountRow = {
  customer_category: string
  period_month: number | string
  period_year: number | string
  total_amount_soles: number | string
}

export type DashboardPaymentSummary = {
  offices: Array<{
    office_code: string | null
    office_name: string
    payment_count: number | string
    total_amount: number | string
  }>
  tariffs: Array<{
    tariff_code: string | null
    payment_count: number | string
    total_amount: number | string
  }>
  topPayers: Array<{
    customer_name: string
    office_code: string | null
    office_name: string
    payment_count: number | string
    segment_name: string | null
    total_amount: number | string
  }>
  totals: {
    matched_payment_count: number | string
    payment_count: number | string
    total_amount: number | string
    unmatched_payment_count: number | string
  }
}

export type DashboardDebtor = {
  customer_name: string
  customer_code: string | null
  district: string | null
  segment_name: string | null
  total_debt: number | string
}

export type DashboardDebtAnalytics = {
  ageRanges: Array<{ bucket_label: string; sort_order: number | string; total_debt: number | string }>
  officeTotals: Array<{ office_code: string | null; office_name: string; total_debt: number | string }>
  tariffTotals: Array<{ tariff_label: string; total_debt: number | string }>
  topUses: Array<{ use_label: string; total_debt: number | string }>
  zoneTotals: Array<{ zone_label: string; total_debt: number | string }>
}

export type DashboardTab = "resumen" | "distribucion" | "volumenes"

export type DashboardPayload = {
  billedAmountProjection: DashboardBilledAmountRow[]
  billedVolumeProjection: DashboardBilledVolumeRow[]
  customers: DashboardCustomerRow[]
  debtAnalytics: DashboardDebtAnalytics
  fpDebtSummary: {
    customerCount: number | string
    snapshotTotalDebt: number | string
    topDebtors: DashboardDebtor[]
  }
  monthlyPayments: DashboardPaymentRow[]
  paymentSummary: DashboardPaymentSummary
}

/**
 * Evidencia de campo (fotos y videos) archivada para un suministro.
 *
 * `folder` y `day` vienen resueltos del backend: son la carpeta de mes y la de
 * dia bajo las que el archivo esta guardado, que es como el equipo lo busca.
 */
export interface SupervisionEvidenceItem {
  id: string
  mediaType: "photo" | "video"
  mediaPath: string
  mimeType: string | null
  description: string | null
  capturedAt: string | null
  latitude: number | null
  longitude: number | null
  workOrderNumber: string
  source: "supervision" | "planilla"
  label: string | null
  supervisor: string | null
  folder: string
  day: string
}

export interface SupplyEvidence {
  supplyCode: string
  items: SupervisionEvidenceItem[]
  generatedAt: string
}
