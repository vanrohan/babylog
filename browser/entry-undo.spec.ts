import {test,expect,saveEntry} from './test.ts';
import {typeEntryTime} from './entry-time-helpers.ts';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 for(const entry of await (await request.get('/api/entries')).json())await request.delete('/api/entries/'+entry.id,{data:{version:entry.version}});
 await page.clock.setFixedTime(new Date('2026-11-15T14:00:00Z'));
 await request.post('/api/entries',{data:{activity:'sleep',startAt:'2026-11-15T11:00:17.123Z',endAt:'2026-11-15T12:00:18.123Z',notes:'Original note.'}});
 await page.goto('/');await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-15');
 await page.getByRole('button',{name:'Edit Sleep at 12:00',exact:true}).click();
});

test('editing protects Start and keeps End open while drafts survive failure and hiding',async({page},info)=>{
 const start=page.getByRole('region',{name:'Start time',exact:true}),end=page.getByRole('region',{name:'End time',exact:true});
 await expect(start.getByRole('listbox')).toHaveCount(0);await expect(start).toContainText('2026-11-15 at 12:00');
 await expect(end.getByRole('listbox',{name:'End hour',exact:true})).toBeVisible();
 await typeEntryTime(page,'start','2026-11-15T12:10');await page.getByRole('button',{name:'Change start time',exact:true}).click();
 await page.getByLabel('Notes').fill('Keep draft.');
 await page.route('**/api/entry-saves/*',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('alert')).toContainText('save is unconfirmed');
 await page.getByRole('button',{name:'Hide entry form',exact:true}).click();await page.getByRole('button',{name:'Show entry form',exact:true}).click();
 await expect(start).toContainText('12:10');await expect(page.getByLabel('Notes')).toHaveValue('Keep draft.');
 await page.screenshot({path:info.outputPath('edit-time-groups.png'),fullPage:true});
 await page.getByRole('button',{name:'Cancel edit',exact:true}).click();await page.getByRole('button',{name:'Add an entry',exact:true}).click();
 await expect(start.getByRole('listbox',{name:'Start hour',exact:true})).toBeVisible();await expect(page.getByLabel('Still in progress')).toBeChecked();await expect(end).toBeHidden();
});

test('undo previews all fields after reload and failed restore keeps the draft',async({page,request})=>{
 await typeEntryTime(page,'start','2026-11-15T12:10');await page.getByLabel('Notes').fill('Wrong note.');await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('button',{name:'Undo last edit',exact:true}).click();await expect(page.locator('.entry-undo')).toContainText('Original note.');
 await page.reload();await page.getByRole('textbox',{name:'Diary date',exact:true}).fill('2026-11-15');await page.getByRole('button',{name:'Edit Sleep at 12:10',exact:true}).click();
 await page.locator('.entry-undo summary').click();await expect(page.locator('.entry-undo')).toContainText('discards unsaved changes');
 await page.getByLabel('Notes').fill('Unsaved draft.');
 await page.route('**/api/entries/*/undo',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Try again.'}}):route.continue());
 await page.getByRole('button',{name:'Restore previous entry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Try again.');await expect(page.getByLabel('Notes')).toHaveValue('Unsaved draft.');
 await page.unroute('**/api/entries/*/undo');await page.getByRole('button',{name:'Restore previous entry',exact:true}).click();
 await expect(page.locator('#entry-toggle')).toHaveAttribute('aria-expanded','false');
 const [restored]=await (await request.get('/api/entries')).json();expect(restored.startAt).toBe('2026-11-15T11:00:17.123Z');expect(restored.endAt).toBe('2026-11-15T12:00:18.123Z');expect(restored.notes).toBe('Original note.');
});


test('an End-only edit keeps the collapsed Start exact and keyboard access opens Start',async({page,request})=>{
 await typeEntryTime(page,'end','2026-11-15T13:15');
 await saveEntry(page,'Save changes');
 const [entry]=await (await request.get('/api/entries')).json();expect(entry.startAt).toBe('2026-11-15T11:00:17.123Z');
 await page.getByRole('button',{name:'Edit Sleep at 12:00',exact:true}).click();
 const change=page.getByRole('button',{name:'Change start time',exact:true});await change.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('listbox',{name:'Start hour',exact:true})).toBeVisible();
});
