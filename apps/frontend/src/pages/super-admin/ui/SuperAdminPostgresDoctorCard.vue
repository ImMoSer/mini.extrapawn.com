<script setup lang="ts">
import type { PostgresDoctorReportDTO } from "shared";

defineProps<{
  report: PostgresDoctorReportDTO;
  isVacuuming: boolean;
}>();

const emit = defineEmits<{
  vacuum: [];
}>();

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "—";
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <section class="glass flex flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2 class="text-xs font-bold tracking-wider text-brand uppercase">
          🩺 POSTGRES-DOCTOR • CHESS_DB
        </h2>
        <span
          class="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
          :class="
            report.status === 'healthy'
              ? 'bg-success/15 text-success'
              : report.status === 'warning'
                ? 'bg-warning/15 text-warning'
                : 'bg-danger/15 text-danger'
          "
        >
          {{ report.status }}
        </span>
      </div>

      <button
        type="button"
        :disabled="isVacuuming"
        class="min-w-0 truncate rounded-md border border-brand/40 bg-elevated px-2.5 py-1 text-[11px] font-bold text-brand transition hover:border-brand disabled:opacity-50"
        @click="emit('vacuum')"
      >
        {{ isVacuuming ? "⏳ VACUUM..." : "🧹 VACUUM" }}
      </button>
    </div>

    <div
      v-if="report.issues.length > 0"
      class="flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs font-medium"
      :class="
        report.status === 'critical'
          ? 'border-danger/40 bg-danger/15 text-danger'
          : 'border-warning/40 bg-warning/15 text-warning'
      "
    >
      <div v-for="(issue, idx) in report.issues" :key="idx">
        • {{ issue }}
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="rounded-lg border border-border bg-elevated p-2.5">
        <div class="text-[10px] text-text-secondary uppercase">Размер БД</div>
        <div class="font-condensed text-base font-bold text-text-primary">
          {{ formatBytes(report.db_size_bytes) }}
        </div>
        <div class="text-[10px] text-success">
          RAM Hit: {{ report.cache_hit_ratio_pct }}%
        </div>
      </div>

      <div class="rounded-lg border border-border bg-elevated p-2.5">
        <div class="text-[10px] text-text-secondary uppercase">Бэкап</div>
        <div class="font-condensed text-base font-bold text-info">
          {{
            report.backup_age_hours !== null
              ? `${report.backup_age_hours} ч назад`
              : "—"
          }}
        </div>
        <div class="truncate text-[10px] text-text-secondary">
          {{ formatBytes(report.last_backup_size_bytes) }}
        </div>
      </div>

      <div class="rounded-lg border border-border bg-elevated p-2.5">
        <div class="text-[10px] text-text-secondary uppercase">Dead Tuples</div>
        <div
          class="font-condensed text-base font-bold"
          :class="
            report.total_dead_tuples > 5000 ? 'text-warning' : 'text-text-primary'
          "
        >
          {{ report.total_dead_tuples }}
        </div>
        <div class="text-[10px] text-text-secondary">
          Live: {{ report.total_live_tuples }}
        </div>
      </div>

      <div class="rounded-lg border border-border bg-elevated p-2.5">
        <div class="text-[10px] text-text-secondary uppercase">Сессии / Tx</div>
        <div class="font-condensed text-base font-bold text-text-primary">
          {{ report.active_connections }} конн.
        </div>
        <div
          class="text-[10px]"
          :class="
            report.idle_in_tx_count > 0 ? 'text-danger' : 'text-text-secondary'
          "
        >
          Idle-Tx: {{ report.idle_in_tx_count }} • Max: {{ report.longest_query_sec }}s
        </div>
      </div>
    </div>

    <div
      v-if="report.top_tables.length > 0"
      class="flex flex-col divide-y divide-border rounded-lg border border-border bg-elevated px-3 py-1.5 text-[11px]"
    >
      <div
        v-for="tbl in report.top_tables"
        :key="tbl.qualified_name"
        class="flex items-center justify-between gap-2 py-1"
      >
        <span class="min-w-0 truncate font-mono text-text-primary">
          {{ tbl.qualified_name }}
        </span>
        <div class="flex shrink-0 items-center gap-2 font-condensed">
          <span class="text-text-secondary">
            {{ formatBytes(tbl.total_size_bytes) }}
          </span>
          <span
            :class="
              tbl.dead_ratio_pct >= 20 ? 'font-bold text-warning' : 'text-text-secondary'
            "
          >
            dead {{ tbl.dead_tuples }} ({{ tbl.dead_ratio_pct }}%)
          </span>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-secondary">
      <span>Последний VACUUM: {{ formatShortTime(report.last_vacuum_at) }}</span>
      <span>Проверка: {{ formatShortTime(report.checked_at) }}</span>
    </div>
  </section>
</template>
