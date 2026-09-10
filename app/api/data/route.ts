import { NextResponse } from 'next/server'
import { fetchDashboardData } from '@/lib/sheets'

export const revalidate = 60

export async function GET() {
  try {
    const data = await fetchDashboardData()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
    })
  } catch (error) {
    console.error('Error fetching dashboard data:', error)
    return NextResponse.json(
      {
        error: 'Error al cargar los datos',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
