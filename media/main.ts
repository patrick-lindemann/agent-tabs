import { WebviewContext } from './terminal';

try {
  const ctx = new WebviewContext();
  ctx.initialize();
} catch (error) {
  console.error('Failed to initialize webview:', error);
}
