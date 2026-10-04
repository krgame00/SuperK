import { inspectBackgroundEvidence, type ExtensionEvidence } from "./strictParity";

const MAX_CLEAN_IMAGE_DATA_URL_LENGTH = 28 * 1024 * 1024;

/** Verify that the published clean asset is the exact image inspected in the supplied proof. */
export async function cleanAssetMatchesBackgroundProof(value: ExtensionEvidence, cleanUrl: unknown): Promise<boolean> {
  const background = inspectBackgroundEvidence(value);
  if (!background.revision || typeof cleanUrl !== "string" || cleanUrl.length > MAX_CLEAN_IMAGE_DATA_URL_LENGTH) return false;
  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/]+={0,2})$/i.exec(cleanUrl);
  if (!match) return false;
  try {
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const revision = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return revision === value.backgroundEvidence?.revisions.backgroundRevision;
  } catch {
    return false;
  }
}
