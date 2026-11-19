import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from './postgres.ts';
import { AppError, careSchema, careTaskInputSchema, careTaskKeySchema, versionSchema, daySchema, entrySchema, localDay, operationsSchema } from './schema.ts';
import { careKeys, careLabels, type CareKey } from '../shared.ts';
import type { Care, CareTask, Entry, EntryUndo, Operation, Proposal } from '../shared.ts';
import {postgresSchema} from './postgres-schema.ts';
import { interruptsSleep, sleepChanges } from './sleep.ts';
type SleepSource = {
    id: string;
    original: Entry;
    segments: Entry[];
    care: Entry[];
    limitEnd: string | null;
};
type SleepPlan = {
    ids: string[];
    changes: Operation[];
    autoIds: string[];
    context: string;
    targets: Entry[];
    sources: SleepSource[];
    notice: string;
};
type Row = Record<string, any>;
type UndoState = {
    entries: Entry[];
    sources: SleepSource[];
    deleted: {
        id: string;
        entry: string;
        deletedAt: string;
    }[];
};
type UndoArea = {
    start: string;
    end: string;
};
function changedRows<T extends {
    id: string;
}>(before: T[], after: T[]): [
    T[],
    T[]
] {
    const ids = new Set([...before, ...after].map(row => row.id));
    const changed = new Set([...ids].filter(id => JSON.stringify(before.find(row => row.id === id)) !== JSON.stringify(after.find(row => row.id === id))));
    return [before.filter(row => changed.has(row.id)), after.filter(row => changed.has(row.id))];
}
export class PostgresStore {
    constructor(readonly database: PostgresDatabase) { }
    async initialize() {
        await this.database.transaction(async () => {
            await this.database.query(postgresSchema);
            const initialized = await this.get('SELECT id FROM migrations WHERE id=?', 'postgres-v1');
            if (!initialized) {
                for (const key of careKeys)
                    await this.run('INSERT INTO care_tasks (key,label,active,version) VALUES (?,?,?,1) ON CONFLICT(key) DO NOTHING', key, careLabels[key], key === 'cord' ? 0 : 1);
                await this.run('INSERT INTO migrations VALUES (?)', 'postgres-v1');
            }
        });
    }
    async close() { await this.database.close(); }
    private async all(sql: string, ...values: unknown[]): Promise<Row[]> { return (await this.database.query(sql, values)).rows; }
    private async get(sql: string, ...values: unknown[]): Promise<Row | undefined> { return (await this.all(sql, ...values))[0]; }
    private async run(sql: string, ...values: unknown[]): Promise<{
        changes: number;
    }> { return { changes: (await this.database.query(sql, values)).rowCount ?? 0 }; }
    private entry(row: Row): Entry { return { ...row, pee: !!row.pee, poo: !!row.poo } as Entry; }
    async getEntry(id: string): Promise<Entry> {
        const row = (await this.get("SELECT * FROM entries WHERE id=$1", id));
        if (!row)
            throw new AppError('Entry not found.', 404);
        return this.entry(row);
    }
    async listEntries(day?: string, timeZone = 'Europe/Berlin'): Promise<Entry[]> {
        if (day)
            daySchema.parse(day);
        const rows = (await this.all("SELECT * FROM entries ORDER BY \"startAt\" DESC")).map(x => this.entry(x));
        if (!day)
            return rows;
        return rows.filter(x => {
            const first = localDay(new Date(x.startAt), timeZone);
            const last = localDay(new Date(x.endAt ?? (x.status === 'active' ? new Date().toISOString() : x.startAt)), timeZone);
            return first <= day && last >= day;
        });
    }
    async createEntry(input: unknown, adjust = true, id: string = randomUUID()): Promise<Entry> {
        return this.database.transaction(async () => {
            if (adjust)
                return (await this.entryWrite(async () => (await this.createEntry(input, false, id))));
            const e = entrySchema.parse(input), now = new Date().toISOString();
            (await this.run("INSERT INTO entries (id,activity,\"startAt\",\"endAt\",status,pee,poo,temperature,notes,version,\"createdAt\",\"updatedAt\",\"feedingType\",\"breastSide\") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)", id, e.activity, e.startAt, e.endAt, e.status, +e.pee, +e.poo, e.temperature, e.notes, 1, now, now, e.feedingType, e.breastSide));
            return (await this.getEntry(id));
        });
    }
    async saveEntry(key: string, input: unknown, id?: string): Promise<Entry> {
        const entry = entrySchema.parse(input);
        const version = id ? versionSchema.parse((input as {version?: unknown}).version) : undefined;
        const request = JSON.stringify({id, entry, version,
            feedingTypeRecorded: Object.hasOwn(input as object, 'feedingType'),
            breastSideRecorded: Object.hasOwn(input as object, 'breastSide')});
        return this.database.transaction(async () => {
            const saved = await this.get('SELECT request,response FROM entry_saves WHERE key=$1', key);
            if (saved) {
                if (saved.request !== request)
                    throw new AppError('This save already completed with different values. Check the diary and edit the saved entry.', 409);
                return JSON.parse(saved.response) as Entry;
            }
            const result = id ? await this.updateEntry(id, input, version!) : await this.createEntry(input);
            await this.run('INSERT INTO entry_saves (key,request,response) VALUES ($1,$2,$3)', key, request, JSON.stringify(result));
            return result;
        });
    }
    async updateEntry(id: string, input: unknown, version: number, adjust = true): Promise<Entry> {
        return this.database.transaction(async () => {
            if (adjust)
                return (await this.editWithUndo(id, async () => (await this.updateEntry(id, input, version, false))));
            const e = entrySchema.parse(input), old = (await this.getEntry(id));
            if (old.version !== version)
                throw new AppError('This entry changed on another device. Reload it before saving.', 409);
            if (input && typeof input === 'object' && !Object.hasOwn(input, 'feedingType') && e.activity === 'feeding' && e.feedingType === null && old.activity === 'feeding')
                e.feedingType = old.feedingType;
            if (input && typeof input === 'object' && !Object.hasOwn(input, 'breastSide') && e.feedingType === 'Breast' && old.feedingType === 'Breast')
                e.breastSide = old.breastSide ?? null;
            const changed = (await this.run("UPDATE entries SET activity=$1,\"feedingType\"=$2,\"breastSide\"=$3,\"startAt\"=$4,\"endAt\"=$5,status=$6,pee=$7,poo=$8,temperature=$9,notes=$10,version=version+1,\"updatedAt\"=$11 WHERE id=$12 AND version=$13", e.activity, e.feedingType, e.breastSide, e.startAt, e.endAt, e.status, +e.pee, +e.poo, e.temperature, e.notes, new Date().toISOString(), id, version));
            if (!changed.changes)
                throw new AppError('This entry changed on another device. Reload it before saving.', 409);
            return (await this.getEntry(id));
        });
    }
    private async applyOperations(operations: Operation[], ids: string[] = []) {
        for (const [index,op] of operations.entries()) {
            switch (op.type) {
                case 'create_entry':
                    (await this.createEntry(op.entry, false, ids[index]));
                    break;
                case 'update_entry':
                    (await this.updateEntry(op.id, op.entry, op.version, false));
                    break;
                case 'delete_entry':
                    (await this.deleteEntry(op.id, op.version));
                    break;
                case 'set_care':
                    (await this.setCare(op.day, op.key, op.done, op.version, op.taskVersion));
                    break;
            }
        }
    }
    private async sleepSources(): Promise<SleepSource[]> {
        return (await this.all("SELECT state FROM sleep_sources ORDER BY id")).map(row => JSON.parse(String(row.state)));
    }
    private async saveSleepSources(sources: SleepSource[]) {
        await this.database.query("DELETE FROM sleep_sources");
        for (const source of sources)
            (await this.run("INSERT INTO sleep_sources VALUES ($1,$2)", source.id, JSON.stringify(source)));
    }
    private careOverlaps(care: Entry, sleep: Entry) {
        return interruptsSleep(care) && care.startAt < (sleep.endAt ?? '~') && (care.endAt ? care.endAt > sleep.startAt : care.startAt >= sleep.startAt);
    }
    private async rebuildSleep(source: SleepSource, care: Entry[]) {
        const current = (await this.listEntries());
        const owned = new Set((await this.sleepSources()).flatMap(source => source.segments).filter(entry => current.some(record => record.id === entry.id && record.version === entry.version)).map(entry => entry.id));
        const independent = current.filter(entry => entry.activity === 'sleep' && (entry.endAt || entry.status === 'active') && !owned.has(entry.id) && !source.segments.some(segment => segment.id === entry.id));
        const next = independent.filter(entry => entry.startAt > source.original.startAt).map(entry => entry.startAt).sort()[0];
        if (next && next < (source.limitEnd ?? '~'))
            source.limitEnd = next;
        const original = { ...source.original, endAt: source.limitEnd, status: source.limitEnd ? 'completed' as const : source.original.status };
        care = care.filter(entry => this.careOverlaps(entry, original));
        const changes = sleepChanges([original], care);
        const proposed = changes.length ? changes.flatMap(op => op.type === 'create_entry' || op.type === 'update_entry' ? [op.entry] : []) : [original];
        const desired = proposed.filter(entry => entry.startAt === source.original.startAt || !independent.some(other => other.startAt <= entry.startAt && (other.endAt ?? '~') > entry.startAt));
        const segments: Entry[] = [], used = new Set<string>();
        for (const entry of desired) {
            const old = source.segments.find(old => old.startAt === entry.startAt && !used.has(old.id));
            if (old) {
                used.add(old.id);
                const fields = entrySchema.parse(entry);
                segments.push(JSON.stringify(entrySchema.parse(old)) === JSON.stringify(fields) ? old : (await this.updateEntry(old.id, fields, old.version, false)));
            }
            else
                segments.push((await this.createEntry(entry, false)));
        }
        for (const old of source.segments)
            if (!used.has(old.id))
                (await this.deleteEntry(old.id, old.version));
        return { source: { ...source, segments, care }, notice: desired.length < proposed.length ? 'Sleep restart skipped because another sleep covers that time.' : '' };
    }
    private async adjustSleep(touched: Entry[]): Promise<string> {
        let notice = '';
        const handledCare = new Set<string>();
        const care = (await this.listEntries()).filter(interruptsSleep), sources = (await this.sleepSources()), kept: SleepSource[] = [];
        for (const source of sources) {
            const affected = touched.some(entry => source.care.some(old => old.id === entry.id) || this.careOverlaps(entry, { ...source.original, endAt: source.limitEnd }));
            if (!affected) {
                kept.push(source);
                continue;
            }
            const versions = new Map((await this.all("SELECT id,version FROM entries")).map(row=>[row.id,row.version]));
            const changed=source.segments.some(entry=>versions.get(entry.id)!==entry.version);
            const moved = touched.some(entry => source.care.some(old => old.id === entry.id && (old.startAt !== entry.startAt || old.activity !== entry.activity)));
            if (changed || moved) {
                notice = changed ? 'Sleep restart skipped because the interrupted sleep changed.' : 'Sleep restart skipped because the care start or activity changed.';
                continue;
            }
            for (const entry of touched)
                if (source.care.some(old => old.id === entry.id))
                    handledCare.add(entry.id);
            const rebuilt = (await this.rebuildSleep(source, care.filter(entry => this.careOverlaps(entry, source.original)))), next = rebuilt.source;
            notice = rebuilt.notice || notice;
            kept.push(next);
            (await this.run("INSERT INTO sleep_sources VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET state=excluded.state", next.id, JSON.stringify(next)));
        }
        (await this.saveSleepSources(kept));
        const owned = new Set(kept.flatMap(source => source.segments.map(entry => entry.id))), all = (await this.listEntries());
        const pending = all.filter(entry => entry.activity === 'sleep' && !owned.has(entry.id)).map(sleep => ({ sleep, events: touched.filter(entry => !handledCare.has(entry.id) && this.careOverlaps(entry, sleep)) })).filter(({ sleep, events }) => events.length && sleepChanges([sleep], events).length);
        const created: SleepSource[] = pending.filter(({ events }) => events.some(entry => !entry.endAt)).map(({ sleep }) => ({ id: sleep.id, original: sleep, segments: [sleep], care: [], limitEnd: sleep.endAt }));
        kept.push(...created);
        (await this.saveSleepSources(kept));
        for (const { sleep, events } of pending) {
            const source = created.find(source => source.id === sleep.id);
            if (source) {
                const rebuilt = (await this.rebuildSleep(source, care.filter(entry => this.careOverlaps(entry, sleep))));
                notice = rebuilt.notice || notice;
                kept[kept.findIndex(source => source.id === sleep.id)] = rebuilt.source;
                (await this.saveSleepSources(kept));
            }
            else
                (await this.applyOperations(sleepChanges([sleep], events)));
        }
        return notice;
    }
    private async entryWrite(write: () => Promise<Entry>): Promise<Entry> {
        await this.database.query("SAVEPOINT care_entry");
        try {
            const entry = await write(), sleepNotice = (await this.adjustSleep([entry]));
            await this.database.query("RELEASE care_entry");
            return sleepNotice ? { ...entry, sleepNotice } : entry;
        }
        catch (error) {
            await this.database.query("ROLLBACK TO care_entry; RELEASE care_entry");
            throw error;
        }
    }
    private async undoState(): Promise<UndoState> {
        return { entries: (await this.listEntries()), sources: (await this.sleepSources()), deleted: (await this.all("SELECT * FROM deleted_entries ORDER BY id")).map(row => ({ id: String(row.id), entry: String(row.entry), deletedAt: String(row.deletedAt) })) };
    }
    private async editWithUndo(id: string, write: () => Promise<Entry>): Promise<Entry> {
        await this.database.query("SAVEPOINT entry_edit");
        try {
            const before = (await this.undoState()), entry = (await this.entryWrite(write)), after = (await this.undoState());
            // Limit Undo to changed rows so unrelated edits remain valid.
            [before.entries, after.entries] = changedRows(before.entries, after.entries);
            [before.sources, after.sources] = changedRows(before.sources, after.sources);
            [before.deleted, after.deleted] = changedRows(before.deleted, after.deleted);
            const related = [...before.entries, ...after.entries].some(entry => entry.activity === 'sleep' || interruptsSleep(entry));
            const areas = [...before.entries, ...after.entries, ...before.sources.map(source => source.original), ...after.sources.map(source => source.original)].map(entry => this.undoArea(entry));
            (await this.run("INSERT INTO entry_undo VALUES ($1,$2,$3,$4,$5,0) ON CONFLICT(\"entryId\") DO UPDATE SET id=excluded.id,\"beforeState\"=excluded.\"beforeState\",\"afterState\"=excluded.\"afterState\",context=excluded.context,used=excluded.used", id, randomUUID(), JSON.stringify(before), JSON.stringify(after), related ? JSON.stringify({ areas, state: (await this.undoContext(areas)) }) : null));
            await this.database.query("RELEASE entry_edit");
            return entry;
        }
        catch (error) {
            await this.database.query("ROLLBACK TO entry_edit; RELEASE entry_edit");
            throw error;
        }
    }
    private undoArea(entry: Entry): UndoArea {
        return { start: entry.startAt, end: entry.endAt ?? (entry.activity === 'sleep' && entry.status === 'active' ? '~' : entry.startAt) };
    }
    private async undoContext(areas: UndoArea[]) {
        const overlaps = (entry: Entry) => { const range = this.undoArea(entry); return areas.some(area => range.start <= area.end && range.end >= area.start); };
        return JSON.stringify({ entries: (await this.listEntries()).filter(entry => (entry.activity === 'sleep' || interruptsSleep(entry)) && overlaps(entry)).sort((a, b) => a.id.localeCompare(b.id)).map(entry => [entry.id, entry.version]), sources: (await this.sleepSources()).filter(source => overlaps(source.original)) });
    }
    async getEntryUndo(entryId: string): Promise<EntryUndo | null> {
        (await this.getEntry(entryId));
        const row = (await this.get("SELECT * FROM entry_undo WHERE \"entryId\"=$1 AND used=0", entryId));
        if (!row)
            return null;
        const before: UndoState = JSON.parse(String(row.beforeState)), after: UndoState = JSON.parse(String(row.afterState));
        const changes: Operation[] = before.entries.map(entry => {
            const current = after.entries.find(next => next.id === entry.id);
            return current ? { type: 'update_entry', id: entry.id, version: current.version, entry } : { type: 'create_entry', entry };
        });
        for (const entry of after.entries)
            if (!before.entries.some(old => old.id === entry.id))
                changes.push({ type: 'delete_entry', id: entry.id, version: entry.version });
        return { id: String(row.id), entryId, changes, targets: after.entries, sleepChanges: changes.filter(op => op.type === 'create_entry' ? op.entry.activity === 'sleep' : 'id' in op && op.id !== entryId).length };
    }
    async undoEntry(entryId: string, undoId: string): Promise<Entry> {
        return this.database.transaction(async () => {
            await this.database.query("SAVEPOINT undo_entry");
            try {
                const row = (await this.get("SELECT * FROM entry_undo WHERE \"entryId\"=$1 AND id=$2 AND used=0", entryId, undoId));
                if (!row)
                    throw new AppError('This undo is no longer available. Reload the entry.', 409);
                const before: UndoState = JSON.parse(String(row.beforeState)), after: UndoState = JSON.parse(String(row.afterState)), current = (await this.undoState());
                const conflict = () => new AppError('The entry or related sleep changed. Reload it before undoing.', 409);
                for (const key of ['entries', 'sources', 'deleted'] as const) {
                    for (const id of new Set([...before[key], ...after[key]].map(row => row.id))) {
                        if (JSON.stringify(current[key].find(row => row.id === id)) !== JSON.stringify(after[key].find(row => row.id === id)))
                            throw conflict();
                    }
                }
                if (row.context !== null) {
                    const context = JSON.parse(String(row.context));
                    if (context.state !== (await this.undoContext(context.areas)))
                        throw conflict();
                }
                const restored = new Map<string, Entry>();
                for (const entry of before.entries) {
                    entrySchema.parse(entry);
                    const archived = after.deleted.find(row => row.id === entry.id);
                    const next = { ...entry, version: Math.max(entry.version, after.entries.find(next => next.id === entry.id)?.version ?? 0, archived ? JSON.parse(String(archived.entry)).version : 0) + 1, updatedAt: new Date().toISOString() };
                    (await this.run("INSERT INTO entries (id,activity,\"startAt\",\"endAt\",status,pee,poo,temperature,notes,version,\"createdAt\",\"updatedAt\",\"feedingType\",\"breastSide\") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET activity=excluded.activity,\"startAt\"=excluded.\"startAt\",\"endAt\"=excluded.\"endAt\",status=excluded.status,pee=excluded.pee,poo=excluded.poo,temperature=excluded.temperature,notes=excluded.notes,version=excluded.version,\"createdAt\"=excluded.\"createdAt\",\"updatedAt\"=excluded.\"updatedAt\",\"feedingType\"=excluded.\"feedingType\",\"breastSide\"=excluded.\"breastSide\"", next.id, next.activity, next.startAt, next.endAt, next.status, +next.pee, +next.poo, next.temperature, next.notes, next.version, next.createdAt, next.updatedAt, next.feedingType, next.breastSide ?? null));
                    restored.set(entry.id, next);
                }
                for (const entry of after.entries)
                    if (!restored.has(entry.id))
                        (await this.run("DELETE FROM entries WHERE id=$1", entry.id));
                for (const source of [...before.sources, ...after.sources])
                    (await this.run("DELETE FROM sleep_sources WHERE id=$1", source.id));
                // Keep links stale when a manual sleep edit already disabled automatic restoration.
                const restoreLink = (entry: Entry) => before.entries.some(old => old.id === entry.id && old.version === entry.version) ? restored.get(entry.id) ?? entry : entry;
                const sources = [...(await this.sleepSources()), ...before.sources].map(source => ({ ...source, segments: source.segments.map(restoreLink), care: source.care.map(restoreLink) }));
                (await this.saveSleepSources(sources));
                for (const entry of [...before.deleted, ...after.deleted])
                    (await this.run("DELETE FROM deleted_entries WHERE id=$1", entry.id));
                for (const entry of before.deleted)
                    (await this.run("INSERT INTO deleted_entries VALUES ($1,$2,$3)", entry.id, entry.entry, entry.deletedAt));
                (await this.run("UPDATE entry_undo SET used=1 WHERE \"entryId\"=$1", entryId));
                const entry = (await this.getEntry(entryId));
                await this.database.query("RELEASE undo_entry");
                return entry;
            }
            catch (error) {
                await this.database.query("ROLLBACK TO undo_entry; RELEASE undo_entry");
                throw error;
            }
        });
    }
    private async sleepContext() {
        return JSON.stringify({ entries: (await this.listEntries()).filter(entry => entry.activity === 'sleep' || interruptsSleep(entry)).sort((a, b) => a.id.localeCompare(b.id)).map(entry => [entry.id, entry.version]), sources: (await this.sleepSources()) });
    }
    private async planSleep(operations: Operation[]): Promise<SleepPlan | null> {
        const sources=await this.sleepSources();
        if (!operations.some(op => (op.type === 'create_entry' || op.type === 'update_entry') && (interruptsSleep(op.entry) || op.type === 'update_entry' && sources.some(source => source.care.some(entry => entry.id === op.id)))))
            return null;
        const context = (await this.sleepContext()), ids = operations.map(() => randomUUID());
        await this.database.query("SAVEPOINT preview_sleep");
        try {
            (await this.applyOperations(operations, ids));
            const care:Entry[]=[];
            for(const [index,op] of operations.entries()){
                if(op.type==='create_entry')care.push(await this.getEntry(ids[index]));
                if(op.type==='update_entry')care.push(await this.getEntry(op.id));
            }
            const before = (await this.listEntries()).filter(entry => entry.activity === 'sleep');
            const notice = (await this.adjustSleep(care)), after = (await this.listEntries()).filter(entry => entry.activity === 'sleep');
            const changes: Operation[] = [], autoIds: string[] = [];
            for (const entry of before) {
                const next = after.find(candidate => candidate.id === entry.id);
                if (!next)
                    changes.push({ type: 'delete_entry', id: entry.id, version: entry.version });
                else if (next.version !== entry.version)
                    changes.push({ type: 'update_entry', id: entry.id, version: entry.version, entry: next });
            }
            for (const entry of after)
                if (!before.some(candidate => candidate.id === entry.id)) {
                    autoIds[changes.length] = entry.id;
                    changes.push({ type: 'create_entry', entry });
                }
            return { ids, context, changes, autoIds, notice, sources: (await this.sleepSources()), targets: before.filter(entry => changes.some(op => 'id' in op && op.id === entry.id)) };
        }
        finally {
            await this.database.query("ROLLBACK TO preview_sleep; RELEASE preview_sleep");
        }
    }
    async deleteEntry(id: string, version: number) {
        return this.database.transaction(async () => {
            await this.database.query("SAVEPOINT delete_entry");
            try {
                const old = (await this.getEntry(id));
                if (old.version !== version)
                    throw new AppError('This entry changed on another device. Reload it before deleting.', 409);
                const deleted = (await this.get("DELETE FROM entries WHERE id=$1 AND version=$2 RETURNING *", id, version));
                if (!deleted)
                    throw new AppError('This entry changed on another device. Reload it before deleting.', 409);
                (await this.run("INSERT INTO deleted_entries VALUES ($1,$2,$3)", id, JSON.stringify(this.entry(deleted)), new Date().toISOString()));
                (await this.saveSleepSources((await this.sleepSources()).filter(source => !source.care.some(entry => entry.id === id))));
                await this.database.query("RELEASE delete_entry");
            }
            catch (error) {
                await this.database.query("ROLLBACK TO delete_entry; RELEASE delete_entry");
                throw error;
            }
        });
    }
    async listCareTasks(): Promise<CareTask[]> {
        return (await this.all("SELECT key,label,active,version FROM care_tasks ORDER BY \"position\"")).map(row => ({ ...row, active: !!row.active }) as CareTask);
    }
    async getCareTask(key: string): Promise<CareTask> {
        careTaskKeySchema.parse(key);
        const task = (await this.listCareTasks()).find(task => task.key === key);
        if (!task)
            throw new AppError('Daily task not found.', 404);
        return task;
    }
    private async activeCareTask(key: string, version?: number): Promise<CareTask> {
        const task = (await this.getCareTask(key));
        if (!task.active)
            throw new AppError('This daily task was removed. Reload the daily tasks.', 409);
        if (version !== undefined && task.version !== version)
            throw new AppError('This daily task changed. Reload the daily tasks.', 409);
        return task;
    }
    private async validateTaskName(label: string, except?: string) {
        if ((await this.listCareTasks()).some(task => task.active && task.key !== except && task.label.toLowerCase() === label.toLowerCase()))
            throw new AppError('A daily task already uses this name.');
    }
    async createCareTask(input: unknown): Promise<CareTask> {
        return this.database.transaction(async () => {
            const { label } = careTaskInputSchema.parse(input);
            await this.database.query("SAVEPOINT create_care_task");
            try {
                (await this.validateTaskName(label));
                if ((await this.listCareTasks()).filter(task => task.active).length >= 30)
                    throw new AppError('Use at most 30 daily tasks. Remove a task before adding another.');
                const key = 'task_' + randomUUID();
                (await this.run("INSERT INTO care_tasks (key,label,active,version) VALUES ($1,$2,1,1)", key, label));
                await this.database.query("RELEASE create_care_task");
                return (await this.getCareTask(key));
            }
            catch (error) {
                await this.database.query("ROLLBACK TO create_care_task; RELEASE create_care_task");
                throw error;
            }
        });
    }
    async updateCareTask(key: string, input: unknown, version: number): Promise<CareTask> {
        return this.database.transaction(async () => {
            const { label } = careTaskInputSchema.parse(input);
            versionSchema.parse(version);
            await this.database.query("SAVEPOINT update_care_task");
            try {
                (await this.activeCareTask(key, version));
                (await this.validateTaskName(label, key));
                const changed = (await this.run("UPDATE care_tasks SET label=$1,version=version+1 WHERE key=$2 AND version=$3 AND active=1", label, key, version));
                if (!changed.changes)
                    throw new AppError('This daily task changed. Reload the daily tasks.', 409);
                await this.database.query("RELEASE update_care_task");
                return (await this.getCareTask(key));
            }
            catch (error) {
                await this.database.query("ROLLBACK TO update_care_task; RELEASE update_care_task");
                throw error;
            }
        });
    }
    async removeCareTask(key: string, version: number): Promise<CareTask> {
        return this.database.transaction(async () => {
            versionSchema.parse(version);
            (await this.activeCareTask(key, version));
            const changed = (await this.run("UPDATE care_tasks SET active=0,version=version+1 WHERE key=$1 AND version=$2 AND active=1", key, version));
            if (!changed.changes)
                throw new AppError('This daily task changed. Reload the daily tasks.', 409);
            return (await this.getCareTask(key));
        });
    }
    async getCare(day: string): Promise<Care> {
        daySchema.parse(day);
        const out = Object.fromEntries((await this.listCareTasks()).map(task => [task.key, { done: false, version: 0 }])) as Care;
        for (const r of (await this.all("SELECT * FROM care WHERE day=$1", day)))
            out[r.key as keyof Care] = { done: !!r.done, version: Number(r.version) };
        return out;
    }
    async setCare(day: string, key: CareKey, done: boolean, version: number, taskVersion?: number) {
        return this.database.transaction(async () => {
            careSchema.parse({ day, key, done, version, taskVersion });
            await this.database.query("SAVEPOINT set_care");
            try {
                (await this.activeCareTask(key, taskVersion));
                const old = (await this.getCare(day))[key];
                if (old.version !== version)
                    throw new AppError('This daily check changed on another device. Reload before saving.', 409);
                const changed = (await this.run("INSERT INTO care VALUES ($1,$2,$3,$4) ON CONFLICT(day,key) DO UPDATE SET done=excluded.done,version=excluded.version WHERE care.version=$5", day, key, +done, version + 1, version));
                if (!changed.changes)
                    throw new AppError('This daily check changed on another device. Reload before saving.', 409);
                const result = (await this.getCare(day))[key];
                await this.database.query("RELEASE set_care");
                return result;
            }
            catch (error) {
                await this.database.query("ROLLBACK TO set_care; RELEASE set_care");
                throw error;
            }
        });
    }
    async propose(input: unknown, summary: string, now = new Date()): Promise<Proposal> {
        return this.database.transaction(async () => {
            const operations: Operation[] = operationsSchema.parse(input);
            const targets = new Set<string>();
            const snapshots: Entry[] = [];
            for (const op of operations) {
                let target: string | undefined;
                if (op.type === 'update_entry' || op.type === 'delete_entry') {
                    const current = (await this.getEntry(op.id));
                    if (current.version !== op.version)
                        throw new AppError('The proposed entry changed. Ask again.', 409);
                    target = op.id;
                    snapshots.push(current);
                }
                if (op.type === 'set_care') {
                    const task = (await this.activeCareTask(op.key, op.taskVersion));
                    op.taskLabel = task.label;
                    op.taskVersion = task.version;
                    if ((await this.getCare(op.day))[op.key].version !== op.version)
                        throw new AppError('The daily check changed. Ask again.', 409);
                    target = `${op.day}:${op.key}`;
                }
                if (target && targets.has(target))
                    throw new AppError('Propose one change for each record.');
                if (target)
                    targets.add(target);
            }
            const sleepPlan = (await this.planSleep(operations));
            const id = randomUUID(), createdAt = now.toISOString(), expiresAt = new Date(+now + 10 * 60000).toISOString();
            (await this.run("INSERT INTO proposals (id,summary,operations,status,\"createdAt\",\"expiresAt\",targets,\"sleepPlan\") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", id, summary.slice(0, 1000), JSON.stringify(operations), 'pending', createdAt, expiresAt, JSON.stringify(snapshots), sleepPlan ? JSON.stringify(sleepPlan) : null));
            return (await this.getProposal(id));
        });
    }
    async getProposal(id: string): Promise<Proposal> {
        const row = (await this.get("SELECT * FROM proposals WHERE id=$1", id)) as Row | undefined;
        if (!row)
            throw new AppError('Proposal not found.', 404);
        const { sleepPlan, ...proposal } = row, plan: SleepPlan | null = sleepPlan ? JSON.parse(sleepPlan) : null;
        return { ...proposal, operations: JSON.parse(row.operations), targets: JSON.parse(row.targets), sleepChanges: plan?.changes ?? [], sleepTargets: plan?.targets ?? [], sleepNotice: plan?.notice ?? '' } as Proposal;
    }
    async confirm(id: string) {
        return this.database.transaction(async () => {
            await this.database.query("SAVEPOINT confirm_proposal");
            try {
                const p = (await this.getProposal(id));
                if (p.status !== 'pending')
                    throw new AppError(p.status === 'cancelled' ? 'This proposal was cancelled.' : 'This proposal was already confirmed.', 409);
                if (p.expiresAt < new Date().toISOString())
                    throw new AppError('This proposal expired. Ask again.', 409);
                for (const op of p.operations) {
                    if ((op.type === 'create_entry' || op.type === 'update_entry') && entrySchema.parse(op.entry).status !== op.entry.status) {
                        throw new AppError('This proposal uses an older timer rule. Cancel it and submit the instruction again.', 409);
                    }
                }
                const stored = (await this.get("SELECT \"sleepPlan\" FROM proposals WHERE id=$1", id))!.sleepPlan;
                const plan: SleepPlan | null = stored ? JSON.parse(String(stored)) : null;
                if (plan && plan.context !== (await this.sleepContext()))
                    throw new AppError('Sleep or care records changed. Submit the instruction again.', 409);
                if (!plan && (await this.planSleep(p.operations)))
                    throw new AppError('This proposal needs a sleep review. Submit the instruction again.', 409);
                (await this.applyOperations(p.operations, plan?.ids));
                if (plan) {
                    (await this.applyOperations(plan.changes, plan.autoIds));
                    const sources:SleepSource[]=[];
                    for(const source of plan.sources){
                        const segments:Entry[]=[];
                        for(const entry of source.segments)segments.push(await this.getEntry(entry.id));
                        sources.push({...source,segments});
                    }
                    await this.saveSleepSources(sources);
                }
                (await this.run("UPDATE proposals SET status='confirmed' WHERE id=$1", id));
                await this.database.query("RELEASE confirm_proposal");
                return (await this.getProposal(id));
            }
            catch (error) {
                await this.database.query("ROLLBACK TO confirm_proposal; RELEASE confirm_proposal");
                throw error;
            }
        });
    }
    async reject(id: string) {
        return this.database.transaction(async () => {
            const p = (await this.getProposal(id));
            if (p.status !== 'pending')
                throw new AppError('This proposal is no longer pending.', 409);
            (await this.run("UPDATE proposals SET status='cancelled' WHERE id=$1", id));
        });
    }
    async exportData() { return this.database.transaction(async()=>({ exportedAt: new Date().toISOString(), sleepSources: (await this.sleepSources()), entries: (await this.listEntries()), care: (await this.all("SELECT * FROM care ORDER BY day")), careTasks: (await this.listCareTasks()), deletedEntries: (await this.all("SELECT * FROM deleted_entries ORDER BY \"deletedAt\"")).map(r => ({ entry: JSON.parse(String(r.entry)), deletedAt: r.deletedAt })) })); }
}
