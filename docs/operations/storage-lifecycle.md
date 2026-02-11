
# Storage Lifecycle Optimization

## Goals
- Reduce storage cost
- Prevent orphaned uploads
- Preserve active content performance

## Policies
- Hot storage: active media
- Cold storage: unused >30 days
- Orphaned media deleted after 7 days

## Jobs
- media-cleanup (daily)

## Guarantees
- No media deleted if referenced
- No synchronous deletions
