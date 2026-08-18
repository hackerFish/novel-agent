import { Router } from 'express';
import { getConfig, setConfig } from '../config.js';
import { checkOllama } from '../llm/adapter.js';

export const configRouter = Router();

configRouter.get('/', (_, res) => {
  res.json(getConfig());
});

configRouter.post('/', (req, res) => {
  const updated = setConfig(req.body || {});
  res.json(updated);
});

configRouter.get('/ollama', async (_, res) => {
  try {
    const result = await checkOllama();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});
