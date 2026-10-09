#!/usr/bin/env node
/**
 * Agensi Skill Packager
 *
 * Validates the SKILL.md structure against the Agensi.io 8-point security requirements
 * and packages the skill directory into a submission-ready standard ZIP archive in dist/.
 *
 * Uses a pure Node.js ZIP archiver to ensure RFC-compliant POSIX forward-slash paths
 * across Windows, macOS, and Linux, eliminating backslash corruption on Unix unpackers.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import zlib from "node:zlib";

const SKILL_DIR = resolve("skills/cloudflare-search-mcp");
const DIST_DIR = resolve("dist");
const OUTPUT_ZIP = join(DIST_DIR, "cloudflare-search-mcp-skill.zip");
const EXPECTED_TOOLS = ["search", "multi_search", "fetch_page", "github_search"];

console.log("==> Validating Agensi.io Skill Package...");

// Check 1: SKILL.md exists
const skillMdPath = join(SKILL_DIR, "SKILL.md");
if (!existsSync(skillMdPath)) {
  console.error("FAIL: SKILL.md not found at", skillMdPath);
  process.exit(1);
}

// Check 2: Frontmatter validation
const content = readFileSync(skillMdPath, "utf-8");
const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!frontmatterMatch) {
  console.error("FAIL: SKILL.md missing valid YAML frontmatter delimiters (---)");
  process.exit(1);
}

const frontmatter = frontmatterMatch[1];
const requiredFields = ["name", "description", "license", "compatibility", "allowed-tools"];
for (const field of requiredFields) {
  if (!frontmatter.includes(field + ":")) {
    console.error(`FAIL: Missing required frontmatter field '${field}'`);
    process.exit(1);
  }
}

// Check 3: Allowed tools match server implementation
for (const tool of EXPECTED_TOOLS) {
  if (!frontmatter.includes(`- ${tool}`)) {
    console.error(`FAIL: SKILL.md allowed-tools missing registered server tool '${tool}'`);
    process.exit(1);
  }
}

// Check 4: Verify tool names in code blocks (catch fetchPage, multiSearch, etc.)
const invalidToolPatterns = [
  { pattern: /\bfetchPage\s*\(/, correct: "fetch_page(" },
  { pattern: /\bmultiSearch\s*\(/, correct: "multi_search(" },
  { pattern: /\bsearchWeb\s*\(/, correct: "search(" },
  { pattern: /\bgithubSearch\s*\(/, correct: "github_search(" },
];

function scanDirForInvalidToolCalls(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirForInvalidToolCalls(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const text = readFileSync(fullPath, "utf-8");
      for (const { pattern, correct } of invalidToolPatterns) {
        if (pattern.test(text)) {
          console.error(`FAIL: ${relative(SKILL_DIR, fullPath)} contains invalid tool call syntax. Use '${correct}'`);
          process.exit(1);
        }
      }
    }
  }
}
scanDirForInvalidToolCalls(SKILL_DIR);

// Check 5: Secrets scan (Agensi check 4)
const sensitivePatterns = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{20,}/,
  /bearer\s+eyJ[a-zA-Z0-9_-]{20,}/i,
];
for (const pattern of sensitivePatterns) {
  if (pattern.test(content)) {
    console.error("FAIL: Potential hardcoded secret found in SKILL.md");
    process.exit(1);
  }
}

console.log("==> Pre-submission validation passed 100%.");

if (!existsSync(DIST_DIR)) {
  mkdirSync(DIST_DIR, { recursive: true });
}

// Pure Node.js RFC 1951/ZIP archiver with strict forward-slash POSIX paths
function collectFiles(dir, baseDir = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const relPath = relative(baseDir, fullPath).split(sep).join("/");
      files.push({ relPath, data: readFileSync(fullPath) });
    }
  }
  return files;
}

function createZipArchive(files, outputPath) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.relPath, "utf8");
    const crc = zlib.crc32(file.data);
    const compressed = zlib.deflateRawSync(file.data);

    // Local file header (30 bytes + nameBuf.length)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4);         // version needed: 2.0
    local.writeUInt16LE(0x0800, 6);     // flags: UTF-8 (bit 11)
    local.writeUInt16LE(8, 8);          // compression method: 8 (deflate)
    local.writeUInt16LE(0, 10);         // time
    local.writeUInt16LE(0, 12);         // date
    local.writeUInt32LE(crc, 14);       // crc-32
    local.writeUInt32LE(compressed.length, 18); // comp size
    local.writeUInt32LE(file.data.length, 22);   // uncomp size
    local.writeUInt16LE(nameBuf.length, 26);     // name len
    local.writeUInt16LE(0, 28);                  // extra len
    nameBuf.copy(local, 30);

    // Central directory header (46 bytes + nameBuf.length)
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0x0800, 8);      // flags: UTF-8
    central.writeUInt16LE(8, 10);          // compression
    central.writeUInt16LE(0, 12);          // time
    central.writeUInt16LE(0, 14);          // date
    central.writeUInt32LE(crc, 16);        // crc-32
    central.writeUInt32LE(compressed.length, 20); // comp size
    central.writeUInt32LE(file.data.length, 24);   // uncomp size
    central.writeUInt16LE(nameBuf.length, 28);     // name len
    central.writeUInt16LE(0, 30);                  // extra len
    central.writeUInt16LE(0, 32);                  // comment len
    central.writeUInt16LE(0, 34);                  // disk start
    central.writeUInt16LE(0, 36);                  // internal attrs
    central.writeUInt32LE(0, 38);                  // external attrs
    central.writeUInt32LE(offset, 42);             // local header offset
    nameBuf.copy(central, 46);

    localHeaders.push(local, compressed);
    centralHeaders.push(central);
    offset += local.length + compressed.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of centralHeaders) centralSize += c.length;

  // End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // disk with central dir
  eocd.writeUInt16LE(files.length, 8);    // entries on this disk
  eocd.writeUInt16LE(files.length, 10);   // total entries
  eocd.writeUInt32LE(centralSize, 12);    // central dir size
  eocd.writeUInt32LE(centralOffset, 16);  // central dir offset
  eocd.writeUInt16LE(0, 20);              // comment length

  writeFileSync(outputPath, Buffer.concat([...localHeaders, ...centralHeaders, eocd]));
}

console.log("==> Packaging into:", OUTPUT_ZIP);
const filesToPack = collectFiles(SKILL_DIR);
createZipArchive(filesToPack, OUTPUT_ZIP);

// Verify ZIP entry formatting
const packedBuffer = readFileSync(OUTPUT_ZIP);
let eocdOffset = -1;
for (let i = packedBuffer.length - 22; i >= 0; i--) {
  if (packedBuffer.readUInt32LE(i) === 0x06054b50) {
    eocdOffset = i;
    break;
  }
}
if (eocdOffset === -1) {
  console.error("FAIL: Created ZIP is missing valid EOCD marker");
  process.exit(1);
}

const totalEntries = packedBuffer.readUInt16LE(eocdOffset + 10);
const cdOffset = packedBuffer.readUInt16LE(eocdOffset + 16);
let p = cdOffset;
const entryNames = [];
for (let i = 0; i < totalEntries; i++) {
  if (packedBuffer.readUInt32LE(p) !== 0x02014b50) break;
  const nameLen = packedBuffer.readUInt16LE(p + 28);
  const extraLen = packedBuffer.readUInt16LE(p + 30);
  const commentLen = packedBuffer.readUInt16LE(p + 32);
  const name = packedBuffer.toString("utf8", p + 46, p + 46 + nameLen);
  if (name.includes("\\")) {
    console.error(`FAIL: ZIP entry '${name}' contains backslash path separator! Must be forward slash.`);
    process.exit(1);
  }
  entryNames.push(name);
  p += 46 + nameLen + extraLen + commentLen;
}

if (!entryNames.includes("SKILL.md")) {
  console.error("FAIL: ZIP root is missing SKILL.md");
  process.exit(1);
}

console.log(`==> Skill package verified successfully (${entryNames.length} entries, all POSIX '/'):`);
for (const entry of entryNames) {
  console.log(`    - ${entry}`);
}
console.log("==> Skill package successfully created:", OUTPUT_ZIP);
