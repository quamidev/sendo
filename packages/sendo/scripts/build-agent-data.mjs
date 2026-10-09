#!/usr/bin/env node
// Runs after tsup (`pnpm build`). Writes the data `sendo mcp` serves next to the CLI bundle:
// - dist/api.json       every public export of every subpath in `exports`, read from the built
//                       `.d.ts` with the TypeScript checker: declaration text, JSDoc, members and,
//                       for members typed as another export, that export's name (so
//                       `sendo.inbox.reply` resolves through `Sendo.inbox` → `InboxApi.reply`).
// - dist/registry.json  registry/registry.json (names, files, env, deps) plus each item's AGENTS.md.
// Docs pages are not built here: `apps/web/scripts/build-llms.mjs` writes the checked-in
// docs/docs.json, which ships in `files` next to dist/.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const packageDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const distDir = path.join(packageDir, "dist");
const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));

function fail(message) {
  console.error(`[build-agent-data] ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// API reference

function entryPoints() {
  const entries = [];
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    const types = value?.import?.types;
    if (typeof types !== "string") continue;
    const file = path.join(packageDir, types);
    if (!existsSync(file)) fail(`${types} (exports["${key}"]) is missing. Run tsup first.`);
    entries.push({ entry: key === "." ? pkg.name : `${pkg.name}${key.slice(1)}`, file });
  }
  return entries;
}

function kindOf(declaration) {
  if (ts.isFunctionDeclaration(declaration)) return "function";
  if (ts.isClassDeclaration(declaration)) return "class";
  if (ts.isInterfaceDeclaration(declaration)) return "interface";
  if (ts.isTypeAliasDeclaration(declaration)) return "type";
  if (ts.isEnumDeclaration(declaration)) return "enum";
  if (ts.isVariableDeclaration(declaration)) return "const";
  if (ts.isModuleDeclaration(declaration)) return "namespace";
  return "other";
}

function declarationText(declaration) {
  const node =
    ts.isVariableDeclaration(declaration) && ts.isVariableStatement(declaration.parent?.parent)
      ? declaration.parent.parent
      : declaration;
  return node
    .getText()
    .replace(/^export\s+/, "")
    .replace(/^(?!declare\b)(const|let|function|class|enum)\b/, "declare $1");
}

function docOf(symbol, checker) {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  const tags = symbol
    .getJsDocTags(checker)
    .map((tag) => `@${tag.name}${tag.text ? ` ${ts.displayPartsToString(tag.text)}` : ""}`);
  return [text, ...tags].filter((part) => part !== "").join("\n");
}

function buildApiReference() {
  const entries = entryPoints();
  const program = ts.createProgram(
    entries.map((e) => e.file),
    {
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    },
  );
  const checker = program.getTypeChecker();
  /** @type {Map<ts.Symbol, { name: string; entries: string[]; symbol: ts.Symbol }>} */
  const exported = new Map();

  for (const { entry, file } of entries) {
    const source = program.getSourceFile(file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) fail(`could not read the exports of ${file}.`);
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const known = exported.get(target);
      if (known) {
        if (!known.entries.includes(entry)) known.entries.push(entry);
      } else {
        exported.set(target, { name: symbol.getName(), entries: [entry], symbol: target });
      }
    }
  }

  const nameOf = (type) => {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    return symbol ? exported.get(symbol)?.name : undefined;
  };

  const membersOf = (declaration) => {
    if (!ts.isInterfaceDeclaration(declaration) && !ts.isClassDeclaration(declaration)) return [];
    const members = [];
    for (const member of declaration.members) {
      if (!member.name || ts.isConstructorDeclaration(member)) continue;
      const symbol = checker.getSymbolAtLocation(member.name);
      if (!symbol) continue;
      if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) continue;
      const type = checker.getTypeOfSymbolAtLocation(symbol, member);
      const typeName = nameOf(checker.getNonNullableType(type));
      members.push({
        name: symbol.getName(),
        text: member.getText(),
        doc: docOf(symbol, checker),
        ...(typeName === undefined ? {} : { type: typeName }),
      });
    }
    return members;
  };

  const symbols = [...exported.values()]
    .map(({ name, entries: from, symbol }) => {
      const declarations = (symbol.declarations ?? []).filter(
        (d) => !ts.isSourceFile(d) && d.getSourceFile().fileName.startsWith(distDir),
      );
      if (declarations.length === 0) return null;
      const members = declarations.flatMap(membersOf);
      return {
        name,
        kind: kindOf(declarations[0]),
        entries: from.sort(),
        doc: docOf(symbol, checker),
        declaration: declarations.map(declarationText).join("\n"),
        ...(members.length === 0 ? {} : { members }),
      };
    })
    .filter((symbol) => symbol !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { package: pkg.name, version: pkg.version, symbols };
}

// ---------------------------------------------------------------------------
// Registry catalog

function buildRegistryCatalog() {
  const manifestPath = path.join(repoRoot, "registry", "registry.json");
  if (!existsSync(manifestPath)) {
    fail(`${manifestPath} not found: build @quami/sendo from the monorepo checkout.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const items = manifest.items.map((item) => {
    const agents = item.files.find((file) => /(^|\/)AGENTS\.md$/.test(file.path));
    const agentsPath = agents && path.join(repoRoot, agents.path);
    return {
      name: item.name,
      type: item.type,
      title: item.title ?? item.name,
      description: item.description ?? "",
      install: `npx shadcn@latest add @sendo/${item.name}`,
      dependencies: item.dependencies ?? [],
      registryDependencies: item.registryDependencies ?? [],
      envVars: Object.keys(item.envVars ?? {}),
      files: item.files.map((file) => ({ type: file.type, target: file.target ?? file.path })),
      postInstall: item.docs ?? "",
      agentsPath: agents ? (agents.target ?? agents.path) : null,
      agents: agentsPath && existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null,
    };
  });
  return { name: manifest.name, homepage: manifest.homepage, items };
}

const api = buildApiReference();
writeFileSync(path.join(distDir, "api.json"), `${JSON.stringify(api)}\n`);
const registry = buildRegistryCatalog();
writeFileSync(path.join(distDir, "registry.json"), `${JSON.stringify(registry)}\n`);
console.log(
  `[build-agent-data] dist/api.json (${api.symbols.length} symbols), dist/registry.json (${registry.items.length} items)`,
);
