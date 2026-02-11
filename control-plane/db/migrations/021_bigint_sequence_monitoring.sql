-- =====================================================
-- P2 DATABASE OPTIMIZATION: BigInt Primary Key Monitoring
-- Issue: BigInt Primary Key Monitoring (2 issues)
--
-- Sequence exhaustion monitoring:
-- - Tracks sequence utilization approaching max value
-- - Creates alerts at 80% threshold
-- - Monitors both integer and bigint sequences
-- - Prevents overflow incidents
-- =====================================================

BEGIN;

-- =====================================================
-- 1. SEQUENCE MONITORING TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS sequence_monitoring_alerts (
  id BIGSERIAL PRIMARY KEY,
  sequence_name TEXT NOT NULL,
  data_type TEXT NOT NULL,
  current_value BIGINT NOT NULL,
  max_value BIGINT NOT NULL,
  utilization_percent NUMERIC(5,2) NOT NULL,
  threshold_percent INTEGER NOT NULL DEFAULT 80,
  alert_level TEXT NOT NULL CHECK (alert_level IN ('INFO', 'WARNING', 'CRITICAL')),
  table_name TEXT,
  column_name TEXT DEFAULT 'id',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  notes TEXT
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_sequence_alerts_created 
  ON sequence_monitoring_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sequence_alerts_unacknowledged 
  ON sequence_monitoring_alerts(sequence_name, created_at) 
  WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sequence_alerts_level 
  ON sequence_monitoring_alerts(alert_level, created_at DESC) 
  WHERE acknowledged_at IS NULL;

COMMENT ON TABLE sequence_monitoring_alerts IS 
  'Alerts for sequence utilization approaching maximum values (threshold: 80%)';

-- =====================================================
-- 2. SEQUENCE HEALTH MONITORING VIEW
-- =====================================================

CREATE OR REPLACE VIEW v_sequence_health AS
SELECT 
  sequencename as sequence_name,
  data_type,
  start_value::bigint as start_value,
  minimum_value::bigint as minimum_value,
  maximum_value::bigint as max_value,
  COALESCE(
    (SELECT last_value FROM pg_sequences ps 
     WHERE ps.sequencename = pg_sequences.sequencename 
     AND ps.schemaname = pg_sequences.schemaname),
    0
  ) as current_value,
  maximum_value::bigint - COALESCE(
    (SELECT last_value FROM pg_sequences ps 
     WHERE ps.sequencename = pg_sequences.sequencename 
     AND ps.schemaname = pg_sequences.schemaname),
    0
  )::bigint as remaining_values,
  CASE 
    WHEN maximum_value > 0 THEN 
      ROUND(
        COALESCE(
          (SELECT last_value FROM pg_sequences ps 
           WHERE ps.sequencename = pg_sequences.sequencename 
           AND ps.schemaname = pg_sequences.schemaname),
          0
        )::numeric / maximum_value::numeric * 100, 
        6
      )
    ELSE 0 
  END as utilization_percent,
  CASE
    WHEN data_type = 'bigint' THEN 9223372036854775807
    WHEN data_type = 'integer' THEN 2147483647
    WHEN data_type = 'smallint' THEN 32767
    ELSE maximum_value::bigint
  END as effective_max_value,
  cycle_option,
  pg_sequences.schemaname
FROM pg_sequences
WHERE pg_sequences.schemaname = 'public'
ORDER BY 
  CASE 
    WHEN data_type = 'integer' THEN 1  -- Check integers first (more likely to exhaust)
    WHEN data_type = 'bigint' THEN 2
    ELSE 3
  END,
  utilization_percent DESC;

COMMENT ON VIEW v_sequence_health IS 
  'Real-time sequence utilization and health status';

-- =====================================================
-- 3. SEQUENCE UTILIZATION CHECK FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION check_sequence_utilization(
  p_threshold_percent INTEGER DEFAULT 80
)
RETURNS TABLE (
  sequence_name TEXT,
  data_type TEXT,
  current_value BIGINT,
  max_value BIGINT,
  utilization_percent NUMERIC,
  alert_level TEXT,
  remaining BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.sequence_name,
    v.data_type,
    v.current_value,
    v.max_value,
    v.utilization_percent,
    CASE 
      WHEN v.utilization_percent >= 95 THEN 'CRITICAL'
      WHEN v.utilization_percent >= p_threshold_percent THEN 'WARNING'
      ELSE 'OK'
    END::TEXT as alert_level,
    v.remaining_values as remaining
  FROM v_sequence_health v
  WHERE v.utilization_percent >= p_threshold_percent - 10  -- Include those near threshold
  ORDER BY v.utilization_percent DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_sequence_utilization IS 
  'Returns sequences with utilization >= threshold-10%, sorted by risk';

-- =====================================================
-- 4. SEQUENCE ALERT GENERATION FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION generate_sequence_alerts(
  p_threshold_percent INTEGER DEFAULT 80
)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_alert_level TEXT;
  v_rec RECORD;
BEGIN
  FOR v_rec IN 
    SELECT * FROM check_sequence_utilization(p_threshold_percent)
    WHERE alert_level IN ('WARNING', 'CRITICAL')
  LOOP
    -- Determine alert level
    IF v_rec.utilization_percent >= 95 THEN
      v_alert_level := 'CRITICAL';
    ELSIF v_rec.utilization_percent >= p_threshold_percent THEN
      v_alert_level := 'WARNING';
    ELSE
      CONTINUE;  -- Skip if not at threshold
    END IF;
    
    -- Check if unacknowledged alert already exists
    IF NOT EXISTS (
      SELECT 1 FROM sequence_monitoring_alerts 
      WHERE sequence_monitoring_alerts.sequence_name = v_rec.sequence_name
        AND acknowledged_at IS NULL
        AND alert_level = v_alert_level
        AND created_at > NOW() - INTERVAL '24 hours'
    ) THEN
      INSERT INTO sequence_monitoring_alerts (
        sequence_name,
        data_type,
        current_value,
        max_value,
        utilization_percent,
        threshold_percent,
        alert_level,
        notes
      ) VALUES (
        v_rec.sequence_name,
        v_rec.data_type,
        v_rec.current_value,
        v_rec.max_value,
        v_rec.utilization_percent,
        p_threshold_percent,
        v_alert_level,
        CASE 
          WHEN v_rec.utilization_percent >= 99 THEN 
            'URGENT: Sequence near exhaustion. Plan migration immediately.'
          WHEN v_rec.utilization_percent >= 95 THEN 
            'CRITICAL: Sequence approaching maximum. Schedule maintenance window.'
          ELSE 
            'WARNING: Sequence utilization above threshold. Monitor closely.'
        END
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;
  
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION generate_sequence_alerts IS 
  'Generates alerts for sequences above threshold. Returns count of new alerts.';

-- =====================================================
-- 5. ACKNOWLEDGE ALERT FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION acknowledge_sequence_alert(
  p_alert_id BIGINT,
  p_acknowledged_by TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE sequence_monitoring_alerts
  SET acknowledged_at = NOW(),
      acknowledged_by = p_acknowledged_by,
      notes = COALESCE(p_notes, notes)
  WHERE id = p_alert_id
    AND acknowledged_at IS NULL;
    
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION acknowledge_sequence_alert IS 
  'Acknowledge a sequence alert by ID. Returns true if successful.';

-- =====================================================
-- 6. SEQUENCE RESET ESTIMATION FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION estimate_sequence_reset_date(
  p_sequence_name TEXT,
  p_sample_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  sequence_name TEXT,
  current_value BIGINT,
  max_value BIGINT,
  daily_growth_rate NUMERIC,
  estimated_days_remaining INTEGER,
  estimated_exhaustion_date DATE,
  recommended_action TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH growth AS (
    SELECT 
      (MAX(current_value) - MIN(current_value))::numeric / NULLIF(p_sample_days, 0) as daily_rate
    FROM sequence_monitoring_alerts
    WHERE sequence_monitoring_alerts.sequence_name = p_sequence_name
      AND created_at > NOW() - (p_sample_days || ' days')::INTERVAL
  )
  SELECT 
    v.sequence_name,
    v.current_value,
    v.max_value,
    ROUND(COALESCE(g.daily_rate, 0), 2) as daily_growth_rate,
    CASE 
      WHEN COALESCE(g.daily_rate, 0) > 0 
      THEN ((v.max_value - v.current_value) / g.daily_rate)::INTEGER
      ELSE NULL
    END as estimated_days_remaining,
    CASE 
      WHEN COALESCE(g.daily_rate, 0) > 0 
      THEN (NOW() + (((v.max_value - v.current_value) / g.daily_rate) || ' days')::INTERVAL)::DATE
      ELSE NULL
    END as estimated_exhaustion_date,
    CASE
      WHEN v.utilization_percent >= 95 THEN 'URGENT: Schedule immediate migration'
      WHEN v.utilization_percent >= 80 THEN 'PLAN: Prepare sequence migration strategy'
      WHEN COALESCE(g.daily_rate, 0) = 0 THEN 'MONITOR: Insufficient data for estimation'
      WHEN ((v.max_value - v.current_value) / g.daily_rate) < 90 THEN 'WARN: Exhaustion within 90 days'
      ELSE 'OK: Sequence healthy'
    END as recommended_action
  FROM v_sequence_health v
  CROSS JOIN growth g
  WHERE v.sequence_name = p_sequence_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION estimate_sequence_reset_date IS 
  'Estimates when a sequence will exhaust based on historical growth rate';

-- =====================================================
-- 7. HIGH-PRIORITY SEQUENCES VIEW
-- =====================================================

CREATE OR REPLACE VIEW v_critical_sequences AS
SELECT 
  v.*,
  CASE
    WHEN v.data_type = 'integer' AND v.utilization_percent > 50 THEN true
    WHEN v.utilization_percent > 80 THEN true
    ELSE false
  END as requires_attention,
  CASE
    WHEN v.data_type = 'integer' THEN 'MEDIUM'
    WHEN v.max_value >= 9223372036854775807 THEN 'LOW'
    ELSE 'MEDIUM'
  END as risk_level
FROM v_sequence_health v
WHERE v.utilization_percent > 50  -- Focus on sequences over 50%
   OR v.data_type = 'integer'     -- Or any integer sequence
ORDER BY 
  CASE v.data_type WHEN 'integer' THEN 0 ELSE 1 END,
  v.utilization_percent DESC;

COMMENT ON VIEW v_critical_sequences IS 
  'Sequences requiring attention, prioritized by data type and utilization';

COMMIT;

-- =====================================================
-- USAGE EXAMPLES
-- =====================================================

/*
-- Check all sequence utilization:
SELECT * FROM check_sequence_utilization(80);

-- View high-risk sequences:
SELECT * FROM v_critical_sequences;

-- Generate new alerts:
SELECT generate_sequence_alerts(80) as new_alerts_created;

-- View unacknowledged alerts:
SELECT * FROM sequence_monitoring_alerts 
WHERE acknowledged_at IS NULL 
ORDER BY utilization_percent DESC;

-- Estimate when a sequence will exhaust:
SELECT * FROM estimate_sequence_reset_date('content_items_id_seq', 30);

-- Acknowledge an alert:
SELECT acknowledge_sequence_alert(1, 'admin@example.com', 'Planned migration scheduled');
*/
