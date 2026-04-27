/**
 * 模型注册表：统一管理可用模型白名单。
 *
 * 底层数据由 config-store 持久化到 data/config.json。
 * 本模块提供面向路由层的便捷查询接口。
 */

export {
  getDefaultModels,
  getModelsForKey,
  isModelAllowedForKey,
  addDefaultModel,
  removeDefaultModel,
  setDefaultModels,
} from './config-store.js';
