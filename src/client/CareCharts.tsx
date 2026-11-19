import React,{useEffect,useMemo,useRef,useState} from 'react';
import * as echarts from 'echarts/core';
import {LineChart,BarChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,LegendComponent,DataZoomComponent,AriaComponent} from 'echarts/components';
import {SVGRenderer} from 'echarts/renderers';
import type {EChartsOption} from 'echarts';
import type {Entry} from '../shared.ts';
import {Help} from './Details.tsx';
import {dayInput} from '../time.ts';
import {startDensity,breastBalance,durationLabel,type DaySummary,type Track} from '../dashboard.ts';
echarts.use([LineChart,BarChart,GridComponent,TooltipComponent,LegendComponent,DataZoomComponent,AriaComponent,SVGRenderer]);
const colors=['#6e63b8','#ae5a7c','#427b62','#367b99','#687187'];
const names:Record<Track,string>={sleep:'Sleep',feeding:'Feeding',nappy:'Nappy changes',bath:'Bath',other:'Other activities'};
const clock=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
export function Chart({option,label,onZoom}:{option:EChartsOption;label:string;onZoom?:(from:string,to:string)=>void}){
 const element=useRef<HTMLDivElement>(null),instance=useRef<echarts.EChartsType|null>(null);
 const callbacks=useRef({onZoom});callbacks.current={onZoom};
 useEffect(()=>{
  const chart=echarts.init(element.current!,undefined,{renderer:'svg'});instance.current=chart;
  const observer=new ResizeObserver(()=>chart.resize());observer.observe(element.current!);
  chart.on('datazoom',()=>{
   const zoom=(chart.getOption().dataZoom as {startValue:number;endValue:number}[])?.[0];
   if(zoom&&Number.isFinite(zoom.startValue)&&Number.isFinite(zoom.endValue)&&callbacks.current.onZoom)callbacks.current.onZoom(new Date(zoom.startValue).toISOString().slice(0,10),new Date(zoom.endValue).toISOString().slice(0,10));
  });
  return ()=>{observer.disconnect();chart.dispose();instance.current=null;};
 },[]);
 useEffect(()=>{instance.current?.setOption(option,{replaceMerge:['series']});},[option]);
 return <div ref={element} className="care-chart" role="img" aria-label={label}/>;
}
const base:EChartsOption={animation:false,color:colors,textStyle:{fontFamily:'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',color:'#58637a'},aria:{enabled:false},tooltip:{trigger:'axis',confine:true,renderMode:'richText'},legend:{bottom:0,type:'scroll'},grid:{left:48,right:24,top:35,bottom:72,containLabel:true}};
export function RangeNavigator({entries,from,to,onRange}:{entries:Entry[];from:string;to:string;onRange:(from:string,to:string)=>void}){
 const option=useMemo<EChartsOption>(()=>{
  const counts=new Map<string,number>();for(const e of entries){const day=dayInput(e.startAt);counts.set(day,(counts.get(day)??0)+1);}
  const dates=[from,to,dayInput(),...counts.keys()].sort();const min=Date.parse(dates[0]),max=Math.max(min+86400000,Date.parse(dates.at(-1)!));
  return {animation:false,grid:{left:16,right:16,top:0,bottom:0},xAxis:{type:'time',min,max,show:false},yAxis:{type:'value',show:false},series:[{type:'line',showSymbol:false,data:[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([d,n])=>[Date.parse(d),n]),lineStyle:{color:'#6e63b8'},areaStyle:{color:'#deddf7'}}],dataZoom:[{type:'slider',xAxisIndex:0,startValue:Date.parse(from),endValue:Date.parse(to),maxValueSpan:365*86400000,filterMode:'none',realtime:false,bottom:10,height:34,showDetail:false,brushSelect:false,handleSize:26,moveHandleSize:10,borderColor:'#c3c6d7',fillerColor:'#6e63b833'}]};
 },[entries,from,to]);
 return <div className="range-navigator"><Chart option={option} label="Date overview. Drag the handles to change the selected dates." onZoom={onRange}/></div>;
}
export function CareCharts({entries,days,filter}:{entries:Entry[];days:DaySummary[];filter:Track|'all'}){
 const [bandwidth,setBandwidth]=useState(60);
 const from=days[0].day,to=days.at(-1)!.day;
 const density=useMemo(()=>startDensity(entries,from,to,bandwidth).filter(g=>g.track!=='other'&&(filter==='all'||g.track===filter)),[entries,from,to,bandwidth,filter]);
 const balance=useMemo(()=>breastBalance(entries,from,to),[entries,from,to]);
 const timed=balance.left+balance.right;
 const balanceOption=useMemo<EChartsOption>(()=>({...base,color:['#ae5a7c','#6e63b8'],grid:{left:12,right:16,top:40,bottom:60,containLabel:true},legend:{bottom:0,data:['Left','Right']},xAxis:{type:'category',data:balance.days.map(d=>d.day.slice(5)),axisLabel:{hideOverlap:true}},yAxis:{type:'value',name:'Minutes'},series:([{name:'Left',key:'left'},{name:'Right',key:'right'}] as const).map(s=>({name:s.name,type:'bar',barMaxWidth:24,data:balance.days.map(d=>Math.round(d[s.key]*100)/100)}))}),[balance]);
 const pattern=useMemo<EChartsOption>(()=>({...base,xAxis:{type:'value',min:0,max:1440,interval:360,axisLabel:{formatter:clock}},yAxis:{type:'value',name:'Start density (% / hour)'},series:density.map(g=>({name:`${names[g.track]} (${g.count})`,type:'line',showSymbol:false,data:g.points,lineStyle:{width:2,color:colors[(['sleep','feeding','nappy','bath','other'] as Track[]).indexOf(g.track)]},itemStyle:{color:colors[(['sleep','feeding','nappy','bath','other'] as Track[]).indexOf(g.track)]}}))}),[density]);
 return <div className="care-analytics">
  {(filter==='all'||filter==='feeding')&&<section aria-label="Breastfeeding balance"><div className="analytics-heading"><h2>Left vs right</h2></div><p className="chart-help">Breastfeeding time in the selected dates.</p><dl className="breast-balance-totals">{([{side:'Left',value:balance.left},{side:'Right',value:balance.right}]).map(item=><div key={item.side}><dt>{item.side}</dt><dd>{durationLabel(item.value)} <span>{timed>0?Math.round(item.value/timed*100)+'%':'No timed records'}</span></dd></div>)}</dl>{timed>0?<Chart option={balanceOption} label="Daily breastfeeding minutes on the left and right breast"/>:<p className="density-empty">No timed breast feeds with a recorded side.</p>}{balance.unknown>0&&<p className="chart-help">Side not recorded: {durationLabel(balance.unknown)}. This time is outside the balance.</p>}{balance.untimed>0&&<p className="chart-help">End time not recorded: {balance.untimed} {balance.untimed===1?'feed':'feeds'}. Duration is unknown.</p>}{balance.running>0&&<p className="chart-help">Includes elapsed time from {balance.running} running {balance.running===1?'feed':'feeds'}.</p>}{timed>0&&<Help label="Daily breast times"><table className="breast-balance-table"><caption>Recorded breast time in minutes</caption><thead><tr><th scope="col">Date</th><th scope="col">Left</th><th scope="col">Right</th></tr></thead><tbody>{balance.days.map(day=><tr key={day.day}><th scope="row">{day.day}</th><td>{Math.round(day.left*100)/100}</td><td>{Math.round(day.right*100)/100}</td></tr>)}</tbody></table></Help>}<Help label="About breast balance"><p>Both assigns half the duration to each breast. Times split at midnight in Berlin.</p><p>Explicit feeding totals in notes exclude breaks. Daily splits use the same proportion of each interval.</p><p>Clear side notes populate older records. Unclear sides and unknown durations stay outside the balance.</p></Help></section>}

  <section aria-label="Time of day density"><div className="analytics-heading"><div><h2>When activities start</h2></div><label>Smoothing<select aria-label="Density smoothing" value={bandwidth} onChange={e=>setBandwidth(Number(e.target.value))}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option></select></label></div>{density.length?<Chart option={pattern} label="Smoothed activity start times across 24 hours"/>:<p className="density-empty">No starts match this activity in the selected dates.</p>}<Help label="About start patterns"><p>The Gaussian density curve joins starts across midnight. Each activity totals 100%.</p><p>Curves show recorded timing, not duration or expected care.</p></Help><p className="density-samples">{density.map(g=>`${names[g.track]}: ${g.count} ${g.count===1?'start':'starts'}`).join(' / ')||'No matching starts.'}</p>{density.some(g=>g.count<5)&&<p className="chart-help">Some activities have fewer than 5 starts.</p>}</section>
 </div>;
}
