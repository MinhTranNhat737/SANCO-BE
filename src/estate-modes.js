import { randomInt } from 'node:crypto';
import { GameError } from './game.js';

export function validateEstateMode(value) {
  if (value !== undefined && !['auto', 'classic'].includes(value)) throw new GameError('Chế độ Tỷ phú không hợp lệ.');
  return value;
}

export function estateProfile(count, selection) {
  validateEstateMode(selection);
  if (selection === undefined) return null; // Preserve rules of existing vn-v2 games.
  const base = { version: 4, selection, playerCount: count, startingCash: 3000, salary: 500, initialLots: 0, roundLimit: null, marketEvery: 0, auctionOnPass: true, groupBuild: true, turnSeconds: 30, maxOffers: 2 };
  if (selection === 'classic') return { ...base, id: 'classic', name: 'Cổ điển', maxCounters: 0 };
  return { ...base, id: 'creative', name: 'Sáng tạo', maxCounters: 3 };
}

const MARKETS = [
  { id: 'tourism', name: 'Mùa du lịch', description: 'Tiền thuê tăng 25%; giá đất giữ nguyên.', rentPercent: 125, buildPercent: 100, salaryPercent: 100 },
  { id: 'infrastructure', name: 'Gói phát triển hạ tầng', description: 'Giảm 20% chi phí xây dựng mới trong chu kỳ này.', rentPercent: 100, buildPercent: 80, salaryPercent: 100 },
  { id: 'cooldown', name: 'Thị trường hạ nhiệt', description: 'Tiền thuê giảm 20%, tạo thời cơ tái cơ cấu tài sản.', rentPercent: 80, buildPercent: 100, salaryPercent: 100 },
  { id: 'support', name: 'Quỹ hỗ trợ khởi nghiệp', description: 'Thu nhập qua Xuất phát tăng 25% trong chu kỳ này.', rentPercent: 100, buildPercent: 100, salaryPercent: 125 },
  { id: 'recovery', name: 'Nhịp phục hồi', description: 'Tiền thuê tăng 10%, chi phí xây dựng mới giảm 10%.', rentPercent: 110, buildPercent: 90, salaryPercent: 100 },
];

export function changeMarket(p, pick = randomInt) {
  const every = p.profile?.marketEvery;
  if (!every || p.round <= 1 || (p.round - 1) % every !== 0) return null;
  const available = MARKETS.filter(item => item.id !== p.market?.id);
  p.market = { ...available[pick(available.length)], startRound: p.round, endRound: p.round + every - 1 };
  return p.market;
}

export const estateSalary = p => Math.ceil((p.profile?.salary ?? 500) * (p.market?.salaryPercent ?? 100) / 100);
export const adjustedRent = (p, amount) => Math.ceil(amount * (p.market?.rentPercent ?? 100) / 100);
export const adjustedBuildCost = (p, amount) => Math.ceil(amount * (p.market?.buildPercent ?? 100) / 100);
