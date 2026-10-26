import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../deploy/monitor-runtime-probe.mjs", import.meta.url), "utf8");
const signalFields = ["requestsPerSecond", "serverErrorPercent", "clientErrorPercent", "successP95Ms", "successP99Ms", "failureP95Ms", "failureP99Ms", "responseBytesPerSecond"];
const fields = ["cpuPercent", "memoryPercent", "swapPercent", "diskPercent", "diskReadBytesPerSecond", "diskWriteBytesPerSecond", "rxBytesPerSecond", "txBytesPerSecond"];
const counts = { "1h":1201,"24h":289,"7d":337 };

async function probe(change = () => {}) {
  const now = Date.now(), iso = new Date(now).toISOString();
  const output = [], failures = [], paths = [];
  const process = { env:{MONITOR_RUNTIME_PROBE:"1",HOSTNAME:"127.0.0.1",MONITOR_EXPORTER_MODE:"standard",MONITOR_PROMETHEUS_CUTOVER_AT:new Date(now-60000).toISOString()} };
  const reply = (status, data, text = "") => ({status,headers:new Headers({"cache-control":"no-store"}),json:async()=>data,text:async()=>text});
  const fetch = async (address, options={}) => {
    const url = new URL(address), cookie = options.headers?.Cookie, owner = cookie?.endsWith("r".repeat(43));
    paths.push(url.pathname+url.search);
    let response;
    if(url.pathname==="/api/monitor/auth/grafana") response=reply(404);
    else if(url.pathname==="/server-monitor") response=reply(200,null,"<main>自有监控页面</main>");
    else if(!owner) response=reply(401);
    else if(url.searchParams.get("service")==="invalid"||url.searchParams.get("range")==="invalid") response=reply(400);
    else if(url.pathname==="/api/monitor/current") response=reply(200,{stale:false,checksStale:false,sample:{
      collectedAt:iso,checksCollectedAt:iso,hostId:"cloud-primary",
      host:{cpu:{percent:0},network:{rxBytesPerSecond:0,txBytesPerSecond:0},disk:{readBytesPerSecond:0,writeBytesPerSecond:0,usedPercent:40},memory:{totalBytes:1000,usedPercent:50},swap:{usedPercent:0}},
      containers:Array.from({length:3},()=>({state:"running",image:"test:revision",restartCount:0,cpuPercent:0,memoryBytes:20,memoryLimitBytes:1000,memoryPercent:2})),
      services:Array.from({length:11},()=>({kind:"process",status:"healthy"})),
    }});
    else if(url.pathname==="/api/monitor/signals/current") response=reply(200,{
      service:url.searchParams.get("service")||"all",stale:false,staleAfterSeconds:9,exporterUp:true,parseErrorsTotal:0,
      collectedAt:iso,recordedAt:iso,trafficState:"no_data",metrics:Object.fromEntries(signalFields.map((field)=>[field,null])),
    });
    else if(url.pathname.endsWith("/history")) {
      const range=url.searchParams.get("range"), signals=url.pathname.includes("/signals/");
      const points=Array.from({length:counts[range]},(_,index)=>({collectedAt:iso,...Object.fromEntries((signals?signalFields:fields).map((field)=>[field,signals||index===0?null:0]))}));
      response=reply(200,{range,points});
    } else throw new Error("unexpected_mock_request");
    change(url,response,owner);
    return response;
  };
  await vm.runInNewContext("(async()=>{\n"+source+"\n})()",{fetch,Headers,AbortSignal,URL,Date,Number,JSON,process,
    console:{log:(line)=>output.push(JSON.parse(line)),error:(line)=>failures.push(line)},setTimeout});
  return {process,output,failures,paths};
}

test("compiled gate accepts honest no-data HTTP signals and checks all ranges/services", async()=>{
  const result=await probe();
  assert.equal(result.process.exitCode,undefined);
  assert.deepEqual(result.failures,[]);
  assert.equal(result.output[0].customPage,200);
  assert.equal(result.output[0].retiredAuthorization,404);
  assert.deepEqual(Object.keys(result.output[0].signals),["all","website","whiteboard","study-agent"]);
  for(const range of Object.keys(counts)) assert.ok(result.paths.includes("/api/monitor/signals/history?range="+range));
});

test("compiled gate rejects stale source, missing signal fields, and old iframe shell",async()=>{
  for(const mutate of [
    (url,response,owner)=>{if(owner&&url.pathname==="/api/monitor/signals/current") {const json=response.json;response.json=async()=>({...await json(),collectedAt:new Date(Date.now()-15000).toISOString()});}},
    (url,response,owner)=>{if(owner&&url.pathname==="/api/monitor/signals/current") {const json=response.json;response.json=async()=>{const data=await json();delete data.metrics.requestsPerSecond;return data;};}},
    (url,response)=>{if(url.pathname==="/server-monitor") response.text=async()=>"<iframe src='/server-monitor/grafana/'>";},
  ]) {
    const result=await probe(mutate);
    assert.equal(result.process.exitCode,1);
    assert.equal(result.output.length,0);
    assert.match(result.failures[0],/^runtime_(signals_current_contract_invalid|custom_page_embeds_retired_dashboard)$/);
  }
});

test("compiled gate rejects auth bypass before validating signal query enums",async()=>{
  const result=await probe((url,response,owner)=>{if(!owner&&url.pathname.includes("/signals/")&&url.searchParams.has("service"))response.status=400;});
  assert.equal(result.process.exitCode,1);
  assert.deepEqual(result.failures,["runtime_signals_auth_order_invalid"]);
});
