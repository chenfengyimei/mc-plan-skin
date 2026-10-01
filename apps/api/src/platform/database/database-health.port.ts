export interface DatabaseHealthCheck {
  ok: boolean;
  connection: 'up' | 'down';
  migrations: 'current' | 'missing' | 'failed';
}

export const DATABASE_HEALTH = Symbol('DATABASE_HEALTH');

export interface DatabaseHealthPort {
  check(): Promise<DatabaseHealthCheck>;
}
