#!/usr/bin/env bun
// Flip a dimension's lifecycle status (e.g. in_review -> approved). The promote action.
import { setDimensionStatus, loadDimension } from "../../server/src/db.js";

const [dimIdArg, status] = process.argv.slice(2);
const dimId = Number(dimIdArg);
if (!Number.isFinite(dimId) || !status) throw new Error("usage: set-status.ts <dimId> <status>");
if (!loadDimension(dimId)) throw new Error(`dimension ${dimId} not found`);

setDimensionStatus(dimId, status);
console.log(JSON.stringify({ ok: true, dimId, status }));
