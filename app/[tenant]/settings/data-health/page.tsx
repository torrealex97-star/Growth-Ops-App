'use client'

import { AiEnginePanel } from '@/components/settings/AiEnginePanel'
import { DataHealthPanel } from '@/components/settings/DataHealthPanel'

export default function DataHealthPage() {
  return (
    <div className="space-y-6">
      <DataHealthPanel />
      <AiEnginePanel />
    </div>
  )
}
