/**
 * Encrypted file attachments.
 *
 * A bill is more useful with the invoice attached to it, but uploading the PDF
 * as-is would undo the point of the vault: the file states the vendor, the
 * amount, the address and often the bank details in plain sight, and the anon
 * key that reaches the bucket ships inside the browser bundle.
 *
 * So the bytes are encrypted in the tab under the same key as everything else,
 * and object storage holds ciphertext under a random name. What is left in the
 * bucket is a pile of unlabelled noise: no filename, no vendor, no ordering
 * that means anything. The real name and type live inside the item's encrypted
 * payload, where they are already protected.
 *
 * The cost of this is that Supabase can no longer preview or thumbnail the
 * file, and every view is a download-and-decrypt. That is the correct trade
 * here and the same one the rest of the app makes.
 */

import { openBytes, randomObjectName, sealBytes } from './crypto.ts';
import type { Client } from './supabase.ts';

export const FILES_BUCKET = 'vault-files';

/** Matches the bucket's own limit, checked here so the failure is a sentence. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * The pointer stored on an item. Everything identifying is in here rather than
 * on the object, and this whole record is inside the item's ciphertext.
 */
export type Attachment = {
  /** Random object name in the bucket. */
  path: string;
  /** Base64 IV for the file's own AES-GCM envelope. */
  iv: string;
  /** Original filename, for the download. */
  name: string;
  /** Original MIME type, so the blob URL renders correctly. */
  type: string;
  /** Plaintext size in bytes, for display. */
  size: number;
  /** ISO timestamp of the upload. */
  addedAt: string;
};

export class AttachmentError extends Error {}

/**
 * What an upload needs to know. A browser `File` satisfies this as-is; naming
 * the shape rather than the class is what lets the bulk attacher run in Node
 * without depending on a `File` global being present there.
 */
export type UploadSource = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

/** Encrypt a file and upload it. Returns the pointer to store on the item. */
export async function uploadAttachment(
  client: Client,
  key: CryptoKey,
  file: UploadSource,
): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new AttachmentError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`,
    );
  }

  const { iv, data } = await sealBytes(key, await file.arrayBuffer());
  const path = randomObjectName();

  const { error } = await client.storage.from(FILES_BUCKET).upload(path, data, {
    // Ciphertext has no type of its own, and claiming one would be a lie the
    // bucket policy rejects anyway.
    contentType: 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    // The bucket is created by a migration, so its absence is the one failure
    // worth naming precisely: everything else reads as a generic upload error.
    if (/bucket/i.test(error.message)) {
      throw new AttachmentError(
        'The vault-files bucket does not exist yet. Run npm run db:push, then try again.',
      );
    }
    throw new AttachmentError(error.message);
  }

  return {
    path,
    iv,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    addedAt: new Date().toISOString(),
  };
}

/**
 * Download and decrypt, back into a Blob carrying the original type so it can
 * be handed to a blob URL and rendered.
 */
export async function readAttachment(
  client: Client,
  key: CryptoKey,
  ref: Attachment,
): Promise<Blob> {
  const { data, error } = await client.storage.from(FILES_BUCKET).download(ref.path);
  if (error || !data) {
    throw new AttachmentError(
      error?.message ?? 'That file is no longer in storage. It may have been deleted.',
    );
  }

  const plain = await openBytes(key, ref.iv, await data.arrayBuffer());
  return new Blob([plain], { type: ref.type });
}

/**
 * Best effort. A pointer with no object behind it is a broken link; an object
 * with no pointer to it is invisible and bills for storage forever, so removal
 * failures are surfaced rather than swallowed.
 */
export async function deleteAttachment(client: Client, ref: Attachment): Promise<void> {
  const { error } = await client.storage.from(FILES_BUCKET).remove([ref.path]);
  if (error) throw new AttachmentError(error.message);
}

/** `1.4 MB`, for the file row. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
