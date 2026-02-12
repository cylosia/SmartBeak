-- Migration: Add automatic logging triggers for domain and content changes
-- Created: 2026-02-12
-- Purpose: Automatically insert activity_log entries when domains or content are modified

-- Function to log domain changes
CREATE OR REPLACE FUNCTION log_domain_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activity_log (
    id, org_id, domain_id, user_id, action, entity_type, entity_id,
    metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    NEW.org_id,
    NEW.id,
    COALESCE(current_setting('app.user_id', true), 'system'),
    CASE
      WHEN TG_OP = 'INSERT' THEN 'created'
      WHEN TG_OP = 'UPDATE' THEN 'updated'
      WHEN TG_OP = 'DELETE' THEN 'deleted'
    END,
    'domain',
    NEW.id,
    jsonb_build_object(
      'name', NEW.name,
      'status', NEW.status,
      'oldStatus', OLD.status,
      'previous', jsonb_build_object(
        'name', OLD.name,
        'status', OLD.status
      )
    ),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for domain changes
DROP TRIGGER IF EXISTS trigger_log_domain_change ON domains;
CREATE TRIGGER trigger_log_domain_change
AFTER INSERT OR UPDATE ON domains
FOR EACH ROW
EXECUTE FUNCTION log_domain_change();

-- Function to log content changes
CREATE OR REPLACE FUNCTION log_content_change()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id TEXT;
BEGIN
  -- Get org_id from domains table
  SELECT org_id INTO v_org_id FROM domains WHERE id = NEW.domain_id LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO activity_log (
    id, org_id, domain_id, user_id, action, entity_type, entity_id,
    metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_org_id,
    NEW.domain_id,
    COALESCE(current_setting('app.user_id', true), 'system'),
    CASE
      WHEN TG_OP = 'INSERT' THEN 'created'
      WHEN TG_OP = 'UPDATE' THEN 'updated'
      WHEN TG_OP = 'DELETE' THEN 'deleted'
    END,
    'content',
    NEW.id,
    jsonb_build_object(
      'title', NEW.title,
      'status', NEW.status,
      'contentType', NEW.content_type,
      'oldStatus', OLD.status,
      'previous', jsonb_build_object(
        'title', OLD.title,
        'status', OLD.status
      )
    ),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for content changes
DROP TRIGGER IF EXISTS trigger_log_content_change ON content_items;
CREATE TRIGGER trigger_log_content_change
AFTER INSERT OR UPDATE ON content_items
FOR EACH ROW
EXECUTE FUNCTION log_content_change();
