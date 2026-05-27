ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS last_appointment_at timestamptz;
