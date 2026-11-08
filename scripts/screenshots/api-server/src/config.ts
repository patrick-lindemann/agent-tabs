export const config = {
  port: Number(process.env.PORT ?? 3000),
  rateLimit: {
    window: 60_000,
    max: 100,
    routes: {
      '/auth/login': { window: 60_000, max: 5 },
      '/search': { window: 10_000, max: 20 }
    } as Record<string, { window: number; max: number }>
  }
};
