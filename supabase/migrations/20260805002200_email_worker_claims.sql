-- ============================================================================
-- TAMCO Focus — weekly email delivery processing state
-- ============================================================================

alter type public.email_delivery_status add value 'processing' after 'queued';
