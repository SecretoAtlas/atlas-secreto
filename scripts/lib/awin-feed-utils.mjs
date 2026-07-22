import { inflateRawSync } from "node:zlib";
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { extname, basename, dirname, resolve } from "node:path";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

export function parseCsv(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) {
    throw new Error("CSV inválido: comillas sin cerrar");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((header) => cleanText(header));
  if (headers.some((header) => !header)) {
    throw new Error("CSV inválido: contiene una columna sin nombre");
  }

  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index
  );
  if (duplicateHeaders.length > 0) {
    throw new Error(`CSV inválido: columnas duplicadas: ${[...new Set(duplicateHeaders)].join(", ")}`);
  }

  const records = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const values = rows[rowIndex];
    if (values.length === 1 && values[0] === "") continue;

    const record = { __rowNumber: rowIndex + 1 };
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      record[headers[columnIndex]] = values[columnIndex] ?? "";
    }
    records.push(record);
  }

  return { headers, records };
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error("ZIP inválido: no se encontró el directorio central");
}

export function extractFirstCsvFromZip(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(centralOffset) !== ZIP_CENTRAL_DIRECTORY) {
      throw new Error("ZIP inválido: entrada del directorio central dañada");
    }

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileName = buffer
      .subarray(centralOffset + 46, centralOffset + 46 + fileNameLength)
      .toString("utf8");

    entries.push({
      fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  const entry = entries.find(
    (candidate) => !candidate.fileName.endsWith("/") && /\.csv$/i.test(candidate.fileName)
  );

  if (!entry) throw new Error("El ZIP no contiene ningún archivo CSV");

  if (buffer.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error("ZIP inválido: cabecera local dañada");
  }

  const localFileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + localFileNameLength + localExtraLength;
  const compressedData = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  let csvBuffer;
  if (entry.compressionMethod === 0) {
    csvBuffer = compressedData;
  } else if (entry.compressionMethod === 8) {
    csvBuffer = inflateRawSync(compressedData);
  } else {
    throw new Error(`ZIP no compatible: método de compresión ${entry.compressionMethod}`);
  }

  if (entry.uncompressedSize && csvBuffer.length !== entry.uncompressedSize) {
    throw new Error("ZIP inválido: el tamaño descomprimido no coincide");
  }

  return {
    fileName: entry.fileName,
    text: csvBuffer.toString("utf8")
  };
}

export async function readAwinFeed(inputPath) {
  const absolutePath = resolve(inputPath);
  const buffer = await readFile(absolutePath);
  const extension = extname(absolutePath).toLowerCase();

  if (extension === ".zip") {
    const extracted = extractFirstCsvFromZip(buffer);
    const parsed = parseCsv(extracted.text);
    return {
      ...parsed,
      sourceArchive: basename(absolutePath),
      sourceFile: extracted.fileName
    };
  }

  if ([".csv", ".txt"].includes(extension)) {
    const parsed = parseCsv(buffer.toString("utf8"));
    return {
      ...parsed,
      sourceArchive: null,
      sourceFile: basename(absolutePath)
    };
  }

  throw new Error("Formato no compatible. Utiliza el CSV o ZIP descargado de Awin.");
}

export function cleanText(value) {
  return String(value ?? "").trim();
}

export function normalizeSearchText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(value, fallback = "item") {
  const slug = normalizeSearchText(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    quot: '"',
    lt: "<",
    gt: ">",
    nbsp: " ",
    euro: "€"
  };

  return String(value ?? "").replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) {
        const codePoint = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      if (lower.startsWith("#")) {
        const codePoint = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      return named[lower] ?? match;
    }
  );
}

export function cleanDescription(value, maximumLength = 1_200) {
  const clean = decodeHtmlEntities(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|li|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (clean.length <= maximumLength) return clean;
  return `${clean.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`;
}

export function parseDecimal(value) {
  const text = cleanText(value);
  if (!text) return null;

  const normalized = text
    .replace(/\s/g, "")
    .replace(/€|EUR/gi, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/,(?=\d{3}(?:\D|$))/g, "")
    .replace(/[^0-9.+-]/g, "");

  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function parseInteger(value) {
  const number = parseDecimal(value);
  return Number.isInteger(number) ? number : null;
}

export function parseBoolean(value) {
  const normalized = normalizeSearchText(value);
  if (["1", "true", "yes", "si", "sí", "y", "available", "in stock"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "unavailable", "out of stock"].includes(normalized)) {
    return false;
  }
  return null;
}

export function isHttpsUrl(value) {
  return /^https:\/\//i.test(cleanText(value));
}

export function uniqueHttpsUrls(values, maximum = 8) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    const url = cleanText(value);
    if (!isHttpsUrl(url) || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= maximum) break;
  }

  return result;
}

export function normalizeGtin(value) {
  const digits = cleanText(value).replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : null;
}

export function isValidGtin(value) {
  const digits = normalizeGtin(value);
  if (!digits) return false;

  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index]);
    sum += digit * (index % 2 === 0 ? 3 : 1);
  }

  const expectedCheckDigit = (10 - (sum % 10)) % 10;
  return expectedCheckDigit === Number(digits.at(-1));
}

export function canonicalGtin(value) {
  const digits = normalizeGtin(value);
  if (!digits || !isValidGtin(digits)) return null;
  return digits.padStart(14, "0");
}

export function normalizeMpn(value) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

export function normalizeBrand(value) {
  return normalizeSearchText(value).replace(/\s+/g, " ");
}

export function chooseNewestIso(...values) {
  const valid = values
    .filter(Boolean)
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);
  return valid[0]?.value ?? null;
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
    await rm(path, { force: true });
    await rename(temporaryPath, path);
  }
}
