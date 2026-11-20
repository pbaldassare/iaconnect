import { type AiTraining, AiTrainingSchema, type Json, parseAiTraining } from "@ia-connect/core";

export type { AiTraining };

export function aiTrainingFormValues(raw: unknown): AiTraining {
  return parseAiTraining(raw);
}

const list = (formData: FormData, name: string) =>
  formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));

export function buildAiTrainingFromForm(
  formData: FormData,
): { ok: true; training: AiTraining } | { ok: false; errors: Record<string, string> } {
  const notes = String(formData.get("training_notes") ?? "").trim();
  const questions = list(formData, "train_question");
  const answers = list(formData, "train_answer");
  const topics = list(formData, "train_topic");
  const activeFlags = list(formData, "train_active");
  const rowIds = list(formData, "train_id");

  const entries = questions.map((question, index) => ({
    id: rowIds[index]?.trim() ?? "",
    question: question.trim(),
    answer: (answers[index] ?? "").trim(),
    topic: (topics[index] ?? "").trim() || undefined,
    active: activeFlags[index] !== "0",
  }));

  const parsed = AiTrainingSchema.safeParse({
    notes: notes || undefined,
    entries: entries.filter((row) => row.question || row.answer),
  });
  if (!parsed.success) {
    return { ok: false, errors: { form: "Controlla domande e risposte." } };
  }
  for (const row of parsed.data.entries) {
    if (!row.question || !row.answer) {
      return { ok: false, errors: { form: "Ogni riga attiva deve avere domanda e risposta." } };
    }
    if (!row.id) {
      return { ok: false, errors: { form: "Riga senza identificativo: ricarica la pagina e riprova." } };
    }
  }
  return { ok: true, training: parsed.data };
}

export function aiTrainingToJson(training: AiTraining): Json {
  return training as unknown as Json;
}
