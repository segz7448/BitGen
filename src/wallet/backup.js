import CryptoJS from "crypto-js";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

/**
 * AES-256 encrypt the mnemonic (and optional BIP39 passphrase) with a
 * user-chosen password (PBKDF2 key derivation, random salt+IV per export)
 * and write it to a shareable JSON file. The password is never stored
 * anywhere — losing it means the backup file alone is useless, same as
 * losing the seed phrase itself.
 *
 * version 2: ciphertext decrypts to JSON { mnemonic, passphrase } so a
 * wallet secured behind a passphrase restores correctly. Older (version 1)
 * backups, whose ciphertext decrypts to the mnemonic as a bare string, are
 * still readable by decryptBackup below.
 */
export async function exportEncryptedBackup(mnemonic, passphrase, password) {
  const salt = CryptoJS.lib.WordArray.random(128 / 8);
  const key = CryptoJS.PBKDF2(password, salt, { keySize: 256 / 32, iterations: 100000 });
  const iv = CryptoJS.lib.WordArray.random(128 / 8);

  const encrypted = CryptoJS.AES.encrypt(
    JSON.stringify({ mnemonic, passphrase: passphrase || "" }),
    key,
    { iv }
  ).toString();

  const payload = {
    app: "BITGEN",
    version: 2,
    salt: salt.toString(),
    iv: iv.toString(),
    ciphertext: encrypted,
    createdAt: new Date().toISOString(),
  };

  const filename = `bitgen-backup-${Date.now()}.json`;
  const path = FileSystem.documentDirectory + filename;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: "Save BITGEN backup" });
  }

  return path;
}

/**
 * Decrypt a previously exported backup file's contents with the password
 * used at export time. Throws if the password is wrong or the file is
 * malformed/tampered with (AES-CBC will produce garbage, not a valid
 * mnemonic, in that case — validate the result against BIP39 wordlist
 * after decrypting).
 *
 * Returns { mnemonic, passphrase }. version 1 backups have no passphrase
 * field, so passphrase comes back as "" for those.
 */
export function decryptBackup(fileContents, password) {
  const payload = JSON.parse(fileContents);
  if (payload.app !== "BITGEN") throw new Error("Not a recognized BITGEN backup file.");

  const salt = CryptoJS.enc.Hex.parse(payload.salt);
  const iv = CryptoJS.enc.Hex.parse(payload.iv);
  const key = CryptoJS.PBKDF2(password, salt, { keySize: 256 / 32, iterations: 100000 });

  const decrypted = CryptoJS.AES.decrypt(payload.ciphertext, key, { iv });
  const plaintext = decrypted.toString(CryptoJS.enc.Utf8);

  if (!plaintext) {
    throw new Error("Incorrect password or corrupted backup file.");
  }

  let mnemonic;
  let passphrase = "";
  if (payload.version >= 2) {
    try {
      const parsed = JSON.parse(plaintext);
      mnemonic = parsed.mnemonic;
      passphrase = parsed.passphrase || "";
    } catch {
      throw new Error("Incorrect password or corrupted backup file.");
    }
  } else {
    // version 1: ciphertext was just the bare mnemonic string.
    mnemonic = plaintext;
  }

  if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) {
    throw new Error("Incorrect password or corrupted backup file.");
  }
  return { mnemonic, passphrase };
}

export async function readBackupFile(uri) {
  return FileSystem.readAsStringAsync(uri);
}
