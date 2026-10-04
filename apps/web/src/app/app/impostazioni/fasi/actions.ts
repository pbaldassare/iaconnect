"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { STAGE_KINDS, type StageKind } from "@/lib/customer-labels";
import { nextStagePosition, reorderStages, stageKey, stageSetProblem } from "@/lib/deals/stages";
import { isUuid } from "@/lib/org-selection";
import { requireOrgManager } from "@/lib/session";
import { revalidatePath } from "next/cache";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};
const isKind = (value: string): value is StageKind => (STAGE_KINDS as readonly string[]).includes(value);

function refresh() {
  revalidatePath("/app/impostazioni/fasi");
  revalidatePath("/app/trattative");
}

async function loadStages() {
  const context = await requireOrgManager();
  const { data, error } = await context.supabase
    .from("deal_stages")
    .select("id, key, name, position, kind")
    .eq("organization_id", context.org.organization.id);
  return { context, stages: data ?? [], error };
}

export async function addStage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { context, stages, error: readError } = await loadStages();
  if (readError) return failFromError(readError);
  const name = text(formData, "name").slice(0, 60);
  const kind = text(formData, "kind");
  if (name.length < 2) return fail("Scrivi il nome della fase.", { name: "Scrivi il nome." });
  if (!isKind(kind)) return fail("Scegli il tipo di fase.", { kind: "Scegli il tipo." });
  if (stages.length >= 20) return fail("Al massimo 20 fasi: con più colonne la vista diventa illeggibile.");
  const { error } = await context.supabase.from("deal_stages").insert({
    organization_id: context.org.organization.id,
    key: stageKey(
      name,
      stages.map((stage) => stage.key),
    ),
    name,
    kind,
    position: nextStagePosition(stages),
  });
  if (error) return failFromError(error);
  refresh();
  return ok(`Fase «${name}» aggiunta in fondo.`);
}

export async function updateStage(
  stageId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { context, stages, error: readError } = await loadStages();
  if (readError) return failFromError(readError);
  const stage = stages.find((item) => item.id === stageId);
  if (!stage) return fail("Questa fase non esiste più. Ricarica la pagina.");
  const name = text(formData, "name").slice(0, 60);
  const kind = text(formData, "kind");
  if (name.length < 2) return fail("Scrivi il nome della fase.", { name: "Scrivi il nome." });
  if (!isKind(kind)) return fail("Scegli il tipo di fase.");
  const problem = stageSetProblem(stages.map((item) => (item.id === stageId ? { kind } : item)));
  if (problem) return fail(problem);
  const { error } = await context.supabase
    .from("deal_stages")
    .update({ name, kind })
    .eq("id", stageId)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  refresh();
  return ok(
    kind !== stage.kind
      ? "Fase salvata. Le trattative già in questa fase non cambiano data di chiusura: vale per i prossimi spostamenti."
      : "Fase salvata.",
  );
}

export async function moveStage(
  stageId: string,
  direction: "up" | "down",
  _prev: ActionResult,
): Promise<ActionResult> {
  const { context, stages, error: readError } = await loadStages();
  if (readError) return failFromError(readError);
  if (!isUuid(stageId)) return fail("Fase non valida.");
  const changes = reorderStages(stages, stageId, direction);
  for (const change of changes) {
    const { error } = await context.supabase
      .from("deal_stages")
      .update({ position: change.position })
      .eq("id", change.id)
      .eq("organization_id", context.org.organization.id);
    if (error) return failFromError(error);
  }
  refresh();
  return ok();
}

export async function deleteStage(stageId: string, _prev: ActionResult): Promise<ActionResult> {
  const { context, stages, error: readError } = await loadStages();
  if (readError) return failFromError(readError);
  const stage = stages.find((item) => item.id === stageId);
  if (!stage) return fail("Questa fase non esiste più. Ricarica la pagina.");
  const { count, error: countError } = await context.supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", context.org.organization.id)
    .eq("stage_id", stageId);
  if (countError) return failFromError(countError);
  if ((count ?? 0) > 0) {
    return fail(
      `In «${stage.name}» ci sono ${count} trattative: una fase con trattative non si può eliminare. Spostale in un'altra fase, poi riprova.`,
    );
  }
  const problem = stageSetProblem(stages.filter((item) => item.id !== stageId));
  if (problem) return fail(problem);
  const { error } = await context.supabase
    .from("deal_stages")
    .delete()
    .eq("id", stageId)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  refresh();
  return ok(`Fase «${stage.name}» eliminata.`);
}
