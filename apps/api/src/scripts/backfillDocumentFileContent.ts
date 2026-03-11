import { readFile } from "fs/promises";
import { closePool, getPool } from "@re-sourcing/db";
import { resolveGeneratedDocPath } from "../deal/generatedDocStorage.js";
import { resolveInquiryFilePath } from "../inquiry/storage.js";
import { resolveUploadedDocFilePath } from "../upload/uploadedDocStorage.js";

type BackfillRow = {
  id: string;
  file_path?: string | null;
  storage_path?: string | null;
};

async function readBufferOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function backfillUploadedDocuments() {
  const pool = getPool();
  const rows = (
    await pool.query<BackfillRow>(
      `SELECT id, file_path
       FROM property_uploaded_documents
       WHERE file_content IS NULL
         AND file_path IS NOT NULL`
    )
  ).rows;

  let updated = 0;
  let missing = 0;
  for (const row of rows) {
    const absolutePath = resolveUploadedDocFilePath(row.file_path ?? "");
    const buffer = await readBufferOrNull(absolutePath);
    if (!buffer) {
      missing += 1;
      continue;
    }
    await pool.query(
      `UPDATE property_uploaded_documents
       SET file_content = $1
       WHERE id = $2
         AND file_content IS NULL`,
      [buffer, row.id]
    );
    updated += 1;
  }

  return { scanned: rows.length, updated, missing };
}

async function backfillInquiryDocuments() {
  const pool = getPool();
  const rows = (
    await pool.query<BackfillRow>(
      `SELECT id, file_path
       FROM property_inquiry_documents
       WHERE file_content IS NULL
         AND file_path IS NOT NULL`
    )
  ).rows;

  let updated = 0;
  let missing = 0;
  for (const row of rows) {
    const absolutePath = resolveInquiryFilePath(row.file_path ?? "");
    const buffer = await readBufferOrNull(absolutePath);
    if (!buffer) {
      missing += 1;
      continue;
    }
    await pool.query(
      `UPDATE property_inquiry_documents
       SET file_content = $1
       WHERE id = $2
         AND file_content IS NULL`,
      [buffer, row.id]
    );
    updated += 1;
  }

  return { scanned: rows.length, updated, missing };
}

async function backfillGeneratedDocuments() {
  const pool = getPool();
  const rows = (
    await pool.query<BackfillRow>(
      `SELECT id, storage_path
       FROM documents
       WHERE file_content IS NULL
         AND storage_path IS NOT NULL`
    )
  ).rows;

  let updated = 0;
  let missing = 0;
  for (const row of rows) {
    const absolutePath = resolveGeneratedDocPath(row.storage_path ?? "");
    const buffer = await readBufferOrNull(absolutePath);
    if (!buffer) {
      missing += 1;
      continue;
    }
    await pool.query(
      `UPDATE documents
       SET file_content = $1
       WHERE id = $2
         AND file_content IS NULL`,
      [buffer, row.id]
    );
    updated += 1;
  }

  return { scanned: rows.length, updated, missing };
}

async function main(): Promise<number> {
  try {
    const [uploaded, inquiry, generated] = await Promise.all([
      backfillUploadedDocuments(),
      backfillInquiryDocuments(),
      backfillGeneratedDocuments(),
    ]);

    console.log(
      JSON.stringify(
        {
          uploaded,
          inquiry,
          generated,
        },
        null,
        2
      )
    );
    return 0;
  } finally {
    await closePool().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
