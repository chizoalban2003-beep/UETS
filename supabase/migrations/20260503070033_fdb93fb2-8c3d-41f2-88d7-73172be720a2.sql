
SELECT cron.schedule(
  'driftworks-event-resolve',
  '*/15 * * * *',
  $$select net.http_post(
    url:='https://bscilqyqfdpzarnwqvbt.supabase.co/functions/v1/event-resolve',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzY2lscXlxZmRwemFybndxdmJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTAxNzUsImV4cCI6MjA5MzA2NjE3NX0.6H_I9nLkluLAf7iavYqMD9KQ3uMHUcQWhPfMgLz_hY8"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;$$
);

SELECT cron.schedule(
  'driftworks-caretaker-fairness',
  '7 * * * *',
  $$select net.http_post(
    url:='https://bscilqyqfdpzarnwqvbt.supabase.co/functions/v1/caretaker-fairness',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzY2lscXlxZmRwemFybndxdmJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTAxNzUsImV4cCI6MjA5MzA2NjE3NX0.6H_I9nLkluLAf7iavYqMD9KQ3uMHUcQWhPfMgLz_hY8"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;$$
);
