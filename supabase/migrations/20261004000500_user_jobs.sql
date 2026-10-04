-- Jobs requested from the web app. The worker treats their payload as untrusted
-- and scopes every lookup by the job's organization_id.

alter table ia_connect.scheduled_jobs add column created_by uuid default auth.uid();

drop policy org_insert on ia_connect.scheduled_jobs;
create policy org_insert on ia_connect.scheduled_jobs for insert to authenticated
  with check (
    created_by = auth.uid()
    and status = 'pending'
    and attempts = 0
    and (
      (kind in ('send_message', 'approval_decided') and ia_connect.has_org_access(organization_id))
      or (kind in ('simulate_flow', 'scrape_run', 'scrape_trace', 'verify_connection') and ia_connect.can_manage_org(organization_id))
    )
  );
