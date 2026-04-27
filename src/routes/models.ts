import { Hono } from 'hono';
import type { AppEnv, ModelObject, ModelsListResponse } from '../types.js';
import { getModelsForKey } from '../services/config-store.js';

function buildModelObjects(modelIds: string[]): ModelObject[] {
  const now = Math.floor(Date.now() / 1000);
  return modelIds.map((id) => ({
    id,
    object: 'model' as const,
    created: now,
    owned_by: 'nexus-codex',
  }));
}

const modelsRoute = new Hono<AppEnv>();

modelsRoute.get('/models', (c) => {
  const apiKey = c.get('apiKey');
  const response: ModelsListResponse = {
    object: 'list',
    data: buildModelObjects(getModelsForKey(apiKey)),
  };
  return c.json(response);
});

modelsRoute.get('/models/:modelId', (c) => {
  const apiKey = c.get('apiKey');
  const modelId = c.req.param('modelId');
  const models = buildModelObjects(getModelsForKey(apiKey));
  const model = models.find((m) => m.id === modelId);
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
