#!/usr/bin/env node
/**
 * Two-door route-coverage check (Phase 5).
 *
 * The public door has two independent gatekeepers that must agree:
 *   1. nginx — deploy/nginx/snippets/public-api-allowlist.conf
 *   2. the API — DoorGuard, deciding from @Roles / @PublicDoor / @PrivateDoor
 *
 * This script derives the API's answer for EVERY HTTP route straight from
 * the controller sources (same precedence as DoorGuard), simulates nginx's
 * location matching over the allowlist for the same method+path, and
 * fails if any route is allowed by one layer and refused by the other.
 * Code is the source of truth; the markdown classification is not read.
 *
 *   node scripts/two-door/check-route-coverage.mjs [--verbose]
 *
 * Exit 1 on any mismatch or on an unparseable location.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTROLLERS_DIR = join(ROOT, 'apps', 'api', 'src');
const ALLOWLIST = join(ROOT, 'deploy', 'nginx', 'snippets', 'public-api-allowlist.conf');
const VERBOSE = process.argv.includes('--verbose');

// ─── 1. Routes from the controller sources ──────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const ROLES_RE = /^\s*@Roles\(([^)]*)\)/;
const DOOR_RE = /^\s*@(PublicDoor|PrivateDoor)\(\)/;
const CTRL_RE = /^\s*@Controller\((?:'([^']*)')?\)/;
const METHOD_RE = /^\s*@(Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/;
const HANDLER_RE = /^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/;

function parseRoles(argText) {
  return [...argText.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Line-based state machine. Decorators above `@Controller` belong to the
 * class; decorators between an HTTP-method decorator and the handler
 * signature belong to that handler (any decorator in between is fine —
 * this is what the Phase 0 extractor got wrong).
 */
function extractRoutes(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const routes = [];
  let classRoles;
  let classDoor;
  let pendingRoles;
  let pendingDoor;
  let ctrl = null;
  let current = null; // { method, sub, roles, door }

  for (const line of lines) {
    if (/^\s*\/\//.test(line)) continue;
    const c = line.match(CTRL_RE);
    if (c) {
      ctrl = c[1] ?? '';
      continue;
    }
    // Class-level decorators may sit before OR after @Controller (both are
    // valid TypeScript); they are committed when the class keyword arrives.
    if (/^\s*(export\s+)?class\s/.test(line)) {
      classRoles = pendingRoles;
      classDoor = pendingDoor;
      pendingRoles = undefined;
      pendingDoor = undefined;
      current = null;
      continue;
    }
    const m = line.match(METHOD_RE);
    if (m) {
      current = { method: m[1].toUpperCase(), sub: m[2] ?? '', roles: undefined, door: undefined };
      continue;
    }
    const r = line.match(ROLES_RE);
    if (r) {
      if (current) current.roles = parseRoles(r[1]);
      else pendingRoles = parseRoles(r[1]);
      continue;
    }
    const d = line.match(DOOR_RE);
    if (d) {
      const policy = d[1] === 'PublicDoor' ? 'public' : 'private';
      if (current) current.door = policy;
      else pendingDoor = policy;
      continue;
    }
    if (current && HANDLER_RE.test(line) && !/^\s*@/.test(line)) {
      const path = ('/api/' + [ctrl, current.sub].filter(Boolean).join('/')).replace(/\/+/g, '/');
      routes.push({
        file: file.slice(ROOT.length + 1),
        method: current.method,
        path,
        handlerRoles: current.roles,
        handlerDoor: current.door,
        classRoles,
        classDoor,
      });
      current = null;
    }
  }
  return routes;
}

/** Same precedence as apps/api/src/common/door/door.guard.ts. */
function codeAllowsOnPublicDoor(route) {
  if (route.handlerDoor) return route.handlerDoor === 'public';
  const roles = route.handlerRoles ?? route.classRoles;
  if (roles && roles.length > 0) return roles.includes('student');
  if (route.classDoor) return route.classDoor === 'public';
  return false;
}

// ─── 2. nginx allowlist simulation ──────────────────────────────────────

function parseAllowlist(text) {
  const locations = [];
  const re = /location\s+(=|\^~|~)?\s*(\S+)\s*\{([^}]*)\}/g;
  for (const m of text.matchAll(re)) {
    const [, modifier = '', pattern, body] = m;
    let allow;
    let methods = null;
    if (/return\s+404/.test(body)) allow = false;
    else {
      const inc = body.match(/proxy-api(?:-([a-z-]+))?\.conf/);
      if (!inc) throw new Error(`Unrecognised location body for ${modifier}${pattern}: ${body.trim()}`);
      allow = true;
      if (inc[1]) methods = inc[1].toUpperCase().split('-');
    }
    locations.push({ modifier, pattern, allow, methods, regex: modifier === '~' ? new RegExp(pattern) : null });
  }
  if (locations.length === 0) throw new Error('No location blocks parsed from the allowlist');
  return locations;
}

function nginxMatch(locations, path) {
  const exact = locations.find((l) => l.modifier === '=' && l.pattern === path);
  if (exact) return exact;
  let best = null;
  for (const l of locations) {
    if (l.modifier === '=' || l.modifier === '~') continue;
    if (path.startsWith(l.pattern) && (!best || l.pattern.length > best.pattern.length)) best = l;
  }
  if (best && best.modifier === '^~') return best;
  for (const l of locations) {
    if (l.modifier === '~' && l.regex.test(path)) return l;
  }
  return best; // may be null → nginx would fall to the SPA `location /`, i.e. not the API
}

function nginxAllows(locations, method, path) {
  const loc = nginxMatch(locations, path);
  if (!loc || !loc.allow) return false;
  if (loc.methods && !loc.methods.includes(method)) return false;
  return true;
}

/** Replace `:param` segments with a UUID-shaped value, as a real request would carry. */
function concretePath(pattern) {
  return pattern.replace(/:[A-Za-z_]+/g, '0f1e2d3c-4b5a-4697-8899-aabbccddeeff');
}

// ─── 3. Compare ─────────────────────────────────────────────────────────

const routes = walk(CONTROLLERS_DIR).flatMap(extractRoutes);
const locations = parseAllowlist(readFileSync(ALLOWLIST, 'utf8'));

const mismatches = [];
let publicCount = 0;
for (const r of routes) {
  const code = codeAllowsOnPublicDoor(r);
  const nginx = nginxAllows(locations, r.method, concretePath(r.path));
  if (code) publicCount++;
  if (code !== nginx) mismatches.push({ ...r, code, nginx });
  else if (VERBOSE) console.log(`${code ? 'PUBLIC ' : 'private'} ${r.method.padEnd(6)} ${r.path}`);
}

console.log(
  `two-door route coverage: ${routes.length} routes, ${publicCount} servable on the public door, ${locations.length} nginx locations`,
);
if (mismatches.length) {
  console.error(`\n${mismatches.length} route(s) where nginx and DoorGuard disagree:`);
  for (const m of mismatches) {
    console.error(
      `  ${m.method.padEnd(6)} ${m.path}\n         code=${m.code ? 'public' : 'private'} nginx=${m.nginx ? 'allow' : 'deny'}  (${m.file})`,
    );
  }
  process.exit(1);
}
console.log('OK — nginx allowlist and DoorGuard agree on every route.');
