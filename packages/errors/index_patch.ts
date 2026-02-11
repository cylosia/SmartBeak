// Patch helper
import fs from 'fs';
import { getLogger } from '../kernel/logger';

const logger = getLogger('ErrorPatch');
const content = fs.readFileSync('packages/errors/index.ts', 'utf8');
const newContent = content.replace(
  /let code = ErrorCodes\.DATABASE_ERROR;/,
  "let code: string = ErrorCodes.DATABASE_ERROR;"
);
fs.writeFileSync('packages/errors/index.ts', newContent);
logger.info('Fixed packages/errors/index.ts');
