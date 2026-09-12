'use client'

import { DataHealthPanel } from '@/components/settings/DataHealthPanel'
import { SettingsNav } from '@/components/settings/SettingsNav'

export default function DataHealthPage() {
  return (
    <div className="space-y-6">
      <SettingsNav current="data-health" />
      <DataHealthPanel />
    </div>
  )
}
