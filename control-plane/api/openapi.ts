export const openapi = {
  openapi: '3.0.0',
  info: { title: 'ACP Control Plane', version: '1.0.0' },
  paths: {
  '/content/{id}/publish': {
    post: {
    summary: 'Publish content',
    parameters: [{ name: 'id', in: 'path', required: true }],
    responses: { '200': { description: 'OK' } }
    }
  }
  }
};
