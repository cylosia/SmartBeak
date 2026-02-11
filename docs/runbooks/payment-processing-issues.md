# Runbook: Payment Processing Issues

## Overview

This runbook covers the procedures for handling payment processing failures with Stripe and Paddle in the SmartBeak platform.

## Payment Providers

| Provider | Usage | Environment Variables |
|----------|-------|----------------------|
| Stripe | Primary payment processor | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Paddle | Alternative payment processor | `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` |

## Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| P0 | No payment processing possible, checkout completely broken | Immediate |
| P1 | Payment success rate degraded (< 95%) | 15 minutes |
| P2 | Webhook processing delays or failures | 30 minutes |
| P3 | Invoice/payment record inconsistencies | 2 hours |

## Symptoms

- Users unable to complete checkout
- "Payment failed" errors during subscription
- Webhook delivery failures in Stripe/Paddle dashboard
- Subscription status not updating after payment
- Discrepancy between payment gateway and internal records
- Duplicate charges

## Prerequisites

- Access to Stripe Dashboard: https://dashboard.stripe.com
- Access to Paddle Dashboard: https://vendors.paddle.com
- Webhook endpoint secrets
- Admin API access

## Procedures

### 1. Immediate Assessment

#### 1.1 Check Payment Provider Status

```bash
# Check Stripe API status
curl https://api.stripe.com/v1/status \
  -H "Authorization: Bearer $STRIPE_SECRET_KEY"

# Or check Stripe status page
open https://status.stripe.com

# Check Paddle API status
open https://status.paddle.com
```

#### 1.2 Verify Webhook Endpoints

**Stripe:**
```bash
# List webhook endpoints
curl https://api.stripe.com/v1/webhook_endpoints \
  -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
  -s | jq '.data[] | {id, url, status}'

# Check recent webhook deliveries
curl https://api.stripe.com/v1/events?limit=10 \
  -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
  -s | jq '.data[] | {id, type, created, pending_webhooks}'
```

**Paddle:**
```bash
# Verify webhook configuration in Paddle dashboard
# Settings > Developer Tools > Alerts/Webhooks
```

#### 1.3 Check Application Logs

```bash
# Filter for payment-related errors
tail -f /var/log/smartbeak/api.log | grep -i "stripe\|paddle\|payment\|billing\|webhook"

# Or using structured logging
jq 'select(.message | contains("stripe", "paddle", "payment"))' /var/log/smartbeak/api.log
```

### 2. Common Issues and Resolution

#### 2.1 Webhook Signature Verification Failures

**Symptoms:**
- Webhook endpoint returning 400 errors
- "Invalid signature" in logs
- Events not being processed

**Diagnosis:**
```bash
# Check webhook secret configuration
echo $STRIPE_WEBHOOK_SECRET
echo $PADDLE_WEBHOOK_SECRET

# Verify endpoint is receiving requests
curl https://api.smartbeak.io/v1/admin/webhooks/stripe/log \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Resolution:**

1. **Verify webhook secrets match:**
   ```bash
   # Compare configured secret with Stripe dashboard
   # Stripe Dashboard > Developers > Webhooks > Signing secret
   
   # Update if needed
   vercel env add STRIPE_WEBHOOK_SECRET production
   # or
   kubectl set env deployment/api STRIPE_WEBHOOK_SECRET="whsec_..."
   ```

2. **Test webhook delivery:**
   ```bash
   # Stripe CLI for testing
   stripe trigger payment_intent.succeeded
   
   # Or send test event via API
   curl -X POST https://api.stripe.com/v1/webhook_endpoints/<endpoint_id>/test \
     -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
     -d "type=invoice.payment_succeeded"
   ```

#### 2.2 Payment Intent Failures

**Symptoms:**
- Checkout page shows payment errors
- `payment_intent.payment_failed` events
- Users report cards being declined

**Diagnosis:**
```bash
# Check recent failed payments
curl "https://api.stripe.com/v1/payment_intents?status=requires_payment_method&limit=10" \
  -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
  -s | jq '.data[] | {id, status, last_payment_error}'

# Check specific payment intent
curl https://api.stripe.com/v1/payment_intents/<payment_intent_id> \
  -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
  -s | jq '.last_payment_error'
```

**Resolution:**

1. **Review decline codes:**
   | Decline Code | Meaning | Action |
   |--------------|---------|--------|
   | `insufficient_funds` | Card has insufficient funds | User needs to use different card |
   | `expired_card` | Card is expired | User needs to update card |
   | `incorrect_cvc` | CVC check failed | User needs to retry with correct CVC |
   | `processing_error` | Gateway error | Retry may succeed |
   | `issuer_not_available` | Bank unavailable | Retry may succeed |

2. **Check if specific to certain card types:**
   ```sql
   -- Query control plane database
   SELECT 
     payment_method_type,
     decline_code,
     COUNT(*)
   FROM payment_attempts
   WHERE created_at > NOW() - INTERVAL '1 hour'
     AND status = 'failed'
   GROUP BY payment_method_type, decline_code;
   ```

3. **Enable retry logic if not already enabled:**
   ```typescript
   // In payment configuration
   const paymentIntent = await stripe.paymentIntents.create({
     amount: 2000,
     currency: 'usd',
     customer: customerId,
     automatic_payment_methods: { enabled: true },
     // Enable retries for specific decline codes
     payment_method_options: {
       card: {
         request_three_d_secure: 'automatic',
       },
     },
   });
   ```

#### 2.3 Subscription Status Mismatch

**Symptoms:**
- User paid but subscription not active in system
- Webhook processed but status not updated
- Grace period not being applied

**Diagnosis:**
```bash
# Check Stripe subscription status
curl https://api.stripe.com/v1/subscriptions/<subscription_id> \
  -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
  -s | jq '{id, status, current_period_end, cancel_at_period_end}'

# Check internal subscription status
curl https://api.smartbeak.io/v1/admin/subscriptions/<subscription_id> \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Resolution:**

1. **Sync subscription status:**
   ```bash
   # Force sync from Stripe
   curl -X POST https://api.smartbeak.io/v1/admin/subscriptions/sync \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "subscription_id": "<subscription_id>",
       "source": "stripe"
     }'
   ```

2. **Replay missing webhooks:**
   ```bash
   # Get missed events from Stripe
   curl "https://api.stripe.com/v1/events?type=invoice.payment_succeeded&created[gte]=<timestamp>" \
     -H "Authorization: Bearer $STRIPE_SECRET_KEY"
   
   # Manually process specific event
   curl -X POST https://api.smartbeak.io/v1/admin/webhooks/replay \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "event_id": "evt_...",
       "provider": "stripe"
     }'
   ```

3. **Grant manual access if needed:**
   ```bash
   # Emergency: Grant access while investigating
   curl -X POST https://api.smartbeak.io/v1/admin/subscriptions/grant-access \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "user_id": "<user_id>",
       "reason": "Payment processed but webhook missed - INCIDENT-123",
       "duration_hours": 24
     }'
   ```

#### 2.4 Duplicate Charges

**Symptoms:**
- Customer charged multiple times for same subscription period
- Multiple payment intents for single checkout

**Diagnosis:**
```bash
# Check for duplicate payment intents
curl "https://api.stripe.com/v1/payment_intents?customer=<customer_id>&limit=20" \
  -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
  -s | jq '.data[] | {id, amount, status, created, metadata}'

# Check idempotency key usage
# Review logs for idempotency-key header
```

**Resolution:**

1. **Refund duplicate charges:**
   ```bash
   # Create refund for duplicate charge
   curl -X POST https://api.stripe.com/v1/refunds \
     -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
     -d "payment_intent=<duplicate_payment_intent_id>" \
     -d "reason=duplicate"
   ```

2. **Verify idempotency key implementation:**
   ```typescript
   // Ensure idempotency keys are being used
   const paymentIntent = await stripe.paymentIntents.create(
     {
       amount: 2000,
       currency: 'usd',
       customer: customerId,
     },
     {
       idempotencyKey: `checkout-${userId}-${Date.now()}`,
     }
   );
   ```

#### 2.5 Checkout Session Failures

**Symptoms:**
- Checkout page not loading
- "Session expired" errors
- Redirect from Stripe failing

**Diagnosis:**
```bash
# Check checkout session status
curl https://api.stripe.com/v1/checkout/sessions/<session_id> \
  -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
  -s | jq '{id, status, url, expires_at, payment_status}'

# Verify API routes are responding
curl -I https://api.smartbeak.io/api/stripe/create-checkout-session
```

**Resolution:**

1. **Check checkout session configuration:**
   ```typescript
   // Ensure proper success/cancel URLs
   const session = await stripe.checkout.sessions.create({
     success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
     cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/cancel`,
     line_items: [...],
     mode: 'subscription',
     // Ensure session doesn't expire too quickly
     expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes
   });
   ```

2. **Extend session expiration if needed:**
   ```bash
   # Update expiration for specific session
   curl -X POST https://api.stripe.com/v1/checkout/sessions/<session_id>/expire \
     -H "Authorization: Bearer $STRIPE_SECRET_KEY"
   ```

### 3. Switching Payment Providers (Emergency)

If Stripe is experiencing extended outage, switch to Paddle:

```bash
# 1. Update feature flags to use Paddle
curl -X POST https://api.smartbeak.io/v1/admin/flags \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "flag": "payment_provider_primary",
    "value": "paddle",
    "reason": "Stripe outage - INCIDENT-123"
  }'

# 2. Verify Paddle configuration
curl https://api.smartbeak.io/v1/admin/billing/paddle/verify \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 3. Test checkout flow
curl -X POST https://api.smartbeak.io/v1/billing/paddle/checkout \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan": "pro", "period": "monthly"}'
```

### 4. Post-Incident Reconciliation

After payment issues are resolved:

1. **Audit all transactions during incident window:**
   ```sql
   -- List all payment attempts during incident
   SELECT 
     id,
     user_id,
     provider,
     status,
     amount,
     created_at
   FROM payment_attempts
   WHERE created_at BETWEEN '<incident_start>' AND '<incident_end>'
   ORDER BY created_at;
   ```

2. **Identify affected customers:**
   ```sql
   -- Find users with failed payments who should have active subscriptions
   SELECT DISTINCT u.id, u.email, u.subscription_status
   FROM users u
   JOIN payment_attempts pa ON pa.user_id = u.id
   WHERE pa.status = 'failed'
     AND pa.created_at BETWEEN '<incident_start>' AND '<incident_end>'
     AND u.subscription_status != 'active';
   ```

3. **Process refunds if necessary:**
   ```bash
   # Bulk refund script (use with caution)
   for payment_intent in $(cat duplicate_charges.txt); do
     curl -X POST https://api.stripe.com/v1/refunds \
       -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
       -d "payment_intent=$payment_intent" \
       -d "reason=requested_by_customer"
   done
   ```

4. **Verify all webhooks processed:**
   ```bash
   # Check for any unprocessed events
   curl https://api.smartbeak.io/v1/admin/webhooks/pending \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   
   # Process any pending
   curl -X POST https://api.smartbeak.io/v1/admin/webhooks/process-pending \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

## Communication Templates

### Internal Notification

**Subject:** [INCIDENT] Payment Processing Issues - SmartBeak

```
Severity: [P0/P1/P2]
Status: Investigating/Resolved
Impact: Payment processing [degraded/unavailable]
Start Time: [ISO timestamp]
Affected Provider: [Stripe/Paddle/Both]

Summary:
[Description of the issue]

Customer Impact:
- New subscriptions: [Status]
- Renewals: [Status]
- Refunds: [Status]

Actions Taken:
1. [Action 1]
2. [Action 2]

Next Steps:
1. [Action item 1]
2. [Action item 2]
```

### Customer Communication (if needed)

**Subject:** We're experiencing payment processing delays

```
We are currently experiencing technical difficulties with our payment processor. 

What this means:
- You may experience delays when upgrading or subscribing
- Existing subscriptions are not affected
- No charges will be duplicated

We expect to resolve this within [timeframe]. If you have any concerns about 
a recent charge, please contact support@smartbeak.io.

Thank you for your patience.
```

## Related Runbooks

- [Security Incident Response](./security-incident-response.md)
- [Deployment Rollback](./deployment-rollback.md)
- [Post-Mortem Template](../postmortems/template.md)

## References

- Stripe API Docs: https://stripe.com/docs/api
- Stripe Webhooks: https://stripe.com/docs/webhooks
- Paddle API Docs: https://developer.paddle.com/
- Paddle Webhooks: https://developer.paddle.com/webhook-reference
