import {randomInt} from 'node:crypto';
import {GameError} from './game.js';

export function validateEstateMode(value){
  if(value!==undefined&&!['auto','classic'].includes(value))throw new GameError('Chế độ Tỷ phú không hợp lệ.');
  return value;
}

export function estateProfile(count,selection){
  validateEstateMode(selection);
  if(selection===undefined)return null; // Preserve rules of existing vn-v2 games.
  const base={version:3,selection,playerCount:count,auctionOnPass:true,turnSeconds:30,maxCounters:3,maxOffers:2};
  if(selection==='classic')return {...base,id:'classic',name:'Cổ điển',startingCash:3000,salary:400,initialLots:0,roundLimit:null,marketEvery:0};
  if(count===2)return {...base,id:'duel',name:'Đối đầu khởi nghiệp',startingCash:2600,salary:350,initialLots:2,roundLimit:18,marketEvery:3};
  if(count<=4)return {...base,id:'market',name:'Thương trường',startingCash:3000,salary:400,initialLots:1,roundLimit:24,marketEvery:3};
  return {...base,id:'festival',name:'Đại hội địa ốc',startingCash:2800,salary:450,initialLots:1,roundLimit:16,marketEvery:2};
}

const MARKETS=[
  {id:'tourism',name:'Mùa du lịch',description:'Tiền thuê tăng 25%; giá đất giữ nguyên.',rentPercent:125,buildPercent:100,salaryPercent:100},
  {id:'infrastructure',name:'Gói phát triển hạ tầng',description:'Giảm 20% chi phí xây dựng mới trong chu kỳ này.',rentPercent:100,buildPercent:80,salaryPercent:100},
  {id:'cooldown',name:'Thị trường hạ nhiệt',description:'Tiền thuê giảm 20%, tạo thời cơ tái cơ cấu tài sản.',rentPercent:80,buildPercent:100,salaryPercent:100},
  {id:'support',name:'Quỹ hỗ trợ khởi nghiệp',description:'Thu nhập qua Xuất phát tăng 25% trong chu kỳ này.',rentPercent:100,buildPercent:100,salaryPercent:125},
  {id:'recovery',name:'Nhịp phục hồi',description:'Tiền thuê tăng 10%, chi phí xây dựng mới giảm 10%.',rentPercent:110,buildPercent:90,salaryPercent:100},
];

export function changeMarket(p,pick=randomInt){
  const every=p.profile?.marketEvery;
  if(!every||p.round<=1||(p.round-1)%every!==0)return null;
  const available=MARKETS.filter(item=>item.id!==p.market?.id);
  p.market={...available[pick(available.length)],startRound:p.round,endRound:p.round+every-1};
  return p.market;
}

export const estateSalary=p=>Math.ceil((p.profile?.salary??400)*(p.market?.salaryPercent??100)/100);
export const adjustedRent=(p,amount)=>Math.ceil(amount*(p.market?.rentPercent??100)/100);
export const adjustedBuildCost=(p,amount)=>Math.ceil(amount*(p.market?.buildPercent??100)/100);
