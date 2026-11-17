// Keep live packets bounded: snapshots/replays are fetched explicitly, moves append by index.
export function liveState(view){
  const {moves,initialBoard,initialParty,...game}=view.game||view;
  const packet={...game,movesAppend:moves.slice(-1),moveCount:moves.length,...(!moves.length?{initialBoard,initialParty}:{})};
  return view.game?{...view,game:packet}:packet;
}
