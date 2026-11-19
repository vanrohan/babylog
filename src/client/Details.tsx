import React from 'react';

export function Help({label,children}:{label:string;children:React.ReactNode}){
 return <details className="inline-help"><summary>{label}</summary><div className="help-content">{children}</div></details>;
}
export function EntryNotes({notes}:{notes:string}){
 if(!notes.trim())return null;
 const lines=notes.split('\n');
 const imported=lines.some(line=>/^Import: [a-f0-9]{64}:/.test(line));
 const body=imported?lines.filter(line=>!/^Import: [a-f0-9]{64}:/.test(line)&&!line.startsWith('Source: BabyDiary.pdf,')).join('\n').trim():notes;
 const source=imported?lines.filter(line=>/^Import: [a-f0-9]{64}:/.test(line)||line.startsWith('Source: BabyDiary.pdf,')).join('\n'):'';
 if(body.length<=100&&!body.includes('\n')&&!source)return <p className="event-notes">{body}</p>;
 return <details className="record-notes"><summary>{body?'Notes':'Source'}{body&&<span>{body.slice(0,80)}{body.length>80?'...':''}</span>}</summary><div>{body&&<p>{body}</p>}{source&&(body?<Help label="Source details"><p>{source}</p></Help>:<p>{source}</p>)}</div></details>;
}
