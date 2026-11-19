import React,{forwardRef,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {WheelPicker,WheelPickerWrapper} from '@ncdai/react-wheel-picker';
import '@ncdai/react-wheel-picker/style.css';

export interface WheelHandle{value:()=>number;read:()=>number}
const row=44,visibleCount=12,angle=360/visibleCount,radius=row/Math.tan(angle*Math.PI/180);
export const Wheel=forwardRef<WheelHandle,{label:string;value:number;max:number;visible:boolean;disabled:boolean;cyclic?:boolean;onChange:(value:number)=>void}>(function Wheel({label,value,max,visible,disabled,cyclic=false,onChange},ref){
 const element=useRef<HTMLDivElement>(null);
 const latest=useRef({value,onChange});latest.current={value,onChange};
 const [generation,setGeneration]=useState(0);
 const options=useMemo(()=>Array.from({length:max+1},(_,value)=>({value,label:String(value).padStart(2,'0')})),[max]);
 const token=useMemo(()=>({}),[visible,disabled,generation]);
 const live=useRef(token);live.current=token;
 const normalize=(next:number)=>cyclic?((next%(max+1))+max+1)%(max+1):Math.max(0,Math.min(max,next));
 function current(){
  const transform=element.current?.querySelector<HTMLElement>('[data-rwp-highlight-list]')?.style.transform;
  const offset=transform?.match(/translateY\(([-\d.]+)px\)/);
  return offset?normalize(Math.round(-Number(offset[1])/row)):value;
 }
 function select(next:number){
  next=normalize(next);
  // Replace the moving wheel before Save reads its final selection.
  live.current={};
  flushSync(()=>{setGeneration(generation=>generation+1);if(next!==value)onChange(next);});
 }
 useImperativeHandle(ref,()=>({read:current,value:()=>{const next=current();select(next);return next;}}));
 useLayoutEffect(()=>{
  const list=element.current?.querySelector<HTMLElement>('[data-rwp-options]');
  if(!list)return;
  // Compose row rotations to avoid WebKit text errors from nested rotations.
  const compose=()=>{
   const rotation=list.style.transform.match(/rotateX\(([-\d.]+)deg\)/);
   if(!rotation)return;
   for(const item of list.querySelectorAll<HTMLElement>('[data-rwp-option]')){
    if(item.style.visibility==='hidden')continue;
    item.style.transform=`rotateX(${Number(rotation[1])-Number(item.dataset.index)*angle}deg) translateZ(${radius}px)`;
   }
  };
  const observer=new MutationObserver(compose);
  observer.observe(list,{attributes:true,attributeFilter:['style']});compose();
  return ()=>observer.disconnect();
 },[token]);
 useLayoutEffect(()=>{
  const picker=element.current?.querySelector<HTMLElement>('[data-rwp]');
  if(picker){picker.tabIndex=-1;picker.setAttribute('aria-hidden','true');}
 },[token]);
 const id=label.replaceAll(' ','-');
 return <div className="time-wheel" style={{'--wheel-depth':`${-radius}px`} as React.CSSProperties} ref={element} role="listbox" aria-label={label} aria-disabled={disabled} aria-activedescendant={id+'-'+value} tabIndex={disabled?-1:0}
  onKeyDown={event=>{
   const next=event.key==='ArrowDown'?value+1:event.key==='ArrowUp'?value-1:event.key==='Home'?0:event.key==='End'?max:event.key==='PageDown'?value+5:event.key==='PageUp'?value-5:null;
   if(next!==null){event.preventDefault();event.stopPropagation();if(!disabled)select(next);}
  }}>
  <div className="wheel-visual" aria-hidden="true" inert={disabled}>
   <WheelPickerWrapper><WheelPicker key={generation+'-'+visible+'-'+disabled} options={options} value={value} infinite={cyclic} visibleCount={visibleCount} optionItemHeight={row} dragSensitivity={8} onValueChange={next=>{if(live.current===token&&!disabled&&next!==latest.current.value){latest.current.onChange(next);}}}/></WheelPickerWrapper>
  </div>
  <div className="sr-only">{options.map(option=><div role="option" id={id+'-'+option.value} key={option.value} aria-selected={option.value===value}>{option.label}</div>)}</div>
 </div>;
});
