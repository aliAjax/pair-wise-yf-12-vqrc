import type { FuelType, TankState } from "./model";

/** 差量允许损耗率：千分之五 */
export const DIFF_TOLERANCE = 0.005;

export interface ArrivalInput {
  stationId: string;
  fuel: "" | FuelType;
  paperQty: number | null;
  actualQty: number | null;
  sealNo: string;
  reason: string;
}

export function tankRemaining(tank: TankState): number {
  return tank.capacity - tank.stock - tank.frozen;
}

/** 差量率 =（单据量 - 实收量）/ 单据量，仅短少（正数）可能超阈 */
export function diffRate(paperQty: number, actualQty: number): number {
  if (paperQty <= 0) return 0;
  return (paperQty - actualQty) / paperQty;
}

export function isDiffOverThreshold(paperQty: number, actualQty: number): boolean {
  return diffRate(paperQty, actualQty) > DIFF_TOLERANCE;
}

/**
 * 到站登记校验。
 * 任一规则不通过都返回错误文案，调用方必须整单拒绝、不写任何状态。
 */
export function validateRegistration(input: ArrivalInput, tank?: TankState): string | null {
  if (!input.stationId) return "请选择油站";
  if (!input.fuel) return "请选择油品";

  if (input.paperQty === null || Number.isNaN(input.paperQty)) return "请填写单据量";
  if (input.actualQty === null || Number.isNaN(input.actualQty)) return "请填写实收量";
  if (input.paperQty <= 0) return "单据量必须大于 0";
  if (input.actualQty <= 0) return "实收量必须大于 0";

  if (!tank) return "未找到对应油罐";
  if (input.actualQty > tankRemaining(tank)) {
    return `实收量超过罐容：${tank.fuel} 剩余可用 ${tankRemaining(tank)} L（罐容 ${tank.capacity} L）`;
  }

  if (isDiffOverThreshold(input.paperQty, input.actualQty)) {
    if (!input.sealNo.trim()) return "差量超过千分之五，必须填写铅封编号";
    if (!input.reason.trim()) return "差量超过千分之五，必须填写差量原因";
  }

  return null;
}

/** 复查退回必须填写原因 */
export function validateRejectReason(reason: string): string | null {
  if (!reason.trim()) return "退回必须填写原因";
  return null;
}
