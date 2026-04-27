import { Hono } from 'hono';
import type { ModelsListResponse } from '../types.js';

const modelsRoute = new Hono();

const AVAILABLE_MODELS: ModelsListResponse = {
  object: 'list',
  data: [
    {
      id: 'codex-plus',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'nexus-codex',
    },
  ],
};

modelsRoute.get('/models', (c) => {
  return c.json(AVAILABLE_MODELS);
});

modelsRoute.get('/models/:modelId', (c) => {
  const modelId = c.req.param('modelId');
  const model = AVAILABLE_MODELS.data.find((m) => m.id === modelId);
  if (!model) {
    return c.json(
      {
        error: {
          message: `The model '${modelId}' does not exist.`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      },
      404,
    );
  }
  return c.json(model);
});

export default modelsRoute;
