"use client";
/**
 * Dialog — modal built on the native <dialog> (focus trap, Esc and backdrop for free).
 *
 *   import { Dialog } from "@/components/ui/dialog";
 *   <Dialog triggerLabel="Elimina azienda" triggerVariant="danger" title="Eliminare l'azienda?"
 *           description="L'operazione non si può annullare.">
 *     <ActionForm action={deleteOrg}>… <SubmitButton variant="danger">Elimina</SubmitButton></ActionForm>
 *   </Dialog>
 *
 * The component renders its own trigger button. Content is rendered only while
 * open, so forms inside start clean each time. Use it for confirmations and
 * short forms; longer work belongs on a page.
 */
import { type ReactNode, useId, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Icon, type IconName } from "./icons";

export function Dialog({
  triggerLabel,
  triggerVariant = "secondary",
  triggerSize,
  triggerIcon,
  title,
  description,
  children,
}: {
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerIcon?: IconName;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        icon={triggerIcon}
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-0 text-ink shadow-panel"
      >
        {open ? (
          <div className="p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="font-display text-lg font-bold leading-tight tracking-tight">
                  {title}
                </h2>
                {description ? <div className="mt-1.5 text-sm text-muted">{description}</div> : null}
              </div>
              <button
                type="button"
                onClick={() => ref.current?.close()}
                className="-m-1.5 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="x" label="Chiudi" />
              </button>
            </div>
            {children}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
