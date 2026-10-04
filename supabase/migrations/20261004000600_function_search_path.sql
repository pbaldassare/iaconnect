-- Pin the search_path of the remaining functions (Supabase security advisor).
alter function ia_connect.set_updated_at() set search_path = '';
alter function ia_connect.forbid_change() set search_path = '';
alter function ia_connect.flow_versions_guard() set search_path = '';
alter function ia_connect.usage_period() set search_path = '';
