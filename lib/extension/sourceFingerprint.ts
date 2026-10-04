/** Stable original-byte identity shared across browser and server adapters.
 * No MIME/size fallback: unavailable cryptography leaves source unverified.
 */
export async function sourceBytesFingerprint(bytes:Uint8Array):Promise<string>{
 const subtle=globalThis.crypto?.subtle;
 if(!subtle)throw new Error('Original-source SHA256 unavailable; review source in SuperK');
 const digest=new Uint8Array(await subtle.digest('SHA-256',new Uint8Array(bytes).buffer));
 return Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
}
export async function originalSourceFingerprint(base64:string):Promise<string>{
 const binary=atob(base64);
 return sourceBytesFingerprint(Uint8Array.from(binary,value=>value.charCodeAt(0)));
}
