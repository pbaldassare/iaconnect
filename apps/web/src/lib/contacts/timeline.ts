/** One chronological history for a contact: messages, deal events, appointments. Pure, unit tested. */

export type TimelineItem =
  | {
      kind: "message";
      at: string;
      id: string;
      direction: string;
      channel: string;
      content: string;
      aiGenerated: boolean;
      conversationId: string;
    }
  | {
      kind: "deal_event";
      at: string;
      id: string;
      dealId: string;
      type: string;
      fromStageId: string | null;
      toStageId: string | null;
      actorType: string;
    }
  | { kind: "appointment"; at: string; id: string; title: string; status: string; location: string | null };

export function mergeTimeline(input: {
  messages: readonly {
    id: string;
    created_at: string;
    direction: string;
    channel: string;
    content: string;
    ai_generated: boolean;
    conversation_id: string;
  }[];
  dealEvents: readonly {
    id: string;
    created_at: string;
    deal_id: string;
    type: string;
    from_stage_id: string | null;
    to_stage_id: string | null;
    actor_type: string;
  }[];
  appointments: readonly {
    id: string;
    starts_at: string;
    title: string;
    status: string;
    location: string | null;
  }[];
}): TimelineItem[] {
  const items: TimelineItem[] = [
    ...input.messages.map(
      (m): TimelineItem => ({
        kind: "message",
        at: m.created_at,
        id: m.id,
        direction: m.direction,
        channel: m.channel,
        content: m.content,
        aiGenerated: m.ai_generated,
        conversationId: m.conversation_id,
      }),
    ),
    ...input.dealEvents.map(
      (e): TimelineItem => ({
        kind: "deal_event",
        at: e.created_at,
        id: e.id,
        dealId: e.deal_id,
        type: e.type,
        fromStageId: e.from_stage_id,
        toStageId: e.to_stage_id,
        actorType: e.actor_type,
      }),
    ),
    ...input.appointments.map(
      (a): TimelineItem => ({
        kind: "appointment",
        at: a.starts_at,
        id: a.id,
        title: a.title,
        status: a.status,
        location: a.location,
      }),
    ),
  ];
  // Newest first; ties keep a stable order by id so the list does not jump between refreshes.
  return items.sort((a, b) => {
    const diff = new Date(b.at).getTime() - new Date(a.at).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}
