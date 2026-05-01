-- Grant cron usage and schedule three platform jobs

GRANT USAGE ON SCHEMA cron TO postgres;

-- Unschedule any existing duplicates (safe re-run)
DO $$
DECLARE jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN
    ('driftworks-ingest-data','driftworks-auto-resolve','driftworks-caretaker-events')
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

-- 1. Live data ingestion every 5 minutes
SELECT cron.schedule(
  'driftworks-ingest-data',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://bscilqyqfdpzarnwqvbt.supabase.co/functions/v1/ingest-data',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzY2lscXlxZmRwemFybndxdmJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTAxNzUsImV4cCI6MjA5MzA2NjE3NX0.6H_I9nLkluLAf7iavYqMD9KQ3uMHUcQWhPfMgLz_hY8"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);

-- 2. Lifecycle progressor every 10 minutes
SELECT cron.schedule(
  'driftworks-auto-resolve',
  '*/10 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://bscilqyqfdpzarnwqvbt.supabase.co/functions/v1/auto-resolve',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzY2lscXlxZmRwemFybndxdmJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTAxNzUsImV4cCI6MjA5MzA2NjE3NX0.6H_I9nLkluLAf7iavYqMD9KQ3uMHUcQWhPfMgLz_hY8"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);

-- 3. Caretaker briefings/events every 30 minutes
SELECT cron.schedule(
  'driftworks-caretaker-events',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://bscilqyqfdpzarnwqvbt.supabase.co/functions/v1/caretaker-events',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzY2lscXlxZmRwemFybndxdmJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTAxNzUsImV4cCI6MjA5MzA2NjE3NX0.6H_I9nLkluLAf7iavYqMD9KQ3uMHUcQWhPfMgLz_hY8"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);