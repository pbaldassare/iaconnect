import { randomUUID } from "node:crypto";
import {
  CalendarCreateEventOutput,
  CalendarFindSlotsOutput,
  type ConnectorCategory,
  PaymentCreateLinkOutput,
  SignatureCreateOutput,
} from "@ia-connect/core";
import { offersAction, runAction } from "../../connectors.ts";
import { audit, getContact, resolveConnection } from "../../db/repo.ts";
import { StepError } from "../../errors.ts";
import { type Executor, type StepContext, next } from "../types.ts";

const connectionFor = (
  ctx: StepContext,
  category: ConnectorCategory,
  wanted: string | undefined,
  action: string,
) =>
  resolveConnection(ctx.sql, ctx.org.id, category, wanted, null, (row) =>
    offersAction(ctx.deps, row, action),
  );

function parseDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new StepError(`${label}: "${value}" non è una data valida.`, "date");
  return date;
}

interface SlotsParams {
  connection?: string;
  durationMinutes: number;
  days: number;
  max: number;
}

export const calendarFindSlots: Executor<SlotsParams> = {
  async run(ctx, params) {
    const connection = await connectionFor(ctx, "calendar", params.connection, "findSlots");
    const result = CalendarFindSlotsOutput.parse(
      await runAction(ctx.deps, connection, "findSlots", {
        from: ctx.now.toISOString(),
        to: new Date(ctx.now.getTime() + params.days * 86_400_000).toISOString(),
        durationMinutes: params.durationMinutes,
        max: params.max,
      }),
    );
    return next({ slots: result.slots });
  },
  async simulate(ctx, params) {
    // The calendar is not read: two plausible slots keep the following steps readable.
    const day = new Date(ctx.now.getTime() + 86_400_000);
    const slot = (hour: number) => {
      const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour));
      return {
        start: start.toISOString(),
        end: new Date(start.getTime() + params.durationMinutes * 60_000).toISOString(),
      };
    };
    return next({ simulated: true, slots: [slot(9), slot(14)].slice(0, params.max) });
  },
};

interface EventParams {
  connection?: string;
  title: string;
  start: string;
  end: string;
  location?: string;
}

export const calendarCreateEvent: Executor<EventParams> = {
  async run(ctx, params) {
    const start = parseDate(params.start, "Inizio");
    const end = parseDate(params.end, "Fine");
    const connection = await connectionFor(ctx, "calendar", params.connection, "createEvent");
    const contact = ctx.run.contact_id
      ? await getContact(ctx.sql, ctx.org.id, ctx.run.contact_id)
      : undefined;
    const result = CalendarCreateEventOutput.parse(
      await runAction(ctx.deps, connection, "createEvent", {
        title: params.title,
        start: start.toISOString(),
        end: end.toISOString(),
        location: params.location,
        attendeeEmail: contact?.emails[0],
      }),
    );
    const rows = await ctx.sql.query<{ id: string }>(
      `insert into ia_connect.appointments
         (organization_id, contact_id, deal_id, connection_id, title, starts_at, ends_at, location, external_event_id)
       values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9) returning id`,
      [
        ctx.org.id,
        ctx.run.contact_id,
        ctx.run.deal_id,
        connection.id,
        params.title,
        start.toISOString(),
        end.toISOString(),
        params.location ?? null,
        result.externalEventId,
      ],
    );
    await audit(
      ctx.sql,
      ctx.org.id,
      "appointment.created",
      { type: "appointment", id: rows[0]!.id },
      {
        flow_run_id: ctx.run.id,
      },
    );
    return next({ appointmentId: rows[0]!.id, externalEventId: result.externalEventId });
  },
  async simulate(_ctx, params) {
    parseDate(params.start, "Inizio");
    parseDate(params.end, "Fine");
    return next({ simulated: true, appointmentId: null, externalEventId: null, appointment: params });
  },
};

function amountCents(amount: number | string): number {
  const text = String(amount).trim();
  const value = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
  if (!Number.isFinite(value) || value <= 0) {
    throw new StepError(`L'importo "${text}" non è valido.`, "amount");
  }
  return Math.round(value * 100);
}

export const paymentRequest: Executor<{ connection?: string; amount: number | string; description: string }> =
  {
    async run(ctx, params) {
      const cents = amountCents(params.amount);
      const connection = await connectionFor(ctx, "payment", params.connection, "createLink");
      const id = randomUUID();
      const result = PaymentCreateLinkOutput.parse(
        await runAction(ctx.deps, connection, "createLink", {
          amountCents: cents,
          currency: "EUR",
          description: params.description,
          reference: id,
        }),
      );
      await ctx.sql.query(
        `insert into ia_connect.payment_requests
         (id, organization_id, contact_id, deal_id, connection_id, amount_cents, description, external_id, url)
       values ($1, $2, $3, $4, $5, $6::bigint, $7, $8, $9)`,
        [
          id,
          ctx.org.id,
          ctx.run.contact_id,
          ctx.run.deal_id,
          connection.id,
          cents,
          params.description,
          result.externalId,
          result.url,
        ],
      );
      await audit(
        ctx.sql,
        ctx.org.id,
        "payment.requested",
        { type: "payment_request", id },
        { flow_run_id: ctx.run.id },
      );
      return next({ paymentRequestId: id, url: result.url });
    },
    async simulate(_ctx, params) {
      return next({
        simulated: true,
        paymentRequestId: null,
        url: null,
        amount: amountCents(params.amount) / 100,
        description: params.description,
      });
    },
  };

export const signatureRequest: Executor<{ connection?: string; documentUrl: string; title: string }> = {
  async run(ctx, params) {
    const contact = ctx.run.contact_id
      ? await getContact(ctx.sql, ctx.org.id, ctx.run.contact_id)
      : undefined;
    if (!contact?.emails[0]) {
      throw new StepError("Per la firma serve un contatto con un indirizzo mail.", "contact");
    }
    const connection = await connectionFor(ctx, "signature", params.connection, "createRequest");
    const id = randomUUID();
    const result = SignatureCreateOutput.parse(
      await runAction(ctx.deps, connection, "createRequest", {
        documentUrl: params.documentUrl,
        title: params.title,
        signerName: contact.full_name,
        signerEmail: contact.emails[0],
        reference: id,
      }),
    );
    await ctx.sql.query(
      `insert into ia_connect.signature_requests
         (id, organization_id, contact_id, deal_id, connection_id, title, document_url, external_id, url)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        ctx.org.id,
        contact.id,
        ctx.run.deal_id,
        connection.id,
        params.title,
        params.documentUrl,
        result.externalId,
        result.url,
      ],
    );
    await audit(
      ctx.sql,
      ctx.org.id,
      "signature.requested",
      { type: "signature_request", id },
      {
        flow_run_id: ctx.run.id,
      },
    );
    return next({ signatureRequestId: id, url: result.url });
  },
  async simulate(_ctx, params) {
    return next({ simulated: true, signatureRequestId: null, url: null, title: params.title });
  },
};
