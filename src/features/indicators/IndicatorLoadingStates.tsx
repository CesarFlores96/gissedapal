import type { JSX } from "react"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function IndicatorLoadingShell(): JSX.Element {
  return <div className="p-3">
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-5 w-64" /><div className="flex gap-1.5"><Skeleton className="h-5 w-20" /><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-14" /></div></div>
      <Skeleton className="h-6 w-24" />
    </div>
    <MetricGridLoading />
  </div>
}

export function MetricGridLoading(): JSX.Element {
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Card className="min-h-24 shadow-none" key={index}><CardHeader className="gap-2 p-3"><Skeleton className="h-4 w-36" /><Skeleton className="h-6 w-24" /><Skeleton className="h-3 w-40" /></CardHeader></Card>)}</div>
}

export function ChartLoading(): JSX.Element {
  return <Card className="mt-2 shadow-none"><CardHeader className="pb-0"><Skeleton className="h-4 w-40" /><Skeleton className="mt-1 h-3 w-64" /></CardHeader><CardContent className="px-3 pb-3 pt-4"><div className="flex h-56 items-end gap-3 border-b px-3 pb-3">{[35, 58, 42, 75, 54, 88, 66].map((height, index) => <Skeleton className="flex-1" key={index} style={{ height: `${height}%` }} />)}</div></CardContent></Card>
}

export function TableLoading({ filter = false }: { filter?: boolean }): JSX.Element {
  return <div className="mt-2 space-y-2">{filter ? <Skeleton className="h-9 w-full max-w-sm" /> : null}<Card className="shadow-none"><CardContent className="p-0"><Table><TableHeader><TableRow>{Array.from({ length: 5 }, (_, index) => <TableHead key={index}><Skeleton className="h-3 w-16" /></TableHead>)}</TableRow></TableHeader><TableBody>{Array.from({ length: 5 }, (_, row) => <TableRow key={row}>{Array.from({ length: 5 }, (_, column) => <TableCell key={column}><Skeleton className="h-3 w-full max-w-28" /></TableCell>)}</TableRow>)}</TableBody></Table></CardContent></Card></div>
}
