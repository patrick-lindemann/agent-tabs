import { Router } from 'express';

export const auth = Router();

auth.post('/login', (request, response) => {
  response.json({ token: 'example' });
});
