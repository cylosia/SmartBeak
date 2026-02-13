-- Migration: Sequence exhaustion monitoring
-- P2-MEDIUM FIX: Add monitoring for sequence exhaustion
-- Created: 2026-02-10

-- Function to check sequence usage and alert on high utilization
CREATE OR REPLACE FUNCTION check_sequence_utilization()
RETURNS TABLE (
    sequence_name text,
    current_value bigint,
    max_value bigint,
    utilization_percent numeric,
    status text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sequencename::text,
        COALESCE(last_value, 0) as current_value,
        max_value,
        ROUND((COALESCE(last_value, 0)::numeric / NULLIF(max_value, 0)::numeric) * 100, 2) as utilization_percent,
        CASE 
            WHEN COALESCE(last_value, 0)::numeric / NULLIF(max_value, 0)::numeric > 0.9 THEN 'CRITICAL'
            WHEN COALESCE(last_value, 0)::numeric / NULLIF(max_value, 0)::numeric > 0.75 THEN 'WARNING'
            ELSE 'OK'
        END as status
    FROM pg_sequences
    WHERE schemaname = 'public'
      AND max_value IS NOT NULL
    ORDER BY utilization_percent DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for monitoring sequence health
CREATE OR REPLACE VIEW sequence_health_monitor AS
SELECT 
    sequence_name,
    data_type,
    start_value,
    minimum_value,
    maximum_value,
    increment,
    cycle_option,
    COALESCE(
        (SELECT last_value FROM pg_sequences ps WHERE ps.sequencename = pg_sequences.sequencename),
        0
    ) as current_value,
    CASE 
        WHEN data_type = 'bigint' THEN 9223372036854775807
        WHEN data_type = 'integer' THEN 2147483647
        WHEN data_type = 'smallint' THEN 32767
        ELSE maximum_value
    END as effective_max_value
FROM pg_sequences
WHERE schemaname = 'public';

-- Table to store sequence monitoring alerts
CREATE TABLE IF NOT EXISTS sequence_monitoring_alerts (
    id SERIAL PRIMARY KEY,
    sequence_name TEXT NOT NULL,
    current_value BIGINT NOT NULL,
    max_value BIGINT NOT NULL,
    utilization_percent NUMERIC(5,2) NOT NULL,
    alert_level TEXT NOT NULL CHECK (alert_level IN ('WARNING', 'CRITICAL')),
    created_at TIMESTAMP DEFAULT NOW(),
    acknowledged_at TIMESTAMP,
    acknowledged_by TEXT
);

-- Index for efficient alert queries
CREATE INDEX IF NOT EXISTS idx_sequence_alerts_created_at 
    ON sequence_monitoring_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sequence_alerts_unacknowledged 
    ON sequence_monitoring_alerts(sequence_name, created_at) 
    WHERE acknowledged_at IS NULL;

-- Function to trigger sequence alert
CREATE OR REPLACE FUNCTION trigger_sequence_alert()
RETURNS TRIGGER AS $$
DECLARE
    v_max_value BIGINT;
    v_current_value BIGINT;
    v_utilization NUMERIC;
BEGIN
    -- Get sequence info
    SELECT maximum_value, COALESCE(last_value, 0)
    INTO v_max_value, v_current_value
    FROM pg_sequences
    WHERE sequencename = TG_TABLE_NAME || '_id_seq'
      AND schemaname = 'public';
    
    IF v_max_value IS NOT NULL AND v_max_value > 0 THEN
        v_utilization := (v_current_value::numeric / v_max_value::numeric) * 100;
        
        -- Insert alert if utilization is high
        IF v_utilization > 75 THEN
            INSERT INTO sequence_monitoring_alerts (
                sequence_name, current_value, max_value, 
                utilization_percent, alert_level
            ) VALUES (
                TG_TABLE_NAME || '_id_seq',
                v_current_value,
                v_max_value,
                v_utilization,
                CASE WHEN v_utilization > 90 THEN 'CRITICAL' ELSE 'WARNING' END
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION check_sequence_utilization() TO monitoring_role;
GRANT SELECT ON sequence_health_monitor TO monitoring_role;

COMMENT ON FUNCTION check_sequence_utilization() IS 
    'Returns sequence utilization percentages for monitoring exhaustion risk';
COMMENT ON VIEW sequence_health_monitor IS 
    'Monitoring view for sequence health and exhaustion prevention';
