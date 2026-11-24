// Process-local protection. Shared deployments should enforce an additional
// distributed edge limit; never use Origin as proof of authentication.
export function createTrafficGuard({disabled=false,now=Date.now,log=console.warn}={}){
  const buckets=new Map();let lastLog=-Infinity,suppressed=0;
  function allow(key,maximum,windowMs){
    if(disabled)return {ok:true,retryAfter:0};
    const time=now();let bucket=buckets.get(key);
    if(!bucket||bucket.until<=time){
      if(buckets.size>=20000){for(const [id,value]of buckets)if(value.until<=time)buckets.delete(id);}
      if(buckets.size>=20000&&!buckets.has(key))return {ok:false,retryAfter:60};
      bucket={count:0,until:time+windowMs};buckets.set(key,bucket);
    }
    const ok=++bucket.count<=maximum;
    if(!ok){suppressed++;if(time-lastLog>=60000){log(JSON.stringify({event:'request-storm',rejected:suppressed,scope:key.split(':')[0]}));lastLog=time;suppressed=0;}}
    return {ok,retryAfter:ok?0:Math.max(1,Math.ceil((bucket.until-time)/1000))};
  }
  function middleware(scope,maximum,windowMs){return(req,res,next)=>{
    const result=allow(`${scope}:${req.ip}`,maximum,windowMs);
    if(result.ok)return next();
    res.set('Retry-After',String(result.retryAfter)).status(429).json({error:'Bạn thao tác quá nhanh. Vui lòng thử lại sau.'});
  };}
  return {allow,middleware};
}

export function concurrencyGuard({maximum=128,perIp=16}={}){
  let active=0;const ips=new Map();
  return(req,res,next)=>{
    const ip=req.ip;
    if(active>=maximum||(ips.get(ip)||0)>=perIp)return res.set('Retry-After','2').status(503).json({error:'Máy chủ đang bận. Vui lòng thử lại sau.'});
    active++;ips.set(ip,(ips.get(ip)||0)+1);let done=false;
    const release=()=>{if(done)return;done=true;active--;const count=ips.get(ip)-1;if(count)ips.set(ip,count);else ips.delete(ip);};
    res.once('finish',release);res.once('close',release);next();
  };
}
