/** Container hints only: reads may be incomplete/unverified rqbit storage.
 * They never become decoder/cache bytes. A hint can only prioritize one byte
 * inside the already selected torrent; rqbit still verifies its entire piece. */
export async function inspectMp4Index(readAt, fileLength, pieceLength) {
  if(!Number.isSafeInteger(fileLength)||fileLength<16)return {state:'none'};
  const headPiece=Number.isSafeInteger(pieceLength)&&pieceLength>0?pieceLength:1024*1024;
  let offset=0,media=false;
  for(let count=0;count<16&&offset+8<=fileLength;count++){
    const header=await readAt(offset,Math.min(16,fileLength-offset));
    if(!header||header.length<8)return {state:'wait'};
    if(header.every(byte=>byte===0))return media&&offset>=headPiece?{state:'index',offset}:{state:'wait'};
    const type=header.toString('ascii',4,8);
    if(offset===0&&type!=='ftyp')return {state:'none'};
    if(type==='moov')return media?{state:'index',offset}:{state:'none'};
    let size=header.readUInt32BE(0);
    if(size===1){
      if(header.length<16)return {state:'wait'};
      const large=header.readBigUInt64BE(8);
      if(large>BigInt(Number.MAX_SAFE_INTEGER)||large<16n)return {state:'none'};
      size=Number(large);
    }
    if(size<8||size>fileLength-offset)return {state:'none'};
    if(type==='mdat')media=true;
    offset+=size;
  }
  return {state:'none'};
}
