/**
 * 卸油差量索赔 · 校验规则
 * 纯函数、不碰存储：登记前的全部硬性规则都在这里，
 * 任一不过即整单拒绝（库存、索赔、罐容占用保持原样，由 model 保证不落单）。
 */
import type { ProductCode, TankState } from "./model";

/** 差量容忍阈值：千分之五 */
export const SHORTAGE_LIMIT = 0.005;

export type TankLookup = (stationId: string, product: ProductCode) => TankState | undefined;

export type RegisterPayload = {
  stationId: string;
  product: ProductCode | "";
  documentQty: number;
  receivedQty: number;
  sealNo: string;
  reason: string;
};

export type ValidationResult =
  | { ok: true; shortage: number; rate: number; claimQty: number }
  | { ok: false; message: string };

/**
 * 登记校验：
 * 1. 油站、油品必填，罐型存在；
 * 2. 单据量 > 0，实收量 >= 0；实收不得超过罐容（按当前占用后的可用容量）；
 * 3. 差量比例超过 5‰ 时，铅封编号和原因必须同时填写，否则整单拒绝。
 */
export function validateRegister(payload: RegisterPayload, tankOf: TankLookup): ValidationResult {
  if (!payload.stationId) {
    return { ok: false, message: "请选择到站油站。" };
  }
  if (!payload.product) {
    return { ok: false, message: "请选择油品。" };
  }

  const documentQty = Number(payload.documentQty);
  const receivedQty = Number(payload.receivedQty);
  if (!Number.isFinite(documentQty) || documentQty <= 0) {
    return { ok: false, message: "单据量必须为大于 0 的数字（升）。" };
  }
  if (!Number.isFinite(receivedQty) || receivedQty < 0) {
    return { ok: false, message: "实收量必须为不小于 0 的数字（升）。" };
  }
  if (receivedQty > documentQty) {
    return { ok: false, message: "实收量不得大于单据量，请先核对磅单。" };
  }

  const tank = tankOf(payload.stationId, payload.product);
  if (!tank) {
    return { ok: false, message: "该油站未配置此油品的储罐，无法登记。" };
  }

  // 罐容占用 = 已有库存 + 冻结待复查的实收量，本次实收必须落在剩余可用容量内
  const occupied = tank.stock + tank.pending;
  const available = tank.capacity - occupied;
  if (receivedQty > available + 1e-6) {
    return {
      ok: false,
      message: `实收 ${receivedQty}L 超出罐容：罐容 ${tank.capacity}L，已占用 ${occupied}L（库存 ${tank.stock}L + 冻结 ${tank.pending}L），仅剩 ${available}L。`
    };
  }

  const shortage = documentQty - receivedQty;
  const rate = documentQty > 0 ? shortage / documentQty : 0;
  const overLimit = shortage > 0 && rate > SHORTAGE_LIMIT;

  if (overLimit) {
    if (!payload.sealNo.trim() || !payload.reason.trim()) {
      return {
        ok: false,
        message: `差量 ${shortage}L（${(rate * 1000).toFixed(2)}‰）超过 5‰，必须填写铅封编号和差量原因，否则整单拒绝。`
      };
    }
  }

  // 超阈值才立索赔，索赔量按单据量与实收量的差冻结；未超阈值 claimQty = 0
  return { ok: true, shortage, rate, claimQty: overLimit ? shortage : 0 };
}

/** 表单实时预览用：不报错，只给当前差量与是否触阈 */
export function previewShortage(documentQty: number, receivedQty: number) {
  const doc = Number(documentQty);
  const recv = Number(receivedQty);
  if (!Number.isFinite(doc) || doc <= 0 || !Number.isFinite(recv) || recv < 0) {
    return { shortage: 0, rate: 0, overLimit: false };
  }
  const shortage = Math.max(0, doc - recv);
  const rate = shortage / doc;
  return { shortage, rate, overLimit: shortage > 0 && rate > SHORTAGE_LIMIT };
}
