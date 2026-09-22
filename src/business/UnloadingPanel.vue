<script setup lang="ts">
/**
 * 卸油差量索赔 · 界面
 * 只负责渲染与交互：规则在 validation.ts，状态与领域动作在 model.ts。
 */
import { computed, reactive, ref } from "vue";
import {
  AREAS,
  ORDER_STATUSES,
  PRODUCTS,
  confirmOrder,
  getTank,
  productName,
  registerOrder,
  rejectOrder,
  stationArea,
  stationName,
  store,
  type ProductCode,
  type RegisterInput,
  type UnloadOrder
} from "./model";
import { SHORTAGE_LIMIT, previewShortage } from "./validation";

const ANY = "全部";

const blankForm = (): RegisterInput => ({
  stationId: "",
  product: "",
  documentQty: 0,
  receivedQty: 0,
  sealNo: "",
  reason: ""
});

const form = reactive<RegisterInput>(blankForm());
const banner = ref<{ type: "ok" | "err"; text: string } | null>(null);
const reviewNotes = reactive<Record<string, string>>({});

const shortagePreview = computed(() =>
  previewShortage(form.documentQty, form.receivedQty)
);

const selectedTank = computed(() =>
  form.stationId && form.product
    ? getTank(form.stationId, form.product as ProductCode)
    : undefined
);

const filteredOrders = computed(() =>
  store.orders.filter((order) => {
    if (store.filters.area !== ANY && stationArea(order.stationId) !== store.filters.area) {
      return false;
    }
    if (store.filters.product !== ANY && order.product !== store.filters.product) return false;
    if (store.filters.status !== ANY && order.status !== store.filters.status) return false;
    return true;
  })
);

/* 三项指标：全部单据口径，不受筛选影响 */
const frozenOrders = computed(() => store.orders.filter((o) => o.status === "冻结待复查"));
const settledOrders = computed(() => store.orders.filter((o) => o.status === "复查已入库"));

const metrics = computed(() => [
  {
    label: "冻结待复查",
    value: `${frozenOrders.value.length} 单`,
    sub: `冻结索赔 ${sumBy(frozenOrders.value, "claimQty")} L`
  },
  {
    label: "已兑现索赔",
    value: `${sumBy(settledOrders.value, "claimQty")} L`,
    sub: `复查确认后生效`
  },
  {
    label: "累计实收入库",
    value: `${sumBy(settledOrders.value, "receivedQty")} L`,
    sub: `${settledOrders.value.length} 单已入库`
  }
]);

function sumBy(orders: UnloadOrder[], key: "claimQty" | "receivedQty") {
  return orders.reduce((acc, o) => acc + o[key], 0).toLocaleString("zh-CN");
}

function pct(rate: number) {
  return `${(rate * 1000).toFixed(2)}‰`;
}

function formatTime(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function tankUsage(t: { capacity: number; stock: number; pending: number }) {
  return Math.min(100, Math.round(((t.stock + t.pending) / t.capacity) * 100));
}

const STATUS_CLASS: Record<string, string> = {
  冻结待复查: "st-frozen",
  复查已入库: "st-confirmed",
  退回: "st-rejected"
};

function submit() {
  banner.value = null;
  const result = registerOrder({ ...form });
  if (result.ok) {
    banner.value = { type: "ok", text: result.message };
    Object.assign(form, blankForm());
  } else {
    banner.value = { type: "err", text: result.message };
  }
}

function confirm(o: UnloadOrder) {
  const result = confirmOrder(o.id, reviewNotes[o.id] ?? "");
  banner.value = { type: result.ok ? "ok" : "err", text: result.message };
  if (result.ok) reviewNotes[o.id] = "";
}

function reject(o: UnloadOrder) {
  const reason = (reviewNotes[o.id] ?? "").trim();
  if (!reason) {
    banner.value = { type: "err", text: `单据 ${o.no} 退回必须填写原因。` };
    return;
  }
  const result = rejectOrder(o.id, reason);
  banner.value = { type: result.ok ? "ok" : "err", text: result.message };
  if (result.ok) reviewNotes[o.id] = "";
}
</script>

<template>
  <div class="claim-shell">
    <!-- 站点罐容 -->
    <section class="panel tank-panel">
      <h2>油站罐容占用</h2>
      <p class="hint">占用 = 实际库存 + 冻结待复查实收量；实收登记不得超过罐容剩余空间。</p>
      <div class="station-grid">
        <article v-for="s in store.stations" :key="s.id" class="station-card">
          <header>
            <strong>{{ s.name }}</strong>
            <span class="area-tag">{{ s.area }} · {{ s.manager }}</span>
          </header>
          <div v-for="p in PRODUCTS" :key="p.code" class="tank-line">
            <span class="tank-name">{{ p.name }}</span>
            <template v-if="s.tanks[p.code]">
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :class="{ warn: tankUsage(s.tanks[p.code]!) >= 90 }"
                  :style="{ width: `${tankUsage(s.tanks[p.code]!)}%` }"
                />
              </div>
              <span class="tank-num">
                {{ s.tanks[p.code]!.stock + s.tanks[p.code]!.pending }}/{{ s.tanks[p.code]!.capacity }}L
                <em v-if="s.tanks[p.code]!.pending > 0">冻 {{ s.tanks[p.code]!.pending }}</em>
              </span>
            </template>
            <span v-else class="tank-num muted">未配置</span>
          </div>
        </article>
      </div>
    </section>

    <div class="claim-workspace">
      <!-- 到站登记 -->
      <form class="panel register-form" @submit.prevent="submit">
        <h2>到站卸油登记</h2>

        <label>
          到站油站
          <select v-model="form.stationId" required>
            <option value="">请选择油站</option>
            <option v-for="s in store.stations" :key="s.id" :value="s.id">
              {{ s.name }}（{{ s.area }}）
            </option>
          </select>
        </label>

        <label>
          油品
          <select v-model="form.product" required>
            <option value="">请选择油品</option>
            <option v-for="p in PRODUCTS" :key="p.code" :value="p.code">{{ p.name }}</option>
          </select>
        </label>

        <div v-if="selectedTank" class="cap-box">
          罐容 {{ selectedTank.capacity }}L ｜ 库存 {{ selectedTank.stock }}L ｜
          冻结 {{ selectedTank.pending }}L ｜
          <strong>尚可收 {{ selectedTank.capacity - selectedTank.stock - selectedTank.pending }}L</strong>
        </div>

        <div class="two-col">
          <label>
            单据量（L）
            <input v-model.number="form.documentQty" type="number" min="0" step="1" required />
          </label>
          <label>
            实收量（L）
            <input v-model.number="form.receivedQty" type="number" min="0" step="1" required />
          </label>
        </div>

        <div class="diff-box" :class="{ over: shortagePreview.overLimit }">
          差量 {{ shortagePreview.shortage }}L（{{ pct(shortagePreview.rate) }}）·
          阈值 5‰
          <strong v-if="shortagePreview.overLimit">已超阈值，铅封编号与原因必填</strong>
          <span v-else>阈值内正常损耗，无需立索赔</span>
        </div>

        <label>
          铅封编号<span v-if="shortagePreview.overLimit" class="req">*</span>
          <input
            v-model="form.sealNo"
            type="text"
            placeholder="差量超 5‰ 时必填，如 SEAL-92-7781"
          />
        </label>

        <label>
          差量原因<span v-if="shortagePreview.overLimit" class="req">*</span>
          <textarea
            v-model="form.reason"
            placeholder="差量超 5‰ 时必填，说明现场复测与承运方情况"
          />
        </label>

        <p v-if="banner" class="banner" :class="banner.type">{{ banner.text }}</p>

        <button type="submit">登记并冻结索赔</button>
        <p class="hint">
          规则：实收不得超罐容；差量超 {{ (SHORTAGE_LIMIT * 1000).toFixed(0) }}‰ 且缺铅封或原因的，整单拒绝，库存/索赔/罐容不变。
        </p>
      </form>

      <!-- 右栏：指标 + 历史 -->
      <section class="list-panel">
        <div class="metrics">
          <article v-for="m in metrics" :key="m.label" class="metric">
            <span>{{ m.label }}</span>
            <strong>{{ m.value }}</strong>
            <em>{{ m.sub }}</em>
          </article>
        </div>

        <div class="toolbar">
          <h2>索赔 / 卸油单历史</h2>
          <div class="filters">
            <select v-model="store.filters.area">
              <option :value="ANY">{{ ANY }}区域</option>
              <option v-for="a in AREAS" :key="a" :value="a">{{ a }}</option>
            </select>
            <select v-model="store.filters.product">
              <option :value="ANY">{{ ANY }}油品</option>
              <option v-for="p in PRODUCTS" :key="p.code" :value="p.code">{{ p.name }}</option>
            </select>
            <select v-model="store.filters.status">
              <option :value="ANY">{{ ANY }}状态</option>
              <option v-for="s in ORDER_STATUSES" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
        </div>

        <div class="record-grid">
          <div v-if="filteredOrders.length === 0" class="empty">暂无匹配单据</div>

          <article v-for="o in filteredOrders" :key="o.id" class="record">
            <div class="record-head">
              <p class="record-title">
                {{ o.no }} · {{ stationName(o.stationId) }} · {{ productName(o.product) }}
              </p>
              <span class="status" :class="STATUS_CLASS[o.status]">{{ o.status }}</span>
            </div>

            <div class="details">
              <span>单据量：{{ o.documentQty }}L</span>
              <span>实收量：{{ o.receivedQty }}L</span>
              <span :class="{ over: o.shortageRate > SHORTAGE_LIMIT }">
                差量：{{ o.shortage }}L（{{ pct(o.shortageRate) }}）
              </span>
              <span>索赔：{{ o.claimQty }}L</span>
              <span>铅封：{{ o.sealNo || "—" }}</span>
              <span>登记：{{ formatTime(o.createdAt) }}</span>
            </div>

            <p v-if="o.reason" class="note">差量原因：{{ o.reason }}</p>
            <p v-if="o.reviewNote" class="note review">复查记录：{{ o.reviewNote }}（{{ formatTime(o.reviewedAt) }}）</p>

            <template v-if="o.status === '冻结待复查'">
              <textarea
                v-model="reviewNotes[o.id]"
                class="review-input"
                placeholder="复查意见；若退回，必须在此填写退回原因"
              />
              <div class="actions">
                <button type="button" @click="confirm(o)">复查确认 · 按实收入库</button>
                <button class="danger" type="button" @click="reject(o)">退回（须填原因）</button>
              </div>
            </template>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
