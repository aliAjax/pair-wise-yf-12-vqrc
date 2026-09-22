/**
 * 卸油差量索赔 · 领域模型
 * 站点/罐容、卸油单、索赔状态、浏览器存储同步全部收敛在这里，
 * 校验规则见 validation.ts，界面渲染见 UnloadingPanel.vue。
 */
import { reactive, watch } from "vue";
import { validateRegister } from "./validation";

export type ProductCode = "P92" | "P95" | "D0";

export const PRODUCTS: { code: ProductCode; name: string }[] = [
  { code: "P92", name: "92#汽油" },
  { code: "P95", name: "95#汽油" },
  { code: "D0", name: "0#柴油" }
];

export const AREAS = ["东区", "西区", "机场线"] as const;
export const ORDER_STATUSES = ["冻结待复查", "复查已入库", "退回"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 罐容占用：已入库存 + 登记后冻结未复查的实收量 */
export type TankState = {
  capacity: number;
  stock: number;
  pending: number;
};

export type Station = {
  id: string;
  name: string;
  area: (typeof AREAS)[number];
  manager: string;
  tanks: Partial<Record<ProductCode, TankState>>;
};

export type UnloadOrder = {
  id: string;
  no: string;
  stationId: string;
  product: ProductCode;
  documentQty: number;
  receivedQty: number;
  shortage: number;
  /** 差量比例（小数，5‰ = 0.005） */
  shortageRate: number;
  sealNo: string;
  reason: string;
  /** 索赔量：差量超 5‰ 时为正，冻结期间只登记不兑现 */
  claimQty: number;
  status: OrderStatus;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string;
};

export type Filters = {
  area: string;
  product: string;
  status: string;
};

type PersistedState = {
  version: 1;
  stations: Station[];
  orders: UnloadOrder[];
  filters: Filters;
};

export const STORAGE_KEY = "hxwlfront-21-unloading-claim";

const ANY = "全部";
const DAY = 86400000;

function isoDaysAgo(days: number, hour: number, minute: number) {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function makeStation(
  id: string,
  name: string,
  area: Station["area"],
  manager: string,
  tanks: { product: ProductCode; capacity: number; stock: number; pending?: number }[]
): Station {
  return {
    id,
    name,
    area,
    manager,
    tanks: Object.fromEntries(
      tanks.map((t) => [
        t.product,
        { capacity: t.capacity, stock: t.stock, pending: t.pending ?? 0 }
      ])
    ) as Station["tanks"]
  };
}

function makeOrder(
  no: string,
  stationId: string,
  product: ProductCode,
  documentQty: number,
  receivedQty: number,
  extra: Partial<UnloadOrder> & Pick<UnloadOrder, "createdAt">
): UnloadOrder {
  const shortage = Math.max(0, documentQty - receivedQty);
  const rate = documentQty > 0 ? shortage / documentQty : 0;
  return {
    id: `seed-${no}`,
    no,
    stationId,
    product,
    documentQty,
    receivedQty,
    shortage,
    shortageRate: rate,
    sealNo: "",
    reason: "",
    claimQty: 0,
    status: "冻结待复查",
    reviewNote: "",
    reviewedAt: "",
    ...extra
  };
}

function seedStations(): Station[] {
  return [
    makeStation("st-east", "东区一站", "东区", "刘站长", [
      { product: "P92", capacity: 30000, stock: 12000, pending: 19800 },
      { product: "P95", capacity: 20000, stock: 8000 },
      { product: "D0", capacity: 25000, stock: 15000 }
    ]),
    makeStation("st-airport", "机场快线站", "机场线", "王站长", [
      { product: "P92", capacity: 35000, stock: 9000 },
      { product: "P95", capacity: 30000, stock: 22000 },
      { product: "D0", capacity: 40000, stock: 18000 }
    ]),
    makeStation("st-west", "西区大道站", "西区", "赵站长", [
      { product: "P92", capacity: 25000, stock: 6000 },
      { product: "P95", capacity: 18000, stock: 11000 },
      { product: "D0", capacity: 30000, stock: 20000, pending: 9800 }
    ])
  ];
}

function seedOrders(): UnloadOrder[] {
  return [
    // 冻结待复查：差量 200L = 1%，超 5‰，已填铅封与原因
    makeOrder("YD20260922001", "st-east", "P92", 20000, 19800, {
      sealNo: "SEAL-92-7781",
      reason: "运输途中管线渗漏，到站复测差量 200L。",
      claimQty: 200,
      createdAt: isoDaysAgo(0, 9, 12)
    }),
    // 复查已入库：差量 200L = 2%，确认索赔并按实收 9800L 入库
    makeOrder("YD20260918006", "st-west", "D0", 10000, 9800, {
      sealNo: "SEAL-D0-3320",
      reason: "油罐底部残留未卸净，承运方确认。",
      claimQty: 200,
      status: "复查已入库",
      reviewNote: "复查铅封完好，按实收 9800L 入库，差量 200L 转索赔。",
      createdAt: isoDaysAgo(4, 14, 30),
      reviewedAt: isoDaysAgo(3, 10, 5)
    }),
    // 退回：差量 300L 超标但铅封与单据不符，退回，库存未动
    makeOrder("YD20260915003", "st-airport", "P95", 24000, 23700, {
      sealNo: "SEAL-95-5012",
      reason: "温度差导致计量偏差，承运方待复核。",
      claimQty: 300,
      status: "退回",
      reviewNote: "铅封编号与铅封照片不符，退回承运方重新举证。",
      createdAt: isoDaysAgo(7, 8, 50),
      reviewedAt: isoDaysAgo(7, 16, 20)
    }),
    // 复查已入库：正常损耗 30L = 2‰，未达 5‰，无索赔
    makeOrder("YD20260910002", "st-airport", "P92", 15000, 14970, {
      reason: "正常损耗。",
      status: "复查已入库",
      reviewNote: "差量在 5‰ 以内，按实收入库，不立索赔。",
      createdAt: isoDaysAgo(12, 11, 10),
      reviewedAt: isoDaysAgo(11, 9, 0)
    })
  ];
}

function defaultFilters(): Filters {
  return { area: ANY, product: ANY, status: ANY };
}

function loadState(): PersistedState {
  const stations = seedStations();
  const orders = seedOrders();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.version === 1 && Array.isArray(parsed.stations) && Array.isArray(parsed.orders)) {
        return {
          version: 1,
          stations: parsed.stations,
          orders: parsed.orders,
          filters: { ...defaultFilters(), ...(parsed.filters ?? {}) }
        };
      }
    }
  } catch {
    // 存储损坏时回落种子数据
  }
  return { version: 1, stations, orders, filters: defaultFilters() };
}

const initial = loadState();

/** 全站唯一数据源：界面与指标均从这里派生 */
export const store = reactive({
  stations: initial.stations,
  orders: initial.orders,
  filters: initial.filters
});

// 浏览器存储同步：任意变更后落盘，刷新后保留
watch(
  () => [store.stations, store.orders, store.filters],
  () => {
    const payload: PersistedState = {
      version: 1,
      stations: store.stations,
      orders: store.orders,
      filters: store.filters
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 隐私模式或容量不足时静默保留内存态
    }
  },
  { deep: true }
);

/* ---------------- 派生查询 ---------------- */

export function stationName(stationId: string) {
  return store.stations.find((s) => s.id === stationId)?.name ?? "未知油站";
}

export function productName(code: ProductCode) {
  return PRODUCTS.find((p) => p.code === code)?.name ?? code;
}

export function stationArea(stationId: string) {
  return store.stations.find((s) => s.id === stationId)?.area ?? "";
}

export function getTank(stationId: string, product: ProductCode): TankState | undefined {
  return store.stations.find((s) => s.id === stationId)?.tanks[product];
}

export function nextOrderNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  const countToday = store.orders.filter((o) => o.no.includes(ymd)).length + 1;
  return `YD${ymd}${String(countToday).padStart(3, "0")}`;
}

/* ---------------- 领域动作 ---------------- */

export type RegisterInput = {
  stationId: string;
  product: ProductCode | "";
  documentQty: number;
  receivedQty: number;
  sealNo: string;
  reason: string;
};

export type ActionResult = { ok: boolean; message: string; orderId?: string };

/**
 * 到站登记：整单校验通过才落单。
 * 任一规则不通过（含超 5‰ 却未填铅封/原因）→ 整单拒绝，
 * 库存、索赔、罐容占用全部保持原样。
 * 通过后：索赔先冻结，实收量计入罐容占用（pending），复查前不动库存。
 */
export function registerOrder(input: RegisterInput): ActionResult {
  const result = validateRegister(input, (stationId, product) => getTank(stationId, product));
  if (!result.ok) return result;

  const product = input.product as ProductCode;
  const tank = getTank(input.stationId, product)!;
  const shortage = Math.max(0, input.documentQty - input.receivedQty);
  const order: UnloadOrder = {
    id: crypto.randomUUID(),
    no: nextOrderNo(),
    stationId: input.stationId,
    product,
    documentQty: input.documentQty,
    receivedQty: input.receivedQty,
    shortage,
    shortageRate: input.documentQty > 0 ? shortage / input.documentQty : 0,
    sealNo: input.sealNo.trim(),
    reason: input.reason.trim(),
    claimQty: result.claimQty,
    status: "冻结待复查",
    reviewNote: "",
    createdAt: new Date().toISOString(),
    reviewedAt: ""
  };
  store.orders.unshift(order);
  tank.pending += order.receivedQty;
  return { ok: true, message: `登记成功，单据 ${order.no} 已冻结待复查，罐容占用同步。`, orderId: order.id };
}

/** 复查确认：按实收入库（占用转为库存），索赔兑现，冻结解除。 */
export function confirmOrder(id: string, note: string): ActionResult {
  const order = store.orders.find((o) => o.id === id);
  if (!order) return { ok: false, message: "单据不存在。" };
  if (order.status !== "冻结待复查") return { ok: false, message: "仅冻结待复查单据可复查。" };

  const tank = getTank(order.stationId, order.product);
  if (!tank) return { ok: false, message: "该油站已无对应罐型，无法入库。" };

  tank.pending = Math.max(0, tank.pending - order.receivedQty);
  tank.stock += order.receivedQty;
  order.status = "复查已入库";
  order.reviewNote = note.trim() || "复查确认，按实收入库。";
  order.reviewedAt = new Date().toISOString();
  return {
    ok: true,
    message: `单据 ${order.no} 已按实收 ${order.receivedQty}L 入库${
      order.claimQty > 0 ? `，索赔 ${order.claimQty}L 已兑现。` : "。"
    }`
  };
}

/** 退回：必须写原因；库存与罐容占用保持原样（冻结的占用同时释放）。 */
export function rejectOrder(id: string, reason: string): ActionResult {
  const order = store.orders.find((o) => o.id === id);
  if (!order) return { ok: false, message: "单据不存在。" };
  if (order.status !== "冻结待复查") return { ok: false, message: "仅冻结待复查单据可退回。" };
  if (!reason.trim()) return { ok: false, message: "退回必须填写原因。" };

  const tank = getTank(order.stationId, order.product);
  if (tank) tank.pending = Math.max(0, tank.pending - order.receivedQty);
  order.status = "退回";
  order.reviewNote = reason.trim();
  order.reviewedAt = new Date().toISOString();
  return { ok: true, message: `单据 ${order.no} 已退回，库存未发生变化。` };
}
