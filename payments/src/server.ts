import { createApp } from '@/app';
import { getEnv } from '@/config/env';

async function start() {
  const { PORT } = getEnv();
  const { app } = createApp();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`PayHole payments service listening on port ${PORT}`);
  });
}

void start();

