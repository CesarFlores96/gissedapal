import type { FeatureCollection, Geometry } from "geojson"

export const layerKeys = [
  "distritos",
  "manzanas",
  "cuadrantes",
  "lotes",
  "tuberias",
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
      }>
    }
    generatedAt: string | null
}

export type ClientLotReport = Pick<
  SupplyReport,
  "supplyCode" | "years" | "header" | "analysisByYear" | "generatedAt"
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
