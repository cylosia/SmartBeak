# SmartBeak Scripts

## validate-env.ts

Validates that all required environment variables are set before deployment.

```bash
# Run validation
npx tsx scripts/validate-env.ts

# Or use npm script
npm run validate-env
```

This script checks for:
- Database connection string
- Clerk authentication keys
- Stripe payment keys
- Warns about optional third-party integrations

Exit codes:
- 0: All required variables are set
- 1: Missing required variables
