<?php
declare(strict_types=1);
/**
 * ECMA-376 "agile" encryption (MS-OFFCRYPTO §2.3.4.10) — the scheme Excel 2010+
 * uses for "Encrypt with Password". AES-256-CBC + SHA-512, key wrapped by a
 * password-derived key, whole thing wrapped in a CFB container.
 */

require_once __DIR__ . '/Cfb.php';

class OoxmlCrypto
{
    private const BLK_VERIFIER_INPUT = "\xfe\xa7\xd2\x76\x3b\x4b\x9e\x79";
    private const BLK_VERIFIER_VALUE = "\xd7\xaa\x0f\x6d\x30\x61\x34\x4e";
    private const BLK_KEY_VALUE      = "\x14\x6e\x0b\xe7\xab\xac\xd0\xd6";
    private const BLK_HMAC_KEY       = "\x5f\xb2\xad\x01\x0c\xb9\xe1\xf6";
    private const BLK_HMAC_VALUE     = "\xa0\x67\x7f\x02\xb2\x2c\x84\x33";

    private const SEGMENT   = 4096;
    private const KEY_BITS  = 256;
    private const BLOCK_SZ  = 16;
    private const SALT_SZ   = 16;
    private const HASH      = 'sha512';
    private const HASH_SZ   = 64;
    private const SPIN      = 100000;

    /** Encrypts raw .xlsx bytes; returns the password-protected file bytes. */
    public static function encrypt(string $package, string $password): string
    {
        $keyDataSalt  = random_bytes(self::SALT_SZ);
        $passwordSalt = random_bytes(self::SALT_SZ);
        $secretKey    = random_bytes(self::KEY_BITS / 8);

        $hFinal = self::passwordHash($password, $passwordSalt);

        // --- password key encryptor: verifier + wrapped secret key ----------
        $verifier = random_bytes(self::SALT_SZ);
        $encVerifierInput = self::aes(
            self::deriveKey($hFinal, self::BLK_VERIFIER_INPUT),
            $passwordSalt,
            $verifier,
            true
        );
        $encVerifierValue = self::aes(
            self::deriveKey($hFinal, self::BLK_VERIFIER_VALUE),
            $passwordSalt,
            self::padBlock(hash(self::HASH, $verifier, true)),
            true
        );
        $encKeyValue = self::aes(
            self::deriveKey($hFinal, self::BLK_KEY_VALUE),
            $passwordSalt,
            $secretKey,
            true
        );

        // --- the package itself, in 4096-byte segments ----------------------
        $cipher = '';
        $segments = intdiv(strlen($package) + self::SEGMENT - 1, self::SEGMENT);
        for ($i = 0; $i < $segments; $i++) {
            $chunk = substr($package, $i * self::SEGMENT, self::SEGMENT);
            $iv = self::iv($keyDataSalt, pack('V', $i));
            $cipher .= self::aes($secretKey, $iv, self::padBlock($chunk), true);
        }
        $encryptedPackage = pack('P', strlen($package)) . $cipher;

        // --- data integrity (HMAC over the EncryptedPackage stream) ---------
        $hmacKey = random_bytes(self::HASH_SZ);
        $encHmacKey = self::aes(
            $secretKey,
            self::iv($keyDataSalt, self::BLK_HMAC_KEY),
            self::padBlock($hmacKey),
            true
        );
        $hmacValue = hash_hmac(self::HASH, $encryptedPackage, $hmacKey, true);
        $encHmacValue = self::aes(
            $secretKey,
            self::iv($keyDataSalt, self::BLK_HMAC_VALUE),
            self::padBlock($hmacValue),
            true
        );

        $xml = self::descriptor(
            $keyDataSalt,
            $passwordSalt,
            $encVerifierInput,
            $encVerifierValue,
            $encKeyValue,
            $encHmacKey,
            $encHmacValue
        );
        $encryptionInfo = pack('vv', 4, 4) . pack('V', 0x40) . $xml;

        return Cfb::build([
            'EncryptionInfo'   => $encryptionInfo,
            'EncryptedPackage' => $encryptedPackage,
        ]);
    }

    /**
     * Decrypts a protected file. Throws on a wrong password.
     * Only used to verify what encrypt() produced.
     */
    public static function decrypt(string $bin, string $password): string
    {
        $streams = Cfb::read($bin);
        if (!isset($streams['EncryptionInfo'], $streams['EncryptedPackage'])) {
            throw new RuntimeException('not an OOXML-encrypted file');
        }
        $info = $streams['EncryptionInfo'];
        $version = unpack('vmajor/vminor', substr($info, 0, 4));
        if ($version['major'] !== 4 || $version['minor'] !== 4) {
            throw new RuntimeException('not agile encryption');
        }
        $xml = substr($info, 8);

        $keyData = self::attrs($xml, 'keyData');
        $encKey  = self::attrs($xml, 'p:encryptedKey');
        $integ   = self::attrs($xml, 'dataIntegrity');

        $keyDataSalt  = base64_decode($keyData['saltValue']);
        $passwordSalt = base64_decode($encKey['saltValue']);
        $spin         = (int) $encKey['spinCount'];

        $hFinal = self::passwordHash($password, $passwordSalt, $spin);

        $verifier = self::aes(
            self::deriveKey($hFinal, self::BLK_VERIFIER_INPUT),
            $passwordSalt,
            base64_decode($encKey['encryptedVerifierHashInput']),
            false
        );
        $expected = self::aes(
            self::deriveKey($hFinal, self::BLK_VERIFIER_VALUE),
            $passwordSalt,
            base64_decode($encKey['encryptedVerifierHashValue']),
            false
        );
        $actual = hash(self::HASH, substr($verifier, 0, (int) $encKey['saltSize']), true);
        if (!hash_equals(substr($expected, 0, strlen($actual)), $actual)) {
            throw new RuntimeException('wrong password');
        }

        $secretKey = substr(
            self::aes(
                self::deriveKey($hFinal, self::BLK_KEY_VALUE),
                $passwordSalt,
                base64_decode($encKey['encryptedKeyValue']),
                false
            ),
            0,
            ((int) $encKey['keyBits']) / 8
        );

        $stream = $streams['EncryptedPackage'];

        if ($integ) {
            $hmacKey = substr(
                self::aes(
                    $secretKey,
                    self::iv($keyDataSalt, self::BLK_HMAC_KEY),
                    base64_decode($integ['encryptedHmacKey']),
                    false
                ),
                0,
                self::HASH_SZ
            );
            $hmacValue = substr(
                self::aes(
                    $secretKey,
                    self::iv($keyDataSalt, self::BLK_HMAC_VALUE),
                    base64_decode($integ['encryptedHmacValue']),
                    false
                ),
                0,
                self::HASH_SZ
            );
            if (!hash_equals($hmacValue, hash_hmac(self::HASH, $stream, $hmacKey, true))) {
                throw new RuntimeException('data integrity check failed');
            }
        }

        $size = unpack('P', substr($stream, 0, 8))[1];
        $cipher = substr($stream, 8);
        $plain = '';
        $segments = intdiv(strlen($cipher) + self::SEGMENT - 1, self::SEGMENT);
        for ($i = 0; $i < $segments; $i++) {
            $chunk = substr($cipher, $i * self::SEGMENT, self::SEGMENT);
            $plain .= self::aes($secretKey, self::iv($keyDataSalt, pack('V', $i)), $chunk, false);
        }
        return substr($plain, 0, $size);
    }

    // ---------------------------------------------------------------------

    private static function passwordHash(string $password, string $salt, int $spin = self::SPIN): string
    {
        $utf16 = iconv('UTF-8', 'UTF-16LE', $password);
        $h = hash(self::HASH, $salt . $utf16, true);
        for ($i = 0; $i < $spin; $i++) {
            $h = hash(self::HASH, pack('V', $i) . $h, true);
        }
        return $h;
    }

    private static function deriveKey(string $hFinal, string $blockKey): string
    {
        $bytes = self::KEY_BITS / 8;
        $k = hash(self::HASH, $hFinal . $blockKey, true);
        return strlen($k) >= $bytes ? substr($k, 0, $bytes) : str_pad($k, $bytes, "\x36");
    }

    private static function iv(string $salt, string $blockKey): string
    {
        return substr(hash(self::HASH, $salt . $blockKey, true), 0, self::BLOCK_SZ);
    }

    private static function padBlock(string $data): string
    {
        $rem = strlen($data) % self::BLOCK_SZ;
        return $rem === 0 ? $data : $data . str_repeat("\0", self::BLOCK_SZ - $rem);
    }

    private static function aes(string $key, string $iv, string $data, bool $encrypt): string
    {
        $flags = OPENSSL_RAW_DATA | OPENSSL_ZERO_PADDING;
        $out = $encrypt
            ? openssl_encrypt($data, 'aes-256-cbc', $key, $flags, $iv)
            : openssl_decrypt($data, 'aes-256-cbc', $key, $flags, $iv);
        if ($out === false) {
            throw new RuntimeException('openssl: ' . openssl_error_string());
        }
        return $out;
    }

    private static function descriptor(
        string $keyDataSalt,
        string $passwordSalt,
        string $encVerifierInput,
        string $encVerifierValue,
        string $encKeyValue,
        string $encHmacKey,
        string $encHmacValue
    ): string {
        $common = 'blockSize="' . self::BLOCK_SZ . '" keyBits="' . self::KEY_BITS . '"'
            . ' hashSize="' . self::HASH_SZ . '" cipherAlgorithm="AES"'
            . ' cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512"';

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' . "\r\n"
            . '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption"'
            . ' xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password"'
            . ' xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">'
            . '<keyData saltSize="' . self::SALT_SZ . '" ' . $common
            . ' saltValue="' . base64_encode($keyDataSalt) . '"/>'
            . '<dataIntegrity encryptedHmacKey="' . base64_encode($encHmacKey) . '"'
            . ' encryptedHmacValue="' . base64_encode($encHmacValue) . '"/>'
            . '<keyEncryptors>'
            . '<keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">'
            . '<p:encryptedKey spinCount="' . self::SPIN . '" saltSize="' . self::SALT_SZ . '" ' . $common
            . ' saltValue="' . base64_encode($passwordSalt) . '"'
            . ' encryptedVerifierHashInput="' . base64_encode($encVerifierInput) . '"'
            . ' encryptedVerifierHashValue="' . base64_encode($encVerifierValue) . '"'
            . ' encryptedKeyValue="' . base64_encode($encKeyValue) . '"/>'
            . '</keyEncryptor>'
            . '</keyEncryptors>'
            . '</encryption>';
    }

    /** Tiny attribute scraper — ext-xml/SimpleXML is not installed here. */
    private static function attrs(string $xml, string $tag): array
    {
        if (!preg_match('/<' . preg_quote($tag, '/') . '\b([^>]*)\/?>/', $xml, $m)) {
            return [];
        }
        preg_match_all('/([\w:]+)="([^"]*)"/', $m[1], $pairs, PREG_SET_ORDER);
        $out = [];
        foreach ($pairs as $p) {
            $out[$p[1]] = $p[2];
        }
        return $out;
    }
}
