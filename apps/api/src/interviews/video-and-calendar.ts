import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** Daily.co. The API key stays here, and browsers only ever receive a short-lived token for one room. */
@Injectable()
export class DailyClient {
  private readonly logger = new Logger(DailyClient.name);

  get configured() {
    return Boolean(process.env.DAILY_API_KEY);
  }

  private async call(path: string, init: { method?: string; body?: unknown } = {}) {
    let response: Response;
    try {
      response = await fetch(`${process.env.DAILY_API_URL ?? 'https://api.daily.co/v1'}${path}`, {
        method: init.method ?? 'GET',
        headers: { authorization: `Bearer ${process.env.DAILY_API_KEY}`, 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ServiceUnavailableException('The video service is unavailable');
    }
    return response;
  }

  /** Private, so nobody joins without a token. Recording isn't enabled, and closes when the room expires. */
  async ensureRoom(name: string, expiresAt: Date) {
    const found = await this.call(`/rooms/${name}`);
    if (found.ok) return ((await found.json()) as { url: string }).url;
    const created = await this.call('/rooms', {
      method: 'POST',
      body: {
        name,
        privacy: 'private',
        properties: { exp: Math.floor(expiresAt.getTime() / 1000), enable_prejoin_ui: true, enable_screenshare: true, enable_knocking: false, max_participants: 10 },
      },
    });
    if (!created.ok) {
      this.logger.warn(`Room creation failed with ${created.status}`);
      throw new ServiceUnavailableException('The video service is unavailable');
    }
    return ((await created.json()) as { url: string }).url;
  }

  /** A token for this one room only, ending with the join window. Interviewers own the room; the candidate never does. */
  async token(room: string, userName: string, expiresAt: Date, isOwner = false) {
    const response = await this.call('/meeting-tokens', {
      method: 'POST',
      body: { properties: { room_name: room, user_name: userName, is_owner: isOwner, exp: Math.floor(expiresAt.getTime() / 1000), enable_screenshare: true } },
    });
    if (!response.ok) {
      this.logger.warn(`Token request failed with ${response.status}`);
      throw new ServiceUnavailableException('The video service is unavailable');
    }
    return ((await response.json()) as { token: string }).token;
  }
}

type CalendarEvent = { id?: string; interviewId: string; title: string; start: Date; minutes: number; timeZone: string; attendees: string[]; link: string };

/**
 * One event per interview. Google accepts an id the caller chooses (base32hex: 0-9 and a-v, which a UUID's hex digits
 * are), so a retry after a timeout that Google had in fact saved finds the same event instead of adding a second one.
 */
/**
 * Whether Google emails the attendees: all (the default), externalOnly, or none. A local demo sets none, so no invitation
 * reaches anyone until the owner says so. Anything else falls back to the default.
 */
export function sendUpdates(value = process.env.GOOGLE_CALENDAR_SEND_UPDATES) {
  return value && ['all', 'externalOnly', 'none'].includes(value) ? value : 'all';
}

export const calendarEventId = (interviewId: string) => `midan${interviewId.replace(/-/g, '')}`;

/** Google Calendar, with a refresh token for one calendar. A result says what happened, and never claims a send that failed. */
@Injectable()
export class CalendarClient {
  private readonly logger = new Logger(CalendarClient.name);

  get configured() {
    return Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET && process.env.GOOGLE_CALENDAR_REFRESH_TOKEN);
  }

  private get calendarUrl() {
    const base = process.env.GOOGLE_API_URL ?? 'https://www.googleapis.com/calendar/v3';
    return `${base}/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID ?? 'primary')}/events`;
  }

  private async accessToken() {
    const response = await fetch(process.env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? '',
        refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN ?? '',
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) throw new Error(`token ${response.status}`);
    return ((await response.json()) as { access_token: string }).access_token;
  }

  async save(event: CalendarEvent): Promise<{ status: 'sent' | 'failed' | 'not_configured'; eventId?: string }> {
    if (!this.configured) return { status: 'not_configured' };
    try {
      const body = {
        summary: event.title,
        // The interview page is where both sides join the private video room, signed in; a room link alone doesn't open it.
        description: `${event.link}\n\nJoin from this page, signed in to MIDAN. / ادخلوا من هذه الصفحة بعد تسجيل الدخول إلى الميدان.`,
        start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
        end: { dateTime: new Date(event.start.getTime() + event.minutes * 60_000).toISOString(), timeZone: event.timeZone },
        attendees: event.attendees.map((email) => ({ email })),
      };
      const token = await this.accessToken();
      const write = (id: string | undefined) => fetch(`${this.calendarUrl}${id ? `/${id}` : ''}?sendUpdates=${sendUpdates()}`, {
        method: id ? 'PATCH' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(id ? body : { ...body, id: calendarEventId(event.interviewId) }),
      });
      let response = await write(event.id);
      // 409: the event already exists, from an earlier attempt whose answer never arrived. Update it instead.
      if (!event.id && response.status === 409) response = await write(calendarEventId(event.interviewId));
      if (!response.ok) throw new Error(`calendar ${response.status}`);
      return { status: 'sent', eventId: ((await response.json()) as { id: string }).id };
    } catch (error) {
      this.logger.warn(`Calendar sync failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return { status: 'failed', eventId: event.id };
    }
  }

  async cancel(eventId: string) {
    if (!this.configured) return false;
    try {
      const response = await fetch(`${this.calendarUrl}/${eventId}?sendUpdates=${sendUpdates()}`, { method: 'DELETE', headers: { authorization: `Bearer ${await this.accessToken()}` } });
      return response.ok || response.status === 410;
    } catch {
      return false;
    }
  }
}
