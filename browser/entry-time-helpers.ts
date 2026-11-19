import {expect,type Page} from '@playwright/test';

type TimeField='start'|'end';
export async function showEndTime(page:Page){
 const running=page.getByLabel('Still in progress',{exact:true});
 if(await running.isVisible()&&await running.isChecked())await running.uncheck();
 const add=page.getByRole('button',{name:'Add end time',exact:true});if(await add.isVisible())await add.click();
}
export async function setWheel(page:Page,name:string,value:number,max:number){
 const wheel=page.getByRole('listbox',{name,exact:true});await wheel.focus();
 if(await wheel.getAttribute('aria-activedescendant')===name.replaceAll(' ','-')+'-'+value)return;
 const fromEnd=value>max/2;await wheel.press(fromEnd?'End':'Home');
 for(let i=0;i<(fromEnd?max-value:value);i++)await wheel.press(fromEnd?'ArrowUp':'ArrowDown');
}
export async function typeEntryTime(page:Page,field:TimeField,value:string){
 const name=field==='start'?'Start':'End';
 const change=page.getByRole('button',{name:'Change start time',exact:true});
 if(field==='start'&&await change.isVisible()&&await change.getAttribute('aria-expanded')==='false')await change.click();
 if(!value){
  if(field==='start')throw new Error('Start is required. Use the date and wheels.');
  const clear=page.getByRole('button',{name:'Clear end time',exact:true});if(await clear.isVisible())await clear.click();return;
 }
 if(field==='end')await showEndTime(page);
 const date=page.getByLabel(name+' date',{exact:true});
 if(!await date.count())await page.getByRole('button',{name:field==='end'?'Add end time':'Set start time',exact:true}).click();
 await date.fill(value.slice(0,10));
 await setWheel(page,name+' hour',Number(value.slice(11,13)),23);
 await setWheel(page,name+' minute',Number(value.slice(14,16)),59);
}
export async function readEntryTime(page:Page,field:TimeField){
 const name=field==='start'?'Start':'End',date=page.getByLabel(name+' date',{exact:true});
 const change=page.getByRole('button',{name:'Change start time',exact:true});
 if(field==='start'&&await change.isVisible()&&await change.getAttribute('aria-expanded')==='false')await change.click();
 if(!await date.count())return '';
 const clock=[];
 for(const unit of ['hour','minute']){
  const id=await page.getByRole('listbox',{name:name+' '+unit,exact:true}).getAttribute('aria-activedescendant');
  clock.push(id!.split('-').at(-1)!.padStart(2,'0'));
 }
 return await date.inputValue()+'T'+clock.join(':');
}
export async function expectEntryTime(page:Page,field:TimeField,value:string){
 await expect.poll(()=>readEntryTime(page,field)).toBe(value);
}
export async function expectEndTime(page:Page,value:string){await expectEntryTime(page,'end',value);}
