import {GameError} from './game.js';

// Fail fast under overload; do not build an unbounded queue of SQL transactions.
export function createActionGate({maximum=128,perPlayer=4}={}){
  let running=0;const players=new Map();
  return async(actor,work)=>{
    if((players.get(actor)||0)>=perPlayer)throw new GameError('Đang xử lý thao tác trước. Vui lòng chờ.',429);
    if(running>=maximum)throw new GameError('Máy chủ đang bận. Vui lòng thử lại sau.',503);
    running++;players.set(actor,(players.get(actor)||0)+1);
    try{return await work();}
    finally{running--;const left=players.get(actor)-1;if(left)players.set(actor,left);else players.delete(actor);}
  };
}
