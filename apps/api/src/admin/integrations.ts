/**
 * What each integration is, today, on this server: configured or not, and for the AI service, the mode it reports.
 * "configured" means credentials are present. It does not mean a real call has been verified; see docs/integrations.md.
 */
export async function integrationStatus() {
  let ai: { reachable: boolean; mode?: string } = { reachable: false };
  try {
    const response = await fetch(`${process.env.AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) ai = { reachable: true, mode: ((await response.json()) as { mode: string }).mode };
  } catch {
    // Unreachable is the answer.
  }
  return {
    ai_service: ai,
    daily: { configured: Boolean(process.env.DAILY_API_KEY) },
    google_calendar: {
      configured: Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET && process.env.GOOGLE_CALENDAR_REFRESH_TOKEN),
    },
    // Auth email goes through Supabase Auth's own sender, configured in the Supabase dashboard, not here.
    email: { configured: false, note: 'Supabase Auth sender; in-app notifications only' },
    background_worker: { enabled: process.env.BACKGROUND_WORKER !== 'off' },
  };
}
