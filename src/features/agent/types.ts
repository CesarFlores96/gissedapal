export type AgentMode = "quick" | "deep"
export type AgentSeverity = "info" | "low" | "medium" | "high" | "critical"

export type AgentContext = {
  route: string
  supplyCode?: string
  propertyCode?: string
  district?: string
  bbox?: [number, number, number, number]
  zoom?: number
  activeLayers: string[]
}

export type AgentHistoryMessage = {
  role: "user" | "assistant"
  text: string
}

export type AgentFinding = {
  title: string
  summary: string
  severity: AgentSeverity
  confidence: number
  sourceIds: string[]
}

export type AgentSource = {
  id: string
  label: string
  status: "available" | "empty" | "unavailable"
  recordCount: number
}

export type AgentChart = {
  type: "line" | "bar"
  title: string
  xKey: string
  yKey: string
  data: Array<Record<string, string | number | null>>
}

export type AgentAction = {
  type: "open_supply" | "open_property_report" | "focus_map" | "set_district"
  label: string
  payload: Record<string, unknown>
}

export type AgentResponse = {
  analysisId: string
  answer: string
  mode: AgentMode
  findings: AgentFinding[]
  sources: AgentSource[]
  charts: AgentChart[]
  actions: AgentAction[]
  limitations: string[]
  toolCount: number
  modelUsed: boolean
}

export type AgentChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: number
  response?: AgentResponse
}

export type AgentConversation = {
  id: string
  userId: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AgentChatMessage[]
}
