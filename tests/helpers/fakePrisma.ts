// テスト専用の簡易インメモリDB（Prismaクライアントの代用）。実DB・Prismaエンジンなしで、
// 月の状態管理・権限・メール配信のAPIを通しで検証するために使う。本番コードでは使われない。
// 使い方: globalThis.prisma に差し込んでから、src/lib/prisma を import するモジュールを読み込む。

type Row = Record<string, any>;
let seq = 0;
const cuid = () => `id_${++seq}`;

function isDate(v: unknown): v is Date {
  return v instanceof Date;
}
function eq(a: unknown, b: unknown) {
  if (isDate(a) && isDate(b)) return a.getTime() === b.getTime();
  return a === b;
}
function cmp(a: any, b: any) {
  return (isDate(a) ? a.getTime() : a) - (isDate(b) ? b.getTime() : b);
}

export function createFakePrisma() {
  // 未知のテーブルは空のテーブルとして扱う（E2E確認で、本テストの対象外のAPIが落ちないようにするため）
  const tables = new Proxy({} as Record<string, Row[]>, {
    get(target, prop: string) {
      if (typeof prop !== "string") return undefined;
      return (target[prop] ??= []);
    },
  });
  for (const t of ["employee", "user", "shiftType", "monthRoster", "monthRosterConfirmation", "rosterAuditLog", "dailyAssignment"]) void tables[t];
  // リレーション: テーブル.名前 -> [参照先テーブル, 自分側のFK]
  const relations: Record<string, Record<string, [string, string]>> = {
    monthRoster: { employee: ["employee", "employeeId"], shiftType: ["shiftType", "shiftTypeId"] },
    user: { employee: ["employee", "employeeId"] },
    shiftClaimRequest: { employee: ["employee", "employeeId"], shiftType: ["shiftType", "shiftTypeId"] },
  };

  // 1対多: テーブル.名前 -> [子テーブル, 子側のFK]
  const manyRelations: Record<string, Record<string, [string, string]>> = {
    shiftType: { timeBands: ["shiftTimeBand", "shiftTypeId"] },
  };

  function match(table: string, row: Row, where?: Row): boolean {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (k === "AND") { if (!(cond as Row[]).every((c) => match(table, row, c))) return false; continue; }
      if (k === "OR") { if (!(cond as Row[]).some((c) => match(table, row, c))) return false; continue; }
      const rel = relations[table]?.[k];
      if (rel) {
        const target = tables[rel[0]].find((r) => r.id === row[rel[1]]);
        if (!target || !match(rel[0], target, cond as Row)) return false;
        continue;
      }
      // 複合ユニークキー（例: employeeId_workDate）
      if (k.includes("_") && cond && typeof cond === "object" && !isDate(cond) && !("not" in (cond as Row)) && !("in" in (cond as Row))) {
        if (!Object.entries(cond as Row).every(([ck, cv]) => eq(row[ck], cv))) return false;
        continue;
      }
      const v = row[k];
      if (cond && typeof cond === "object" && !isDate(cond)) {
        const c = cond as Row;
        if ("not" in c && (c.not === null ? v === null || v === undefined : eq(v, c.not))) return false;
        if ("in" in c && !(c.in as unknown[]).some((x) => eq(x, v))) return false;
        if ("gte" in c && !(cmp(v, c.gte) >= 0)) return false;
        if ("gt" in c && !(cmp(v, c.gt) > 0)) return false;
        if ("lte" in c && !(cmp(v, c.lte) <= 0)) return false;
        if ("lt" in c && !(cmp(v, c.lt) < 0)) return false;
      } else if (!eq(v, cond === undefined ? v : cond)) return false;
    }
    return true;
  }

  function withInclude(table: string, row: Row, include?: Row, select?: Row) {
    let out: Row = { ...row };
    if (include) {
      for (const k of Object.keys(include)) {
        const rel = relations[table]?.[k];
        if (rel) out[k] = tables[rel[0]].find((r) => r.id === row[rel[1]]) ?? null;
        const many = manyRelations[table]?.[k];
        if (many) out[k] = tables[many[0]].filter((r) => r[many[1]] === row.id);
      }
    }
    if (select) {
      const picked: Row = {};
      for (const k of Object.keys(select)) {
        if (!select[k]) continue;
        const rel = relations[table]?.[k];
        if (rel && typeof select[k] === "object") {
          const target = tables[rel[0]].find((r) => r.id === row[rel[1]]);
          picked[k] = target ? withInclude(rel[0], target, undefined, (select[k] as Row).select) : null;
        } else picked[k] = out[k];
      }
      out = picked;
    }
    return out;
  }

  const defaults: Record<string, () => Row> = {
    employee: () => ({ isActive: true, role: "STAFF", contactEmail: null, note: null, baseStartTime: null, baseEndTime: null, priorityOrder: 0 }),
    monthRoster: () => ({ status: "WORK", shiftTypeId: null, overrideStartTime: null, overrideEndTime: null, createdBy: null, updatedBy: null }),
    monthRosterConfirmation: () => ({
      status: "CONFIRMED", confirmedAt: null, confirmedBy: null, revisedAfterConfirm: false, revisedAt: null, revisedBy: null,
      revision: 0, lastDeliveryAt: null, lastDeliveryRevision: null, lastDeliveryResult: null,
    }),
  };

  function applyData(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (v && typeof v === "object" && !isDate(v) && "increment" in (v as Row)) row[k] = (row[k] ?? 0) + (v as Row).increment;
      else row[k] = v;
    }
  }

  function delegate(table: string) {
    const find = (where?: Row) => tables[table].filter((r) => match(table, r, where));
    const uniqueWhere = (where: Row) => tables[table].find((r) => match(table, r, where)) ?? null;
    const d: Record<string, (args?: any) => Promise<any>> = {
      async findMany(args = {}) {
        let rows = find(args.where);
        if (args.orderBy) {
          const [[k, dir]] = Object.entries(args.orderBy as Row) as [string, string][];
          rows = [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir === "desc" ? -1 : 1));
        }
        return rows.map((r) => withInclude(table, r, args.include, args.select));
      },
      async findFirst(args = {}) {
        const r = find(args.where)[0];
        return r ? withInclude(table, r, args.include, args.select) : null;
      },
      async findUnique(args) {
        const r = uniqueWhere(args.where);
        return r ? withInclude(table, r, args.include, args.select) : null;
      },
      async findUniqueOrThrow(args) {
        const r = uniqueWhere(args.where);
        if (!r) throw new Error("Record not found");
        return withInclude(table, r, args.include, args.select);
      },
      async create(args) {
        const row: Row = { id: cuid(), createdAt: new Date(), updatedAt: new Date(), ...(defaults[table]?.() ?? {}) };
        applyData(row, args.data);
        tables[table].push(row);
        return withInclude(table, row, args.include);
      },
      async createMany(args) {
        for (const data of args.data) await d.create({ data });
        return { count: args.data.length };
      },
      async update(args) {
        const row = uniqueWhere(args.where);
        if (!row) throw new Error(`Record not found: ${table}`);
        applyData(row, args.data);
        row.updatedAt = new Date();
        return withInclude(table, row, args.include);
      },
      async updateMany(args) {
        const rows = find(args.where);
        for (const r of rows) { applyData(r, args.data); r.updatedAt = new Date(); }
        return { count: rows.length };
      },
      async upsert(args) {
        const row = uniqueWhere(args.where);
        if (row) return d.update({ where: args.where, data: args.update, include: args.include });
        return d.create({ data: args.create, include: args.include });
      },
      async delete(args) {
        const row = uniqueWhere(args.where);
        if (!row) throw new Error("Record not found");
        tables[table].splice(tables[table].indexOf(row), 1);
        return row;
      },
      async deleteMany(args = {}) {
        const rows = find(args.where);
        for (const r of rows) tables[table].splice(tables[table].indexOf(r), 1);
        return { count: rows.length };
      },
      async count(args = {}) {
        return find(args.where).length;
      },
    };
    return d;
  }

  const client: Record<string, any> = new Proxy({} as Record<string, any>, {
    get(target, prop: string) {
      if (typeof prop !== "string" || prop.startsWith("$") || prop.startsWith("__") || prop === "then") return target[prop];
      return (target[prop] ??= delegate(prop));
    },
  });
  client.$transaction = async (fn: any) => (typeof fn === "function" ? fn(client) : Promise.all(fn));
  client.$executeRaw = async () => 0;
  client.__tables = tables;
  return client;
}
