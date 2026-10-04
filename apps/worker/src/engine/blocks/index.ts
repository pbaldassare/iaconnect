import type { Executor } from "../types.ts";
import * as ai from "./ai.ts";
import * as channels from "./channels.ts";
import * as data from "./data.ts";
import * as logic from "./logic.ts";
import * as people from "./people.ts";
import * as services from "./services.ts";

/** One executor per catalog block. A test checks that none is missing. */
export const EXECUTORS: Record<string, Executor> = {
  "logic.condition": logic.condition,
  "logic.switch": logic.switchBlock,
  "logic.for_each": logic.forEach,
  "wait.delay": logic.delay,
  "wait.for_reply": logic.forReply,
  "contact.upsert": data.contactUpsert,
  "contact.find_matching": data.contactFindMatching,
  "deal.create": data.dealCreate,
  "deal.update_stage": data.dealUpdateStage,
  "crm.read": data.crmRead,
  "crm.write": data.crmWrite,
  "whatsapp.send_template": channels.whatsappSendTemplate,
  "whatsapp.send_text": channels.whatsappSendText,
  "mail.send": channels.mailSend,
  "sms.send": channels.smsSend,
  "social.send_message": channels.socialSendMessage,
  "social.publish_post": channels.socialPublishPost,
  "human.request_approval": people.requestApproval,
  "human.handoff": people.handoff,
  "human.notify_owner": people.notifyOwner,
  "ai.extract": ai.extract,
  "ai.classify": ai.classify,
  "ai.reply": ai.reply,
  "ai.summarize": ai.summarize,
  "calendar.find_slots": services.calendarFindSlots,
  "calendar.create_event": services.calendarCreateEvent,
  "payment.request": services.paymentRequest,
  "signature.request": services.signatureRequest,
};
