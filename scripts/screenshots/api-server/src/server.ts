import express from 'express';
import { config } from './config';
import { limitRequests } from './middleware/rateLimit';
import { auth } from './routes/auth';

const app = express();
app.use(express.json());
app.use('/auth', limitRequests('/auth/login'), auth);

app.listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});
