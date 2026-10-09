-- #region installed
-- Scheduled by the wa-li-schema migration when pg_cron is installed:
select cron.schedule('wa_prune_events_daily', '17 3 * * *', 'select public.wa_prune_events(30)');
-- #endregion installed

-- #region late
-- Enabled pg_cron after applying the migration? Schedule it yourself:
create extension if not exists pg_cron;
select cron.schedule('wa_prune_events_daily', '17 3 * * *', 'select public.wa_prune_events(30)');

-- Change the retention, inspect or remove the job:
select cron.unschedule('wa_prune_events_daily');
select cron.schedule('wa_prune_events_daily', '17 3 * * *', 'select public.wa_prune_events(14)');
select * from cron.job where jobname = 'wa_prune_events_daily';
-- #endregion late
