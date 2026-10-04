import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";

/** Shown instead of a section that is switched off for the organization (`org_features`). */
export function FeatureOff({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Notice tone="neutral" title="Sezione non attiva">
        Questa sezione non è compresa nella configurazione della tua azienda. Per attivarla scrivi a chi ti
        segue per IA Connect.
      </Notice>
    </>
  );
}
