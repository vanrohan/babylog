import React from 'react';

export function Icon({name,size=22}:{name:string;size?:number}){
 const paths:Record<string,React.ReactNode>={
  spinner:<path d="M21 12a9 9 0 1 1-9-9"/>,
  diary:<><path d="M5 4h13a2 2 0 0 1 2 2v14H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 4v16M10 9h6M10 13h5"/></>,
  sleep:<path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>,
  feed:<><path d="M9 3h6v5l4 7a4 4 0 0 1-4 6H9a4 4 0 0 1-4-6l4-7V3Z"/><path d="M8 10h8M9 15h2M9 18h2"/></>,
  nappy:<><path d="M3 5h18l-2 11-7 5-7-5L3 5Z"/><path d="m4 11 5 1 3 9 3-9 5-1M3 5l6 3h6l6-3"/></>,
  bath:<><path d="M3 12h18l-2 7H5l-2-7ZM6 19v2M18 19v2M5 12V5a2 2 0 0 1 4 0"/><path d="M8 6h3M12 9v1M15 9v1"/></>,
  send:<><path d="M12 19V5m-6 6 6-6 6 6"/></>,
  undo:<><path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/></>,
  start:<path d="m7 4 13 8-13 8V4Z"/>,
  stop:<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>,
  mic:<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
  settings:<><path d="M10 3 9.4 5.2 7.5 6.3 5.3 5.7 3.3 9.2 4.9 10.8v2.2l-1.6 1.6 2 3.5 2.2-.6 1.9 1.1.6 2.2h4l.6-2.2 1.9-1.1 2.2.6 2-3.5-1.6-1.6v-2.2l1.6-1.6-2-3.5-2.2.6-1.9-1.1L14 3Z"/><circle cx="12" cy="12" r="3"/></>,
  info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></>,
  trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  offline:<><path d="m3 3 18 18M4 9a13 13 0 0 1 3-2M10 6a13 13 0 0 1 10 3M7 13a8 8 0 0 1 4-2M16 12l1 1M10 17l2-1 2 1M12 20h.01"/></>,
  plus:<path d="M12 5v14M5 12h14"/>,
  close:<path d="m6 6 12 12M18 6 6 18"/>,
  arrow:<path d="m9 5 7 7-7 7"/>,
  chevron:<path d="m6 9 6 6 6-6"/>,
  check:<path d="m5 12 4 4L19 6"/>,
  edit:<><path d="m14 5 5 5M4 20l1-6L16 3a2 2 0 0 1 3 3L8 17l-4 3Z"/></>,
  sound:<><path d="m4 9 5 0 5-4v14l-5-4H4V9ZM18 8a7 7 0 0 1 0 8M21 5a11 11 0 0 1 0 14"/></>,
  download:<><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/></>,
  chat:<><path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8Z"/><path d="M7 9h9M7 13h6"/></>,
  note:<><path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/></>
  ,patterns:<><path d="M4 4v16h16M7 8h8M10 12h9M6 16h6"/></>
 };
 return <svg className={name==='spinner'?'button-spinner':undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{Object.hasOwn(paths,name)?paths[name]:paths.note}</svg>;
}
