<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  CLAIM_STATUSES,
  FILTERS,
  FUELS,
  STATIONS,
  chartRows,
  confirmClaim,
  filteredClaims,
  maxChart,
  metrics,
  registerArrival,
  returnClaim,
  state,
  stationName,
  tankRemaining
} from "./model";
import {
  DIFF_TOLERANCE,
  diffRate,
  isDiffOverThreshold
} from "./validation";
import type { ClaimRecord, FuelType, TankState } from "./model";

const form = reactive({
  stationId: "",
  fuel: "" as "" | FuelType,
  paperQty: null as number | null,
  actualQty: null as number | null,
  sealNo: "",
  reason: ""
});

const formError = ref("");
const successMsg = ref("");
const openRejectId = ref<string | null>(null);
const rejectDraft = ref("");
const rejectError = ref("");

let successTimer: ReturnType<typeof setTimeout> | undefined;

const selectedTank = computed<TankState | undefined>(() =>
  form.stationId && form.fuel
    ? state.tanks.find((tank) => tank.stationId === form.stationId && tank.fuel === form.fuel)
    : undefined
);

const liveDiff = computed(() => {
  if (form.paperQty === null || form.actualQty === null) return null;
  return form.paperQty - form.actualQty;
});

const liveOver = computed(() => {
  if (form.paperQty === null || form.actualQty === null) return false;
  return isDiffOverThreshold(form.paperQty, form.actualQty);
});

function onStationChange() {
  form.fuel = "";
}

function resetForm() {
  form.stationId = "";
  form.fuel = "";
  form.paperQty = null;
  form.actualQty = null;
  form.sealNo = "";
  form.reason = "";
}

function showSuccess(message: string) {
  successMsg.value = message;
  clearTimeout(successTimer);
  successTimer = setTimeout(() => {
    successMsg.value = "";
  }, 4000);
}

function submit() {
  formError.value = "";
  const result = registerArrival({ ...form });
  if (!result.ok) {
    formError.value = result.error ?? "登记失败，整单已拒绝";
    return;
  }
  resetForm();
  showSuccess("到站登记成功：实收量已冻结占用，待复查确认后入库");
}

function onConfirm(claim: ClaimRecord) {
  rejectError.value = "";
  openRejectId.value = null;
  if (confirmClaim(claim.id)) {
    showSuccess("复查确认完成：冻结量已按实收量入库");
  }
}

function openReject(claim: ClaimRecord) {
  openRejectId.value = claim.id;
  rejectDraft.value = claim.rejectReason ?? "";
  rejectError.value = "";
}

function cancelReject() {
  openRejectId.value = null;
  rejectDraft.value = "";
  rejectError.value = "";
}

function submitReject(claim: ClaimRecord) {
  rejectError.value = "";
  const result = returnClaim(claim.id, rejectDraft.value);
  if (!result.ok) {
    rejectError.value = result.error ?? "退回失败";
    return;
  }
  cancelReject();
  showSuccess("已退回：罐容冻结释放，库存未变动");
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function statusClass(status: ClaimRecord["status"]): string {
  if (status === "已确认入库") return "status status-ok";
  if (status === "已退回") return "status status-back";
  return "status status-freeze";
}

function tanksOf(stationId: string): TankState[] {
  return state.tanks.filter((tank) => tank.stationId === stationId);
}

function pct(tank: TankState, key: "stock" | "frozen"): number {
  return (tank[key] / tank.capacity) * 100;
}
</script>

<template>
  <section class="metrics">
    <article v-for="item in metrics" :key="item.label" class="metric">
      <span>{{ item.label }}</span>
      <strong>{{ formatNumber(item.value) }}<small>{{ item.unit }}</small></strong>
    </article>
  </section>

  <section class="workspace">
    <div class="side-col">
      <form class="panel" @submit.prevent="submit">
        <h2>到站卸油登记</h2>
        <div class="form-grid">
          <label>
            油站
            <select v-model="form.stationId" required @change="onStationChange">
              <option value="">请选择油站</option>
              <option v-for="station in STATIONS" :key="station.id" :value="station.id">
                {{ station.name }}（{{ station.area }}）
              </option>
            </select>
          </label>

          <label>
            油品
            <select v-model="form.fuel" :disabled="!form.stationId" required>
              <option value="">请选择油品</option>
              <option v-for="fuel in FUELS" :key="fuel" :value="fuel">{{ fuel }}</option>
            </select>
          </label>

          <p v-if="selectedTank" class="tank-hint">
            罐容 {{ formatNumber(selectedTank.capacity) }} L ·
            库存 {{ formatNumber(selectedTank.stock) }} L ·
            冻结 {{ formatNumber(selectedTank.frozen) }} L ·
            剩余可用 <strong>{{ formatNumber(tankRemaining(selectedTank)) }}</strong> L
          </p>

          <label>
            单据量（L）
            <input v-model.number="form.paperQty" type="number" min="0" step="1" required />
          </label>

          <label>
            实收量（L）
            <input v-model.number="form.actualQty" type="number" min="0" step="1" required />
          </label>

          <p v-if="liveDiff !== null" class="diff-hint" :class="{ over: liveOver }">
            差量 {{ formatNumber(liveDiff) }} L
            （{{ (diffRate(form.paperQty ?? 0, form.actualQty ?? 0) * 1000).toFixed(2) }}‰，
            允耗 {{ DIFF_TOLERANCE * 1000 }}‰）
            <template v-if="liveOver">— 超阈，铅封编号和原因为必填</template>
          </p>

          <label>
            铅封编号<span v-if="liveOver" class="required">*</span>
            <input v-model="form.sealNo" placeholder="差量超过千分之五时必填" />
          </label>

          <label>
            差量原因<span v-if="liveOver" class="required">*</span>
            <textarea v-model="form.reason" placeholder="差量超过千分之五时必须说明原因" />
          </label>

          <p v-if="formError" class="alert alert-error">{{ formError }}</p>
          <p v-if="successMsg" class="alert alert-ok">{{ successMsg }}</p>

          <button type="submit">登记到站（冻结待复查）</button>
        </div>
      </form>

      <section class="panel tank-panel">
        <h2>油罐占用</h2>
        <div v-for="station in STATIONS" :key="station.id" class="tank-group">
          <p class="tank-group-title">{{ station.name }}</p>
          <div v-for="tank in tanksOf(station.id)" :key="tank.fuel" class="tank-item">
            <div class="tank-meta">
              <span>{{ tank.fuel }}</span>
              <span>
                存 {{ formatNumber(tank.stock) }} · 冻 {{ formatNumber(tank.frozen) }} /
                容 {{ formatNumber(tank.capacity) }}
              </span>
            </div>
            <div class="seg-track">
              <div class="seg-stock" :style="{ width: `${pct(tank, 'stock')}%` }" />
              <div class="seg-frozen" :style="{ width: `${pct(tank, 'frozen')}%` }" />
            </div>
          </div>
        </div>
        <p class="legend"><i class="dot dot-stock" />库存　<i class="dot dot-frozen" />冻结占用</p>
      </section>
    </div>

    <section class="list-panel">
      <div class="toolbar">
        <h2>索赔历史</h2>
        <select v-model="state.filter">
          <option v-for="item in FILTERS" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>

      <div class="record-grid">
        <div v-if="filteredClaims.length === 0" class="empty">暂无匹配的索赔单</div>

        <article v-for="claim in filteredClaims" :key="claim.id" class="record">
          <div class="record-head">
            <p class="record-title">{{ stationName(claim.stationId) }} · {{ claim.fuel }}</p>
            <span :class="statusClass(claim.status)">{{ claim.status }}</span>
          </div>
          <div class="details">
            <span>单据量：{{ formatNumber(claim.paperQty) }} L</span>
            <span>实收量：{{ formatNumber(claim.actualQty) }} L</span>
            <span :class="{ over: claim.diff > 0 && diffRate(claim.paperQty, claim.actualQty) > DIFF_TOLERANCE }">
              差量：{{ formatNumber(claim.diff) }} L
            </span>
            <span>差量率：{{ (diffRate(claim.paperQty, claim.actualQty) * 1000).toFixed(2) }}‰</span>
            <span>铅封编号：{{ claim.sealNo || "—" }}</span>
            <span>登记时间：{{ formatTime(claim.createdAt) }}</span>
          </div>
          <p class="note">差量原因：{{ claim.reason || "无（差量在允耗范围内）" }}</p>
          <p v-if="claim.rejectReason" class="reject-note">退回原因：{{ claim.rejectReason }}</p>
          <p v-if="claim.reviewedAt" class="review-time">复查时间：{{ formatTime(claim.reviewedAt) }}</p>

          <template v-if="claim.status === '冻结中'">
            <div v-if="openRejectId !== claim.id" class="actions">
              <button type="button" @click="onConfirm(claim)">复查确认（按实收入库）</button>
              <button class="secondary" type="button" @click="openReject(claim)">复查退回</button>
            </div>
            <div v-else class="reject-box">
              <label>
                退回原因（必填，库存保持不变）
                <textarea v-model="rejectDraft" placeholder="填写退回原因" />
              </label>
              <p v-if="rejectError" class="alert alert-error">{{ rejectError }}</p>
              <div class="actions">
                <button class="danger" type="button" @click="submitReject(claim)">确认退回</button>
                <button class="secondary" type="button" @click="cancelReject">取消</button>
              </div>
            </div>
          </template>
        </article>
      </div>

      <div class="mini-chart">
        <div v-for="row in chartRows" :key="row.status" class="bar">
          <span>{{ row.status }}</span>
          <div class="bar-track">
            <div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" />
          </div>
          <strong>{{ row.value }}</strong>
        </div>
      </div>
    </section>
  </section>
</template>
