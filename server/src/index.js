import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { workflowRouter } from './routes/workflow.js';
import { configRouter } from './routes/config.js';
import { projectRouter } from './routes/project.js';
import { publishRouter } from './routes/publish.js';
import { bookRouter } from './routes/book.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', workflowRouter);
app.use('/api/config', configRouter);
app.use('/api/project', projectRouter);
app.use('/api/publish', publishRouter);
app.use('/api/book', bookRouter);

app.get('/api/health', (_, res) => res.json({ ok: true }));

const clientDist = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_, res, next) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });
}

app.listen(PORT, () => {
  console.log(`执笔 NovelAgent 作家服务: http://localhost:${PORT}`);
});
