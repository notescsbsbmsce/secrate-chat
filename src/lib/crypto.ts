// E2E Encryption utilities using Web Crypto API

const DB_NAME = 'vaultchat-keys';
const STORE_NAME = 'keypairs';

// IndexedDB helpers
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Generate RSA-OAEP key pair
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// Export public key to base64 string
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

// Import public key from base64 string
export async function importPublicKey(base64: string): Promise<CryptoKey> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    'spki',
    bytes.buffer as ArrayBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}

// Encrypt private key with password-derived key
async function encryptPrivateKey(privateKey: CryptoKey, password: string): Promise<{ encrypted: ArrayBuffer; salt: Uint8Array; iv: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, derivedKey, exported);
  return { encrypted, salt, iv };
}

// Decrypt private key with password
async function decryptPrivateKey(encrypted: ArrayBuffer, salt: Uint8Array, iv: Uint8Array, password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, derivedKey, encrypted);
  return crypto.subtle.importKey('pkcs8', decrypted, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

// Store encrypted private key in IndexedDB
export async function storePrivateKey(userId: string, privateKey: CryptoKey, password: string): Promise<void> {
  const { encrypted, salt, iv } = await encryptPrivateKey(privateKey, password);
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({ encrypted, salt, iv }, userId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Retrieve and decrypt private key from IndexedDB
export async function retrievePrivateKey(userId: string, password: string): Promise<CryptoKey | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const request = tx.objectStore(STORE_NAME).get(userId);
  const data = await new Promise<any>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!data) return null;
  return decryptPrivateKey(data.encrypted, data.salt, data.iv, password);
}

// Check if private key exists in IndexedDB
export async function hasPrivateKey(userId: string): Promise<boolean> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const request = tx.objectStore(STORE_NAME).get(userId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(!!request.result);
    request.onerror = () => reject(request.error);
  });
}

// Encrypt a message for multiple recipients (e.g., recipient and self)
export async function encryptMessage(plaintext: string, publicKeys: { [id: string]: CryptoKey }): Promise<{
  ciphertext: string;
  encryptedKeys: { [id: string]: string };
  iv: string;
}> {
  // Generate random AES key
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const ivArr = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt message with AES
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivArr as BufferSource }, aesKey, encoded);

  // Export AES key once
  const exportedAesKey = await crypto.subtle.exportKey('raw', aesKey);

  // Encrypt the SAME AES key for each recipient's RSA public key
  const encryptedKeys: { [id: string]: string } = {};
  for (const [id, key] of Object.entries(publicKeys)) {
    const encryptedKeyBuf = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, exportedAesKey);
    encryptedKeys[id] = btoa(String.fromCharCode(...new Uint8Array(encryptedKeyBuf)));
  }

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuf))),
    encryptedKeys: encryptedKeys,
    iv: btoa(String.fromCharCode(...new Uint8Array(ivArr))),
  };
}

// Decrypt a message
export async function decryptMessage(
  ciphertext: string,
  encryptedKeyData: string, // This will be JSON map or legacy b64 string
  iv: string,
  privateKey: CryptoKey,
  myUserId: string
): Promise<string> {
  // 1. Resolve which encrypted key to use
  let encryptedKeyB64 = '';
  try {
    const parsedKeys = JSON.parse(encryptedKeyData);
    encryptedKeyB64 = parsedKeys[myUserId] || Object.values(parsedKeys)[0] as string;
  } catch {
    // Legacy format (just a b64 string)
    encryptedKeyB64 = encryptedKeyData;
  }

  // 2. Decode all base64
  const ciphertextBuf = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const encryptedKeyBuf = Uint8Array.from(atob(encryptedKeyB64), c => c.charCodeAt(0));
  const ivBuf = Uint8Array.from(atob(iv), c => c.charCodeAt(0));

  // 3. Decrypt AES key with private RSA key
  const aesKeyBuf = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, encryptedKeyBuf);
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBuf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);

  // 4. Decrypt message
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf as BufferSource }, aesKey, ciphertextBuf);
  return new TextDecoder().decode(decrypted);
}
