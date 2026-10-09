-- Supabase: Database → Extensions → enable pg_cron and pg_net. Keep the secret in Vault.
select vault.create_secret('<the SENDO_CRON_SECRET value>', 'sendo_cron_secret');

select cron.schedule(
  'sendo_tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<your-domain>/api/sendo/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'sendo_cron_secret'
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Check the last runs, or stop it:
select status, return_message, start_time from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'sendo_tick')
  order by start_time desc limit 5;
select cron.unschedule('sendo_tick');
