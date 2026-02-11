# Contribution Guidelines

## Welcome Contributors!

Thank you for your interest in contributing to SmartBeak! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Submitting Changes](#submitting-changes)
- [Review Process](#review-process)

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Respect differing viewpoints

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Personal attacks
- Publishing private information

## Getting Started

### Prerequisites

1. Read [Local Development Setup](./local-development-setup.md)
2. Read [Testing Guide](./testing-guide.md)
3. Read [System Architecture](../architecture/system-architecture.md)
4. Join our Slack #contributors channel

### First Contribution Ideas

Look for issues labeled:
- `good first issue` - Great for newcomers
- `help wanted` - Extra assistance needed
- `documentation` - Documentation improvements
- `bug` - Bug fixes

## Development Workflow

### 1. Fork and Clone

```bash
# Fork the repository on GitHub
git clone https://github.com/YOUR_USERNAME/smartbeak.git
cd smartbeak
git remote add upstream https://github.com/smartbeak/smartbeak.git
```

### 2. Create a Branch

```bash
# Sync with main
git fetch upstream
git checkout main
git merge upstream/main

# Create feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b bugfix/issue-description
```

Branch naming conventions:
- `feature/description` - New features
- `bugfix/description` - Bug fixes
- `hotfix/description` - Production hotfixes
- `chore/description` - Maintenance
- `docs/description` - Documentation
- `refactor/description` - Code refactoring

### 3. Make Changes

#### Before You Start

- Check if an issue exists for your change
- Comment on the issue to claim it
- Discuss significant changes in Slack first

#### While Developing

```bash
# Run linting
npm run lint

# Run type checking
npm run type-check

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### 4. Commit Changes

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Code style (formatting, semicolons)
- `refactor` - Code refactoring
- `perf` - Performance improvements
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

Scopes (examples):
- `content` - Content domain
- `publishing` - Publishing domain
- `api` - API routes
- `web` - Web application
- `auth` - Authentication
- `billing` - Billing/payments

Examples:
```
feat(content): add bulk archive functionality

fix(publishing): resolve race condition in job queue

docs(api): add authentication examples

refactor(auth): simplify permission checking

test(publishing): add integration tests for job retries

chore(deps): update typescript to 5.3
```

Commit frequently with descriptive messages:

```bash
git add .
git commit -m "feat(content): add content scheduling API

- Add scheduled_at column to content_items
- Implement scheduler worker
- Add validation for past dates

Closes #123"
```

### 5. Push and Create PR

```bash
# Push branch
git push origin feature/your-feature-name

# Create PR via GitHub CLI (optional)
gh pr create --title "feat: description" --body "Details..."
```

## Code Standards

### TypeScript Style Guide

#### General

- Use TypeScript for all new code
- Enable strict mode
- Avoid `any` type
- Use explicit return types on public APIs

```typescript
// Good
async function getContent(id: string): Promise<ContentItem> {
  return await db.content.findById(id);
}

// Bad
async function getContent(id) {
  return await db.content.findById(id);
}
```

#### Naming Conventions

```typescript
// Classes: PascalCase
class ContentRepository { }

// Interfaces: PascalCase with I prefix (optional)
interface IContentRepository { }

// Types: PascalCase
type ContentStatus = 'draft' | 'published' | 'archived';

// Enums: PascalCase, members UPPER_SNAKE_CASE
enum ContentType {
  ARTICLE = 'article',
  VIDEO = 'video',
}

// Variables: camelCase
const contentItem = await repository.findById(id);

// Constants: UPPER_SNAKE_CASE
const MAX_RETRY_ATTEMPTS = 3;

// Functions: camelCase, verb prefix
async function fetchContentById(id: string) { }

// Booleans: is/has/should prefix
const isPublished = content.status === 'published';
const hasErrors = errors.length > 0;
```

#### File Organization

```typescript
// Import order:
// 1. External dependencies
// 2. Internal absolute imports
// 3. Relative imports
// 4. Type-only imports

import React from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth';
import { ContentService } from '@/services/content';

import { ContentCard } from './ContentCard';
import type { ContentItem } from './types';
```

### Domain-Driven Design

Follow our architectural principles:

```
domains/[domain]/
├── application/        # Use cases
│   ├── handlers/       # Command/query handlers
│   └── ports/          # Repository interfaces
├── domain/             # Core business logic
│   ├── entities/       # Domain entities
│   └── events/         # Domain events
└── infra/              # Infrastructure
    └── persistence/    # Repository implementations
```

### Error Handling

```typescript
// Use custom error classes
class ContentNotFoundError extends Error {
  constructor(contentId: string) {
    super(`Content not found: ${contentId}`);
    this.name = 'ContentNotFoundError';
  }
}

// In API routes
try {
  const content = await service.getContent(id);
  return res.json(content);
} catch (error) {
  if (error instanceof ContentNotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  logger.error('Failed to get content', { error, contentId: id });
  return res.status(500).json({ error: 'Internal server error' });
}
```

### Testing Requirements

All code must include tests:

```typescript
// Unit tests for domain logic
describe('ContentItem', () => {
  it('should validate title length', () => {
    expect(() => {
      ContentItem.create({ title: '' });
    }).toThrow('Title is required');
  });
});

// Integration tests for repositories
describe('PostgresContentRepository', () => {
  it('should persist and retrieve content', async () => {
    const content = ContentItem.create({ title: 'Test' });
    await repository.save(content);
    
    const retrieved = await repository.findById(content.id);
    expect(retrieved.title).toBe('Test');
  });
});
```

### Documentation

- JSDoc for public APIs
- README updates for new features
- Architecture Decision Records (ADRs) for significant changes

```typescript
/**
 * Creates a new publishing job for the given content.
 * 
 * @param contentId - The ID of the content to publish
 * @param targets - Array of publishing targets
 * @returns The created publishing job
 * @throws ContentNotFoundError if content doesn't exist
 * @throws ValidationError if targets are invalid
 * 
 * @example
 * const job = await createJob('content_123', [
 *   { type: 'wordpress', siteId: 'site_456' }
 * ]);
 */
async function createJob(
  contentId: string,
  targets: PublishingTarget[]
): Promise<PublishingJob> { }
```

## Submitting Changes

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## How Has This Been Tested?
- [ ] Unit tests
- [ ] Integration tests
- [ ] Manual testing

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] All tests pass

## Related Issues
Fixes #123
```

### PR Description Guidelines

1. **What** - What changes were made
2. **Why** - Why were these changes needed
3. **How** - How were the changes implemented
4. **Testing** - How was this tested

Example:
```markdown
## Description
Implements bulk content archive functionality allowing users to archive multiple content items at once.

## Changes
- Added POST /api/content/bulk-archive endpoint
- Created BulkArchiveService for handling archive operations
- Added UI components for bulk selection
- Implemented progress tracking for large operations

## Testing
- Unit tests for BulkArchiveService
- Integration tests for API endpoint
- E2E tests for UI flow
- Tested with 1000+ items

## Screenshots
[Attach screenshots if UI changes]
```

## Review Process

### What We Look For

1. **Correctness** - Does it work as intended?
2. **Tests** - Are there adequate tests?
3. **Style** - Does it follow code standards?
4. **Documentation** - Is it documented?
5. **Performance** - Any performance concerns?
6. **Security** - Any security implications?

### Review Response Time

- Initial review: Within 24 hours
- Follow-up reviews: Within 4 hours
- Urgent fixes: As soon as possible

### Addressing Feedback

```bash
# Make requested changes
git add .
git commit -m "refactor: address PR feedback

- Rename variable for clarity
- Extract helper function
- Add additional test case"

# Push updates
git push origin feature/your-feature-name
```

### Merging

- PRs require 2 approvals
- All CI checks must pass
- Branch must be up to date with main
- Use "Squash and merge" for clean history

## Release Process

We follow semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR** - Breaking changes
- **MINOR** - New features (backwards compatible)
- **PATCH** - Bug fixes

Release checklist:
- [ ] Version bumped
- [ ] CHANGELOG.md updated
- [ ] Migration scripts tested
- [ ] Documentation updated
- [ ] Tag created
- [ ] Deployed to staging
- [ ] Smoke tests pass
- [ ] Deployed to production

## Getting Help

- **General questions:** #dev-help Slack channel
- **Architecture questions:** #architecture Slack channel
- **Code review help:** @mention maintainers in PR
- **Urgent issues:** Page on-call engineer

## Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Invited to team events

## License

By contributing, you agree that your contributions will be licensed under the project's license.

---

Thank you for contributing to SmartBeak! 🎉
