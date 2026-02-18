-- Rollback: drop feedback_metrics table and associated objects
DROP TRIGGER IF EXISTS set_feedback_metrics_updated_at ON feedback_metrics;
DROP FUNCTION IF EXISTS trigger_set_feedback_metrics_updated_at();
DROP TABLE IF EXISTS feedback_metrics;
