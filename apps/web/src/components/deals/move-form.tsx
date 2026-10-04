import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Select } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";

/** "Sposta in…": the keyboard and screen-reader way to move a deal between stages. */
export function MoveForm({
  action,
  dealId,
  dealTitle,
  currentStageId,
  stages,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  dealId: string;
  dealTitle: string;
  currentStageId: string;
  stages: readonly { id: string; name: string }[];
}) {
  const others = stages.filter((stage) => stage.id !== currentStageId);
  if (others.length === 0) return null;
  const id = `move-${dealId}`;
  return (
    <ActionForm action={action} className="grid gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Sposta «{dealTitle}» in un'altra fase
        </label>
        <Select id={id} name="stage_id" defaultValue="" required dense className="min-w-0 flex-1">
          <option value="" disabled>
            Sposta in…
          </option>
          {others.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </Select>
        <SubmitButton size="sm" variant="secondary" pendingLabel="…">
          Sposta
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
