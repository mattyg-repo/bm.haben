import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, readMiddleware } from "../middleware.ts";
import {
  createGbrPartner,
  updateGbrPartner,
  gbrPartnerInput,
  gbrPartnerOverview,
  gbrSourceOverview,
  saveGbrSourcePartner,
} from "../modules/stammdaten/index.ts";

const sourceSchema = z.object({ kind: z.enum(["document", "bank", "bankkonto"]), sourceId: z.uuid() });

export const getGbrPartners = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ year: z.number().int().min(2000).max(2100) }))
  .handler(({ data }) => gbrPartnerOverview(data.year));

export const createGbrPartnerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(gbrPartnerInput)
  .handler(({ data, context }) => createGbrPartner(context.user.id, data));

export const updateGbrPartnerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), partner: gbrPartnerInput }))
  .handler(({ data, context }) => updateGbrPartner(context.user.id, data.id, data.partner));

export const getGbrSource = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(sourceSchema)
  .handler(({ data }) => gbrSourceOverview(data.kind, data.sourceId));

export const saveGbrSourceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(sourceSchema.extend({ partnerId: z.uuid().nullable() }))
  .handler(({ data, context }) => saveGbrSourcePartner(context.user.id, data.kind, data.sourceId, data.partnerId));
