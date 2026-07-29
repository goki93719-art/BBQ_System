import { createClient, type Client, type InValue, type ResultSet } from "@libsql/client";

export interface DatabaseResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: {
    changes: number;
    last_row_id?: number;
    [key: string]: unknown;
  };
}

export interface AppPreparedStatement {
  bind(...values: unknown[]): AppPreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
}

export interface AppDatabase {
  prepare(query: string): AppPreparedStatement;
  batch<T = Record<string, unknown>>(statements: AppPreparedStatement[]): Promise<DatabaseResult<T>[]>;
}

function normalizeValue(value: unknown): InValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`Unsupported database parameter type: ${typeof value}`);
}

function resultFromLibsql<T>(result: ResultSet): DatabaseResult<T> {
  const lastRowId = result.lastInsertRowid;
  return {
    results: result.rows.map((row) => ({ ...row }) as T),
    success: true,
    meta: {
      changes: result.rowsAffected,
      ...(lastRowId === undefined ? {} : { last_row_id: Number(lastRowId) }),
    },
  };
}

class LibsqlPreparedStatement implements AppPreparedStatement {
  constructor(
    private readonly client: Client,
    private readonly sql: string,
    private readonly args: InValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new LibsqlPreparedStatement(this.client, this.sql, values.map(normalizeValue));
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const result = await this.client.execute(this.toLibsqlStatement());
    const row = result.rows[0];
    if (!row) return null;
    if (columnName) return (row[columnName] as T | null | undefined) ?? null;
    return { ...row } as T;
  }

  async all<T = Record<string, unknown>>() {
    return resultFromLibsql<T>(await this.client.execute(this.toLibsqlStatement()));
  }

  async run<T = Record<string, unknown>>() {
    return resultFromLibsql<T>(await this.client.execute(this.toLibsqlStatement()));
  }

  toLibsqlStatement() {
    return { sql: this.sql, args: this.args };
  }
}

class LibsqlDatabase implements AppDatabase {
  constructor(private readonly client: Client) {}

  prepare(query: string) {
    return new LibsqlPreparedStatement(this.client, query);
  }

  async batch<T = Record<string, unknown>>(statements: AppPreparedStatement[]) {
    const queries = statements.map((statement) => {
      if (!(statement instanceof LibsqlPreparedStatement)) {
        throw new TypeError("Batch contains a statement from another database client.");
      }
      return statement.toLibsqlStatement();
    });
    const results = await this.client.batch(queries, "write");
    return results.map((result) => resultFromLibsql<T>(result));
  }
}

let database: AppDatabase | null = null;

function databaseUrl() {
  const configured = process.env.TURSO_DATABASE_URL?.trim();
  if (configured) return configured;
  if (process.env.VERCEL) {
    throw new Error(
      "TURSO_DATABASE_URL is required on Vercel. Connect a Turso database and add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.",
    );
  }
  return "file:edison-grill.local.db";
}

export function getDatabase(): AppDatabase {
  if (database) return database;
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  const client = createClient({
    url: databaseUrl(),
    ...(authToken ? { authToken } : {}),
  });
  database = new LibsqlDatabase(client);
  return database;
}
