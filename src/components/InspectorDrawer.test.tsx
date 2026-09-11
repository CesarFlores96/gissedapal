import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InspectorDrawer } from "./InspectorDrawer"
import type { CadastralSelection } from "../types"

const mockCadastralLot: CadastralSelection = {
  id: "lot-1",
  kind: "lot",
  center: [-77.03, -12.04],
  properties: {
    district_code: "001",
    district: "Lima",
    block_code: "MZ01",
    lot_code: "LT01",
  },
}

describe("InspectorDrawer en modo de solo consulta", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it("muestra botones de mover lote, digitalizar huella y dividir lote cuando NO es solo consulta", async () => {
    await act(async () => {
      root?.render(
        <InspectorDrawer
          isReadOnly={false}
          adjustmentDelta={{ lng: 0, lat: 0 }}
          adjustmentMode={false}
          adjustmentNotice={null}
          adjustmentSaving={false}
          buildingFootprint={null}
          buildingDigitizationMode={false}
          buildingFootprintDraft={[]}
          buildingFootprintSaving={false}
          buildingFootprintNotice={null}
          lotSplitMode={false}
          lotSplitDraftLine={[]}
          lotSplitSuggestion={null}
          lotSplitLoadingSuggestion={false}
          lotSplitSaving={false}
          lotSplitNotice={null}
          activeLotSplitParentId={null}
          cadastral={mockCadastralLot}
          detail={null}
          loading={false}
          onAdjustmentCancel={vi.fn()}
          onAdjustmentNudge={vi.fn()}
          onAdjustmentReset={vi.fn()}
          onAdjustmentSave={vi.fn()}
          onAdjustmentStart={vi.fn()}
          onBuildingFootprintStart={vi.fn()}
          onBuildingFootprintPoint={vi.fn()}
          onBuildingFootprintCancel={vi.fn()}
          onBuildingFootprintSave={vi.fn()}
          onLotSplitStart={vi.fn()}
          onLotSplitCancel={vi.fn()}
          onLotSplitSave={vi.fn()}
          onLotSplitUndo={vi.fn()}
          onClose={vi.fn()}
          onError={vi.fn()}
          onOpenReport={vi.fn()}
          onViewCadastralLink={vi.fn()}
          relation={null}
          relationPoint={null}
        />
      )
    })

    expect(container?.textContent).toContain("Mover solo lote")
    expect(container?.textContent).toContain("Digitalizar")
    expect(container?.textContent).toContain("Dividir lote")
    expect(container?.textContent).not.toContain("Solo consulta")
  })

  it("oculta botones de modificación y muestra badge de solo consulta cuando isReadOnly es true", async () => {
    await act(async () => {
      root?.render(
        <InspectorDrawer
          isReadOnly={true}
          adjustmentDelta={{ lng: 0, lat: 0 }}
          adjustmentMode={false}
          adjustmentNotice={null}
          adjustmentSaving={false}
          buildingFootprint={null}
          buildingDigitizationMode={false}
          buildingFootprintDraft={[]}
          buildingFootprintSaving={false}
          buildingFootprintNotice={null}
          lotSplitMode={false}
          lotSplitDraftLine={[]}
          lotSplitSuggestion={null}
          lotSplitLoadingSuggestion={false}
          lotSplitSaving={false}
          lotSplitNotice={null}
          activeLotSplitParentId={null}
          cadastral={mockCadastralLot}
          detail={null}
          loading={false}
          onAdjustmentCancel={vi.fn()}
          onAdjustmentNudge={vi.fn()}
          onAdjustmentReset={vi.fn()}
          onAdjustmentSave={vi.fn()}
          onAdjustmentStart={vi.fn()}
          onBuildingFootprintStart={vi.fn()}
          onBuildingFootprintPoint={vi.fn()}
          onBuildingFootprintCancel={vi.fn()}
          onBuildingFootprintSave={vi.fn()}
          onLotSplitStart={vi.fn()}
          onLotSplitCancel={vi.fn()}
          onLotSplitSave={vi.fn()}
          onLotSplitUndo={vi.fn()}
          onClose={vi.fn()}
          onError={vi.fn()}
          onOpenReport={vi.fn()}
          onViewCadastralLink={vi.fn()}
          relation={null}
          relationPoint={null}
        />
      )
    })

    expect(container?.textContent).not.toContain("Mover solo lote")
    expect(container?.textContent).not.toContain("Digitalizar")
    expect(container?.textContent).not.toContain("Dividir lote")
    expect(container?.textContent).toContain("Solo consulta")
    expect(container?.textContent).toContain("Lote catastral")
  })
})
