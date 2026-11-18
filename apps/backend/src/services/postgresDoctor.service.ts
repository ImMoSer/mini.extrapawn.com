import type {
  PostgresDoctorReportDTO,
  PostgresHealthStatus,
  PostgresTableHealthDTO,
} from "shared";
import { callTelegramJson, escapeHtml } from "../bot/telegramApi.js";
import { env } from "../config/env.js";
import { sqlClient } from "../db/index.js";

const ALLOWED_USER_SCHEMAS = new Set([
  "tele_app",
  "puzzle_service",
  "app_fastify",
]);
const SAFE_SQL_IDENT_RE = /^[a-z_][a-z0-9_]*$/;

const AUTO_HEAL_MIN_DEAD_TUPLES = 2_000;
const AUTO_HEAL_MIN_DEAD_RATIO_PCT = 20;
const WARN_DEAD_TUPLES = 5_000;
const WARN_DEAD_RATIO_PCT = 25;
const WARN_BACKUP_MAX_AGE_HOURS = 28;
const CRITICAL_BACKUP_MAX_AGE_HOURS = 52;
const WARN_DB_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h anti-spam cooldown
const DOCTOR_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h periodic check

let lastBossAlertAt = 0;
let lastBossAlertSignature = "";
let doctorLoopStarted = false;

interface RawTableStatRow {
  schema_name: string;
  table_name: string;
  live_tuples: string | number;
  dead_tuples: string | number;
  total_size_bytes: string | number;
  last_vacuum_at: Date | string | null;
}

async function runOnlineVacuumStatement(sqlCommand: string): Promise<void> {
  const reserved = await sqlClient.reserve();
  try {
    await reserved.unsafe("SET statement_timeout = 0");
    await reserved.unsafe(sqlCommand);
    await reserved.unsafe("RESET statement_timeout");
  } finally {
    reserved.release();
  }
}

async function fetchUserTableStats(): Promise<RawTableStatRow[]> {
  const rows = await sqlClient<RawTableStatRow[]>`
    SELECT
      schemaname AS schema_name,
      relname AS table_name,
      COALESCE(n_live_tup, 0)::bigint AS live_tuples,
      COALESCE(n_dead_tup, 0)::bigint AS dead_tuples,
      pg_total_relation_size(relid)::bigint AS total_size_bytes,
      GREATEST(last_vacuum, last_autovacuum) AS last_vacuum_at
    FROM pg_stat_user_tables
    WHERE schemaname IN ('tele_app', 'puzzle_service', 'app_fastify')
    ORDER BY n_dead_tup DESC, pg_total_relation_size(relid) DESC
  `;
  return rows;
}

function computeDeadRatioPct(live: number, dead: number): number {
  const total = live + dead;
  if (total <= 0 || dead <= 0) return 0;
  return Math.round((dead / total) * 1000) / 10;
}

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function collectPostgresDoctorReport(options?: {
  allowAutoHeal?: boolean;
}): Promise<PostgresDoctorReportDTO> {
  const autoHealedTables: string[] = [];
  let tableRows = await fetchUserTableStats();

  if (options?.allowAutoHeal) {
    for (const row of tableRows) {
      const live = Number(row.live_tuples) || 0;
      const dead = Number(row.dead_tuples) || 0;
      const ratio = computeDeadRatioPct(live, dead);

      if (
        dead >= AUTO_HEAL_MIN_DEAD_TUPLES &&
        ratio >= AUTO_HEAL_MIN_DEAD_RATIO_PCT &&
        ALLOWED_USER_SCHEMAS.has(row.schema_name) &&
        SAFE_SQL_IDENT_RE.test(row.table_name)
      ) {
        const qualified = `${row.schema_name}.${row.table_name}`;
        await runOnlineVacuumStatement(
          `VACUUM (ANALYZE) "${row.schema_name}"."${row.table_name}"`
        );
        autoHealedTables.push(qualified);
      }
    }

    if (autoHealedTables.length > 0) {
      tableRows = await fetchUserTableStats();
    }
  }

  const [dbStat] = await sqlClient<
    { db_size_bytes: string | number; cache_hit_ratio_pct: number }[]
  >`
    SELECT
      pg_database_size(current_database())::bigint AS db_size_bytes,
      COALESCE(
        ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2),
        100.0
      )::float8 AS cache_hit_ratio_pct
    FROM pg_stat_database
    WHERE datname = current_database()
  `;

  const [activityStat] = await sqlClient<
    {
      active_connections: number;
      idle_in_tx_count: number;
      longest_query_sec: number;
    }[]
  >`
    SELECT
      COUNT(*)::int AS active_connections,
      COUNT(*) FILTER (
        WHERE state = 'idle in transaction'
          AND state_change IS NOT NULL
          AND now() - state_change > interval '30 seconds'
      )::int AS idle_in_tx_count,
      COALESCE(
        MAX(EXTRACT(EPOCH FROM (now() - query_start))) FILTER (
          WHERE state IN ('active', 'idle in transaction')
            AND pid <> pg_backend_pid()
            AND query_start IS NOT NULL
        ),
        0
      )::float8 AS longest_query_sec
    FROM pg_stat_activity
    WHERE datname = current_database()
  `;

  let lastBackupAt: string | null = null;
  let lastBackupSizeBytes: number | null = null;
  let lastBackupFile: string | null = null;
  let lastVacuumAt: string | null = null;

  const [hbCheck] = await sqlClient<{ exists_flag: boolean }[]>`
    SELECT to_regclass('public.postgres_doctor_heartbeat') IS NOT NULL AS exists_flag
  `;

  if (hbCheck?.exists_flag) {
    const [hb] = await sqlClient<
      {
        last_backup_at: Date | string | null;
        last_backup_size_bytes: string | number | null;
        last_backup_file: string | null;
        last_vacuum_at: Date | string | null;
      }[]
    >`
      SELECT
        last_backup_at,
        last_backup_size_bytes,
        last_backup_file,
        last_vacuum_at
      FROM public.postgres_doctor_heartbeat
      WHERE id = 1
      LIMIT 1
    `;

    if (hb) {
      lastBackupAt = toIsoOrNull(hb.last_backup_at);
      lastBackupSizeBytes =
        hb.last_backup_size_bytes !== null &&
        hb.last_backup_size_bytes !== undefined
          ? Number(hb.last_backup_size_bytes)
          : null;
      lastBackupFile = hb.last_backup_file ?? null;
      lastVacuumAt = toIsoOrNull(hb.last_vacuum_at);
    }
  }

  let totalLiveTuples = 0;
  let totalDeadTuples = 0;
  const mappedTables: PostgresTableHealthDTO[] = tableRows.map((r) => {
    const live = Number(r.live_tuples) || 0;
    const dead = Number(r.dead_tuples) || 0;
    totalLiveTuples += live;
    totalDeadTuples += dead;
    return {
      qualified_name: `${r.schema_name}.${r.table_name}`,
      live_tuples: live,
      dead_tuples: dead,
      dead_ratio_pct: computeDeadRatioPct(live, dead),
      total_size_bytes: Number(r.total_size_bytes) || 0,
      last_vacuum_at: toIsoOrNull(r.last_vacuum_at),
    };
  });

  const nowMs = Date.now();
  const backupAgeHours = lastBackupAt
    ? Math.round(((nowMs - new Date(lastBackupAt).getTime()) / 3_600_000) * 10) /
      10
    : null;

  const dbSizeBytes = Number(dbStat?.db_size_bytes ?? 0);
  const cacheHitRatioPct = Number(dbStat?.cache_hit_ratio_pct ?? 100);
  const activeConnections = Number(activityStat?.active_connections ?? 1);
  const idleInTxCount = Number(activityStat?.idle_in_tx_count ?? 0);
  const longestQuerySec =
    Math.round(Number(activityStat?.longest_query_sec ?? 0) * 10) / 10;

  let status: PostgresHealthStatus = "healthy";
  const issues: string[] = [];

  const promoteStatus = (next: PostgresHealthStatus) => {
    if (next === "critical") status = "critical";
    else if (next === "warning" && status === "healthy") status = "warning";
  };

  if (idleInTxCount > 0) {
    promoteStatus("warning");
    issues.push(
      `Обнаружено зависших транзакций (idle in transaction > 30s): ${idleInTxCount}`
    );
  }

  for (const t of mappedTables) {
    if (
      t.dead_tuples >= WARN_DEAD_TUPLES &&
      t.dead_ratio_pct >= WARN_DEAD_RATIO_PCT
    ) {
      promoteStatus("warning");
      issues.push(
        `Высокая доля dead tuples в ${t.qualified_name}: ${t.dead_tuples} (${t.dead_ratio_pct}%)`
      );
    }
  }

  if (backupAgeHours === null) {
    promoteStatus("warning");
    issues.push("Нет отметки о выполненном бэкапе в postgres_doctor_heartbeat");
  } else if (backupAgeHours > CRITICAL_BACKUP_MAX_AGE_HOURS) {
    promoteStatus("critical");
    issues.push(`Свежий бэкап отсутствует уже ${backupAgeHours} ч!`);
  } else if (backupAgeHours > WARN_BACKUP_MAX_AGE_HOURS) {
    promoteStatus("warning");
    issues.push(`Возраст последнего бэкапа: ${backupAgeHours} ч (> 28 ч)`);
  }

  if (lastBackupSizeBytes !== null && lastBackupSizeBytes < 1024) {
    promoteStatus("critical");
    issues.push(`Подозрительно малый размер бэкапа: ${lastBackupSizeBytes} байт`);
  }

  if (dbSizeBytes > WARN_DB_SIZE_BYTES) {
    promoteStatus("warning");
    issues.push(
      `Размер базы chess_db превысил 5 ГБ (${(
        dbSizeBytes /
        (1024 * 1024 * 1024)
      ).toFixed(2)} ГБ)`
    );
  }

  return {
    status,
    checked_at: new Date(nowMs).toISOString(),
    db_size_bytes: dbSizeBytes,
    cache_hit_ratio_pct: cacheHitRatioPct,
    active_connections: activeConnections,
    idle_in_tx_count: idleInTxCount,
    longest_query_sec: longestQuerySec,
    total_live_tuples: totalLiveTuples,
    total_dead_tuples: totalDeadTuples,
    last_backup_at: lastBackupAt,
    last_backup_size_bytes: lastBackupSizeBytes,
    last_backup_file: lastBackupFile,
    backup_age_hours: backupAgeHours,
    last_vacuum_at: lastVacuumAt,
    auto_healed_tables: autoHealedTables,
    issues,
    top_tables: mappedTables.slice(0, 6),
  };
}

export async function runManualPostgresVacuum(): Promise<PostgresDoctorReportDTO> {
  await runOnlineVacuumStatement("VACUUM (ANALYZE)");

  const [hbCheck] = await sqlClient<{ exists_flag: boolean }[]>`
    SELECT to_regclass('public.postgres_doctor_heartbeat') IS NOT NULL AS exists_flag
  `;
  if (hbCheck?.exists_flag) {
    await sqlClient`
      INSERT INTO public.postgres_doctor_heartbeat (id, last_vacuum_at, updated_at)
      VALUES (1, now(), now())
      ON CONFLICT (id) DO UPDATE SET
        last_vacuum_at = now(),
        updated_at = now()
    `;
  }

  return collectPostgresDoctorReport({ allowAutoHeal: false });
}

async function runPeriodicDoctorCheck(): Promise<void> {
  try {
    const report = await collectPostgresDoctorReport({ allowAutoHeal: true });
    if (report.auto_healed_tables.length > 0) {
      console.info(
        `[PostgresDoctor] Auto-healed tables via VACUUM (ANALYZE): ${report.auto_healed_tables.join(", ")}`
      );
    }

    if (report.status === "healthy" || report.issues.length === 0) {
      return;
    }

    const signature = `${report.status}|${report.issues.join(";")}`;
    const nowMs = Date.now();
    if (
      signature === lastBossAlertSignature &&
      nowMs - lastBossAlertAt < ALERT_COOLDOWN_MS
    ) {
      return;
    }

    lastBossAlertSignature = signature;
    lastBossAlertAt = nowMs;

    const badge = report.status === "critical" ? "🚨 CRITICAL" : "⚠️ WARNING";
    const sizeMb = (report.db_size_bytes / (1024 * 1024)).toFixed(1);
    const lines = [
      `🩺 <b>Postgres-Doctor (${badge})</b>`,
      `БД <b>chess_db</b>: ${sizeMb} МБ • Cache Hit: ${report.cache_hit_ratio_pct}%`,
      ...report.issues.map((i) => `• ${escapeHtml(i)}`),
    ];
    if (report.auto_healed_tables.length > 0) {
      lines.push(
        `🧹 Авто-VACUUM выполнен: ${escapeHtml(
          report.auto_healed_tables.join(", ")
        )}`
      );
    }

    await callTelegramJson("sendMessage", {
      chat_id: env.SUPERADMIN_TELEGRAM_ID,
      text: lines.join("\n"),
      parse_mode: "HTML",
    });
  } catch (err) {
    console.error("[PostgresDoctor] Periodic health check failed:", err);
  }
}

export function startPostgresDoctorLoop(): void {
  if (doctorLoopStarted) return;
  doctorLoopStarted = true;

  setTimeout(() => {
    void runPeriodicDoctorCheck();
  }, 45_000);

  setInterval(() => {
    void runPeriodicDoctorCheck();
  }, DOCTOR_CHECK_INTERVAL_MS);
}
