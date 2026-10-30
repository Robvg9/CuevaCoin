-- Index the new admin approval foreign key to keep profile delete/update checks efficient.
CREATE INDEX IF NOT EXISTS password_recovery_requests_admin_approved_by_idx
  ON public.password_recovery_requests (admin_approved_by)
  WHERE admin_approved_by IS NOT NULL;
