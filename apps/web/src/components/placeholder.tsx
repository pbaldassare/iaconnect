import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** Temporary page body for sections that are not built yet. Replace the whole page when building the section. */
export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState title="In costruzione" description="Questa sezione arriva tra poco." />
    </>
  );
}
