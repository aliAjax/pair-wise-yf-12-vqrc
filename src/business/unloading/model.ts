import { computed, reactive, watch } from "vue";
import {
  validateRegistration,
  validateRejectReason
} from "./validation";
import type { ArrivalInput } from "./validation";

/** 油品 */
export type FuelType = "92#汽油" | "95#汽油" | "0#柴油";

/** 索赔单状态：登记即冻结，复查后确认入库或退回 */
export type ClaimStatus = "冻结中" | "已确认入库" | "已退回";

export type FilterValue = "全部" | ClaimStatus;

export interface Station {
  id: string;
  name: string;
  area: string;
  manager: string;
}

/** 油罐动态状态：库存 + 冻结占用不得超过罐容 */
export interface TankState {
  stationId: string;
  fuel: FuelType;
  capacity: number;
  stock: number;
  frozen: number;
}

/** 一次到站卸油登记（索赔单） */
export interface ClaimRecord {
  id: string;
  stationId: string;
  fuel: FuelType;
  paperQty: number;
  actualQty: number;
  diff: number;
  sealNo: string;
  reason: string;
  status: ClaimStatus;
  createdAt: string;
  reviewedAt?: string;
  rejectReason?: string;
}

export interface AppState {
  tanks: TankState[];
  claims: ClaimRecord[];
  filter: FilterValue;
}

export interface RegisterResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface RejectResult {
  ok: boolean;
  error?: string;
}

export interface MetricItem {
  label: string;
  value: number;
  unit: string;
}

export const STATIONS: readonly Station[] = [
  { id: "east", name: "东区一站", area: "东区", manager: "刘站长" },
  { id: "west", name: "西区二站", area: "西区", manager: "陈站长" },
  { id: "airport", name: "机场快线站", area: "机场线", manager: "王站长" }
];

export const FUELS: readonly FuelType[] = ["92#汽油", "95#汽油", "0#柴油"];

export const CLAIM_STATUSES: readonly ClaimStatus[] = ["冻结中", "已确认入库", "已退回"];

export const FILTERS: readonly FilterValue[] = ["全部", ...CLAIM_STATUSES];

const STORAGE_KEY = "hxwlfront-21-unloading-claims-v1";

/** 各油罐：罐容上限与期初库存（索赔种子数据在期初之上推演，保证账实一致） */
const TANK_CONFIG: Record<string, Record<FuelType, { capacity: number; base: number }>> = {
  east: {
    "92#汽油": { capacity: 40000, base: 8000 },
    "95#汽油": { capacity: 30000, base: 14000 },
    "0#柴油": { capacity: 30000, base: 9000 }
  },
  west: {
    "92#汽油": { capacity: 30000, base: 18000 },
    "95#汽油": { capacity: 25000, base: 12000 },
    "0#柴油": { capacity: 20000, base: 7000 }
  },
  airport: {
    "92#汽油": { capacity: 20000, base: 9000 },
    "95#汽油": { capacity: 15000, base: 5000 },
    "0#柴油": { capacity: 30000, base: 6000 }
  }
};

interface SeedClaim {
  stationId: string;
  fuel: FuelType;
  paperQty: number;
  actualQty: number;
  sealNo: string;
  reason: string;
  createdAtDaysAgo: number;
  status: ClaimStatus;
  reviewedDaysAgo?: number;
  rejectReason?: string;
}

const SEED_CLAIMS: readonly SeedClaim[] = [
  {
    stationId: "east",
    fuel: "92#汽油",
    paperQty: 32000,
    actualQty: 31800,
    sealNo: "SEAL-20260910-01",
    reason: "运输途耗，到站铅封完好，与出库单据编号一致",
    createdAtDaysAgo: 12,
    status: "已确认入库",
    reviewedDaysAgo: 10
  },
  {
    stationId: "airport",
    fuel: "0#柴油",
    paperQty: 20000,
    actualQty: 19820,
    sealNo: "SEAL-20260918-07",
    reason: "承运车途中异常颠簸，怀疑罐体浮量，待地泵复核",
    createdAtDaysAgo: 4,
    status: "冻结中"
  },
  {
    stationId: "west",
    fuel: "92#汽油",
    paperQty: 26000,
    actualQty: 25800,
    sealNo: "SEAL-20260905-12",
    reason: "疑似罐底残油导致计量偏差",
    createdAtDaysAgo: 17,
    status: "已退回",
    reviewedDaysAgo: 16,
    rejectReason: "复查地泵复核差量在允耗范围内，索赔依据不足，予以退回"
  }
];

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(9, 15, 0, 0);
  return date.toISOString();
}

/** 期初库存 + 按种子索赔单推演：冻结单占 frozen，确认单入 stock，退单无影响 */
function buildSeed(): AppState {
  const tanks: TankState[] = [];
  for (const station of STATIONS) {
    for (const fuel of FUELS) {
      const config = TANK_CONFIG[station.id][fuel];
      tanks.push({
        stationId: station.id,
        fuel,
        capacity: config.capacity,
        stock: config.base,
        frozen: 0
      });
    }
  }

  const claims: ClaimRecord[] = SEED_CLAIMS.map((seed, index) => {
    const tank = tanks.find((item) => item.stationId === seed.stationId && item.fuel === seed.fuel)!;
    if (seed.status === "冻结中") tank.frozen += seed.actualQty;
    if (seed.status === "已确认入库") tank.stock += seed.actualQty;
    return {
      id: `seed-${index + 1}`,
      stationId: seed.stationId,
      fuel: seed.fuel,
      paperQty: seed.paperQty,
      actualQty: seed.actualQty,
      diff: seed.paperQty - seed.actualQty,
      sealNo: seed.sealNo,
      reason: seed.reason,
      status: seed.status,
      createdAt: daysAgoIso(seed.createdAtDaysAgo),
      reviewedAt: seed.reviewedDaysAgo !== undefined ? daysAgoIso(seed.reviewedDaysAgo) : undefined,
      rejectReason: seed.rejectReason
    };
  });

  return { tanks, claims, filter: "全部" };
}

function loadState(): AppState {
  const seed = buildSeed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    if (!Array.isArray(parsed.tanks) || !Array.isArray(parsed.claims)) return seed;
    return {
      tanks: parsed.tanks as TankState[],
      claims: parsed.claims as ClaimRecord[],
      filter: parsed.filter && FILTERS.includes(parsed.filter) ? parsed.filter : "全部"
    };
  } catch {
    return seed;
  }
}

export const state = reactive<AppState>(loadState());

watch(
  state,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // 存储不可用时仅保留内存态
    }
  },
  { deep: true }
);

function tankOf(stationId: string, fuel: FuelType): TankState | undefined {
  return state.tanks.find((tank) => tank.stationId === stationId && tank.fuel === fuel);
}

export function stationName(stationId: string): string {
  return STATIONS.find((station) => station.id === stationId)?.name ?? "未知油站";
}

export function tankRemaining(tank: TankState): number {
  return tank.capacity - tank.stock - tank.frozen;
}

/**
 * 到站登记：先校验，通过后才写状态。
 * 实收量冻结占用罐容，库存不动，等待复查。
 */
export function registerArrival(input: ArrivalInput): RegisterResult {
  const tank = input.fuel ? tankOf(input.stationId, input.fuel) : undefined;
  const error = validateRegistration(input, tank);
  if (error) return { ok: false, error };
  if (!tank || !input.fuel || input.paperQty === null || input.actualQty === null) {
    return { ok: false, error: "登记信息不完整" };
  }

  const claim: ClaimRecord = {
    id: crypto.randomUUID(),
    stationId: input.stationId,
    fuel: input.fuel,
    paperQty: input.paperQty,
    actualQty: input.actualQty,
    diff: input.paperQty - input.actualQty,
    sealNo: input.sealNo.trim(),
    reason: input.reason.trim(),
    status: "冻结中",
    createdAt: new Date().toISOString()
  };

  tank.frozen += claim.actualQty;
  state.claims.unshift(claim);
  return { ok: true, id: claim.id };
}

/** 复查确认：冻结释放，按实收量入库，索赔关闭 */
export function confirmClaim(id: string): boolean {
  const claim = state.claims.find((item) => item.id === id);
  if (!claim || claim.status !== "冻结中") return false;
  const tank = tankOf(claim.stationId, claim.fuel);
  if (!tank) return false;

  tank.frozen = Math.max(0, tank.frozen - claim.actualQty);
  tank.stock += claim.actualQty;
  claim.status = "已确认入库";
  claim.reviewedAt = new Date().toISOString();
  return true;
}

/** 复查退回：必须填写原因，冻结释放、库存不变 */
export function returnClaim(id: string, reason: string): RejectResult {
  const reasonError = validateRejectReason(reason);
  if (reasonError) return { ok: false, error: reasonError };

  const claim = state.claims.find((item) => item.id === id);
  if (!claim || claim.status !== "冻结中") return { ok: false, error: "索赔单状态不允许退回" };
  const tank = tankOf(claim.stationId, claim.fuel);
  if (!tank) return { ok: false, error: "未找到对应油罐" };

  tank.frozen = Math.max(0, tank.frozen - claim.actualQty);
  claim.status = "已退回";
  claim.rejectReason = reason.trim();
  claim.reviewedAt = new Date().toISOString();
  return { ok: true };
}

export const filteredClaims = computed<ClaimRecord[]>(() => {
  if (state.filter === "全部") return state.claims;
  return state.claims.filter((claim) => claim.status === state.filter);
});

export const metrics = computed<MetricItem[]>(() => {
  const frozen = state.claims.filter((claim) => claim.status === "冻结中");
  const confirmed = state.claims.filter((claim) => claim.status === "已确认入库");
  const claimDiff = [...frozen, ...confirmed].reduce((sum, claim) => sum + claim.diff, 0);
  return [
    { label: "待复查索赔", value: frozen.length, unit: "笔" },
    { label: "已确认入库", value: confirmed.length, unit: "笔" },
    { label: "索赔差量合计", value: claimDiff, unit: "L" }
  ];
});

export const chartRows = computed(() =>
  CLAIM_STATUSES.map((status) => ({
    status,
    value: state.claims.filter((claim) => claim.status === status).length
  }))
);

export const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));
