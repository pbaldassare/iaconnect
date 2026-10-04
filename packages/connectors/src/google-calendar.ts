import {
  CalendarCreateEventInput,
  CalendarFindSlotsInput,
  type Connector,
  ConnectorError,
} from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import { googleAuthorizationUrl, googleOAuth, revokeGoogleToken } from "./lib/google.ts";
import { HEALTHY, healthFromError, parseInput, requestJson } from "./lib/http.ts";
import { authorizedJson, exchangeCode } from "./lib/oauth.ts";
import { OAuthCallbackInput } from "./lib/schemas.ts";
import { asArray, asRecord, asString, compact } from "./lib/values.ts";

const SERVICE = "Google Calendar";
const API = "https://www.googleapis.com/calendar/v3";
const OAUTH = googleOAuth(SERVICE);
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
/** Safety bound on the search window. */
const MAX_DAYS = 62;

const SettingsSchema = z.object({
  calendarId: z.string().min(1).default("primary").describe("Calendario da usare"),
  timeZone: z.string().min(1).default("Europe/Rome").describe("Fuso orario"),
  workdayStartHour: z
    .number()
    .int()
    .min(0)
    .max(23)
    .default(9)
    .describe("Ora di inizio della giornata lavorativa"),
  workdayEndHour: z
    .number()
    .int()
    .min(1)
    .max(24)
    .default(18)
    .describe("Ora di fine della giornata lavorativa"),
  workDays: z
    .array(z.number().int().min(1).max(7))
    .default([1, 2, 3, 4, 5])
    .describe("Giorni lavorativi (1 = lunedì … 7 = domenica)"),
  slotStepMinutes: z
    .number()
    .int()
    .min(5)
    .max(240)
    .default(30)
    .describe("Distanza tra due orari proposti, in minuti"),
});
export type CalendarSettings = z.output<typeof SettingsSchema>;

export const GoogleCalendarInput = OAuthCallbackInput.extend(SettingsSchema.shape);

interface Interval {
  start: number;
  end: number;
}

/** Offset (local − UTC) of a time zone at a given instant, in milliseconds. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return local - Math.floor(utcMs / 1000) * 1000;
}

/** UTC instant of a wall-clock time in a time zone (handles daylight saving changes). */
function zonedToUtc(year: number, month: number, day: number, hour: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/**
 * Free slots inside working hours. Pure function: `busy` comes from the freeBusy API.
 */
export function computeFreeSlots(input: {
  from: number;
  to: number;
  durationMinutes: number;
  max: number;
  busy: Interval[];
  settings: CalendarSettings;
}): { start: string; end: string }[] {
  const { from, to, busy, settings } = input;
  const duration = input.durationMinutes * 60_000;
  const step = settings.slotStepMinutes * 60_000;
  const slots: { start: string; end: string }[] = [];
  if (!(duration > 0) || !(to > from)) return slots;

  // Calendar day (in the connection's time zone) that contains `from`.
  const local = new Date(from + zoneOffsetMs(from, settings.timeZone));
  let cursor = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());

  for (let day = 0; day < MAX_DAYS && slots.length < input.max; day++, cursor += 86_400_000) {
    const date = new Date(cursor);
    const [year, month, dayOfMonth] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    const dayStart = zonedToUtc(year, month, dayOfMonth, settings.workdayStartHour, settings.timeZone);
    if (dayStart >= to) break;
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if (!settings.workDays.includes(weekday)) continue;
    const dayEnd = zonedToUtc(year, month, dayOfMonth, settings.workdayEndHour, settings.timeZone);

    for (let start = dayStart; start + duration <= dayEnd && slots.length < input.max; start += step) {
      const end = start + duration;
      if (start < from || end > to) continue;
      if (busy.some((interval) => interval.start < end && interval.end > start)) continue;
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }
  return slots;
}

function settingsOf(config: Record<string, unknown>): CalendarSettings {
  const parsed = SettingsSchema.safeParse(config);
  if (!parsed.success) {
    throw new ConnectorError(`${SERVICE}: impostazioni del calendario non valide`, {
      retryable: false,
      code: "invalid_connection",
    });
  }
  return parsed.data;
}

function instant(value: string, label: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new ConnectorError(`${SERVICE}: data non valida (${label})`, {
      retryable: false,
      code: "invalid_input",
    });
  }
  return ms;
}

export const googleCalendarConnector: Connector = {
  key: "google_calendar",
  category: "calendar",
  name: "Google Calendar",
  description: "Legge gli orari liberi e fissa appuntamenti.",
  connectMode: "oauth",
  inputSchema: GoogleCalendarInput,
  emits: [],

  startOAuth(input) {
    return { authorizationUrl: googleAuthorizationUrl(SCOPES, input) };
  },

  async connect(input, deps) {
    const { code, redirectUri, ...settings } = parseInput(GoogleCalendarInput, input);
    const tokens = await exchangeCode(deps, OAUTH, { code, redirectUri });
    if (!tokens.refreshToken) {
      throw new ConnectorError(`${SERVICE}: autorizzazione incompleta, ripeti il collegamento`, {
        retryable: false,
        code: "oauth_no_refresh_token",
      });
    }
    const user = await requestJson(deps.fetch, SERVICE, "https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    const email = asString(user.email);
    return {
      config: compact({ email, ...settings }),
      secrets: { ...tokens },
      externalAccountId: email,
    };
  },

  async verify(context) {
    try {
      const settings = settingsOf(context.connection.config);
      const now = context.now();
      await authorizedJson(context, OAUTH, `${API}/freeBusy`, {
        json: {
          timeMin: now.toISOString(),
          timeMax: new Date(now.getTime() + 60_000).toISOString(),
          items: [{ id: settings.calendarId }],
        },
      });
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  },

  actions: {
    findSlots: defineAction({
      key: "findSlots",
      title: "Trova orari liberi",
      input: CalendarFindSlotsInput,
      async execute(context, input) {
        const settings = settingsOf(context.connection.config);
        // Never propose a slot in the past.
        const from = Math.max(instant(input.from, "from"), context.now().getTime());
        const to = instant(input.to, "to");
        if (to <= from) return { slots: [] };
        const result = await authorizedJson(context, OAUTH, `${API}/freeBusy`, {
          json: {
            timeMin: new Date(from).toISOString(),
            timeMax: new Date(to).toISOString(),
            timeZone: settings.timeZone,
            items: [{ id: settings.calendarId }],
          },
        });
        const calendar = asRecord(asRecord(result.calendars)[settings.calendarId]);
        if (asArray(calendar.errors).length > 0) {
          throw new ConnectorError(`${SERVICE}: calendario non leggibile`, {
            retryable: false,
            code: "calendar_error",
          });
        }
        const busy = asArray(calendar.busy)
          .map((item) => ({
            start: Date.parse(asString(asRecord(item).start) ?? ""),
            end: Date.parse(asString(asRecord(item).end) ?? ""),
          }))
          .filter((interval) => !Number.isNaN(interval.start) && !Number.isNaN(interval.end));
        return {
          slots: computeFreeSlots({
            from,
            to,
            durationMinutes: input.durationMinutes,
            max: input.max,
            busy,
            settings,
          }),
        };
      },
    }),
    createEvent: defineAction({
      key: "createEvent",
      title: "Crea un appuntamento",
      input: CalendarCreateEventInput,
      async execute(context, input) {
        const settings = settingsOf(context.connection.config);
        instant(input.start, "start");
        instant(input.end, "end");
        const created = await authorizedJson(
          context,
          OAUTH,
          `${API}/calendars/${encodeURIComponent(settings.calendarId)}/events`,
          {
            json: compact({
              summary: input.title,
              description: input.description,
              location: input.location,
              start: { dateTime: input.start, timeZone: settings.timeZone },
              end: { dateTime: input.end, timeZone: settings.timeZone },
              attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
            }),
          },
        );
        const url = asString(created.htmlLink);
        return { externalEventId: asString(created.id) ?? "", ...(url ? { url } : {}) };
      },
    }),
  },

  async disconnect(context) {
    await revokeGoogleToken(
      context.fetch,
      SERVICE,
      context.secrets.refreshToken ?? context.secrets.accessToken,
    );
  },
};
