
import { validateExperiment } from '../src/domain/experiments/validateExperiment';
test('experiment rejects mismatched intent', () => {
  expect(() =>
  validateExperiment([
    { intent: 'info', contentType: 'page' },
    { intent: 'commercial', contentType: 'page' }
  ])
  ).toThrow();
});
