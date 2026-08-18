<?php
declare(strict_types=1);
/**
 * Compound File Binary (OLE2 / MS-CFB) container writer + minimal reader.
 * An encrypted OOXML file is a CFB with two streams: EncryptionInfo and EncryptedPackage.
 */

class Cfb
{
    private const SECTOR      = 512;
    private const MINI_SECTOR = 64;
    private const CUTOFF      = 4096;

    private const FREESECT   = 0xFFFFFFFF;
    private const ENDOFCHAIN = 0xFFFFFFFE;
    private const FATSECT    = 0xFFFFFFFD;
    private const DIFSECT    = 0xFFFFFFFC;
    private const NOSTREAM   = 0xFFFFFFFF;

    /**
     * @param array<string,string> $streams name => bytes
     */
    public static function build(array $streams): string
    {
        // --- 1. split streams between the mini stream and full sectors -------
        $mini = [];
        $regular = [];
        foreach ($streams as $name => $data) {
            if (strlen($data) > 0 && strlen($data) < self::CUTOFF) {
                $mini[$name] = $data;
            } else {
                $regular[$name] = $data;
            }
        }

        // --- 2. mini stream + MiniFAT ---------------------------------------
        $miniStream = '';
        $miniStart = [];
        foreach ($mini as $name => $data) {
            $miniStart[$name] = intdiv(strlen($miniStream), self::MINI_SECTOR);
            $miniStream .= self::pad($data, self::MINI_SECTOR);
        }
        $miniSectorCount = intdiv(strlen($miniStream), self::MINI_SECTOR);
        $miniFat = array_fill(0, max(0, $miniSectorCount), self::FREESECT);
        foreach ($mini as $name => $data) {
            $n = intdiv(strlen($data) + self::MINI_SECTOR - 1, self::MINI_SECTOR);
            $s = $miniStart[$name];
            for ($i = 0; $i < $n; $i++) {
                $miniFat[$s + $i] = ($i === $n - 1) ? self::ENDOFCHAIN : $s + $i + 1;
            }
        }
        $entriesPerSector = intdiv(self::SECTOR, 4);
        $miniFatSectors = $miniSectorCount > 0
            ? intdiv(count($miniFat) + $entriesPerSector - 1, $entriesPerSector)
            : 0;
        $miniFat = array_pad($miniFat, $miniFatSectors * $entriesPerSector, self::FREESECT);

        // --- 3. lay out sectors ---------------------------------------------
        $cursor = 0;
        $dataArea = '';
        $regStart = [];
        $regCount = [];
        foreach ($regular as $name => $data) {
            if (strlen($data) === 0) {
                $regStart[$name] = self::ENDOFCHAIN;
                $regCount[$name] = 0;
                continue;
            }
            $n = intdiv(strlen($data) + self::SECTOR - 1, self::SECTOR);
            $regStart[$name] = $cursor;
            $regCount[$name] = $n;
            $dataArea .= self::pad($data, self::SECTOR);
            $cursor += $n;
        }

        $miniStreamStart = self::ENDOFCHAIN;
        $miniStreamSectors = 0;
        if ($miniStream !== '') {
            $miniStreamSectors = intdiv(strlen($miniStream) + self::SECTOR - 1, self::SECTOR);
            $miniStreamStart = $cursor;
            $dataArea .= self::pad($miniStream, self::SECTOR);
            $cursor += $miniStreamSectors;
        }

        $miniFatStart = $miniFatSectors > 0 ? $cursor : self::ENDOFCHAIN;
        $cursor += $miniFatSectors;

        $dirEntryCount = 1 + count($streams);
        $dirSectors = intdiv($dirEntryCount + 3, 4);
        $dirStart = $cursor;
        $cursor += $dirSectors;

        $nonFat = $cursor;
        $fatCount = 1;
        while (true) {
            $difat = $fatCount > 109 ? intdiv(($fatCount - 109) + 126, 127) : 0;
            $need = intdiv($nonFat + $fatCount + $difat + $entriesPerSector - 1, $entriesPerSector);
            if ($need <= $fatCount) {
                break;
            }
            $fatCount = $need;
        }
        $difatCount = $fatCount > 109 ? intdiv(($fatCount - 109) + 126, 127) : 0;
        $fatStart = $cursor;
        $difatStart = $fatStart + $fatCount;

        // --- 4. FAT ----------------------------------------------------------
        $fat = array_fill(0, $fatCount * $entriesPerSector, self::FREESECT);
        $chain = function (int $start, int $n) use (&$fat) {
            for ($i = 0; $i < $n; $i++) {
                $fat[$start + $i] = ($i === $n - 1) ? self::ENDOFCHAIN : $start + $i + 1;
            }
        };
        foreach ($regular as $name => $data) {
            if ($regCount[$name] > 0) {
                $chain($regStart[$name], $regCount[$name]);
            }
        }
        if ($miniStreamSectors > 0) {
            $chain($miniStreamStart, $miniStreamSectors);
        }
        if ($miniFatSectors > 0) {
            $chain($miniFatStart, $miniFatSectors);
        }
        $chain($dirStart, $dirSectors);
        for ($i = 0; $i < $fatCount; $i++) {
            $fat[$fatStart + $i] = self::FATSECT;
        }
        for ($i = 0; $i < $difatCount; $i++) {
            $fat[$difatStart + $i] = self::DIFSECT;
        }

        // --- 5. directory entries -------------------------------------------
        $names = array_keys($streams);
        usort($names, [self::class, 'compareNames']);

        $index = [];              // stream name => directory index (root is 0)
        foreach ($names as $i => $name) {
            $index[$name] = $i + 1;
        }

        $entries = array_fill(0, $dirSectors * 4, str_repeat("\0", 128));
        $entries[0] = self::dirEntry(
            'Root Entry',
            5,
            $miniStreamStart,
            strlen($miniStream),
            $names ? $index[$names[self::treeRoot(0, count($names) - 1)]] : self::NOSTREAM
        );
        foreach ($names as $i => $name) {
            [$left, $right] = self::treeChildren($names, $i, $index);
            $isMini = isset($mini[$name]);
            $start = $isMini ? $miniStart[$name] : $regStart[$name];
            $entries[$index[$name]] = self::dirEntry(
                $name,
                2,
                $start,
                strlen($streams[$name]),
                self::NOSTREAM,
                $left,
                $right
            );
        }

        // --- 6. header + assembly --------------------------------------------
        $header = "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" . str_repeat("\0", 16)
            . pack('vvv', 0x003E, 0x0003, 0xFFFE)
            . pack('vv', 0x0009, 0x0006)
            . str_repeat("\0", 6)
            . pack('V', 0)
            . pack('V', $fatCount)
            . pack('V', $dirStart)
            . pack('V', 0)
            . pack('V', self::CUTOFF)
            . pack('V', $miniFatStart)
            . pack('V', $miniFatSectors)
            . pack('V', $difatCount > 0 ? $difatStart : self::ENDOFCHAIN)
            . pack('V', $difatCount);

        $headDifat = '';
        for ($i = 0; $i < 109; $i++) {
            $headDifat .= pack('V', $i < $fatCount ? $fatStart + $i : self::FREESECT);
        }
        $header .= $headDifat;

        $difatSectors = '';
        for ($s = 0; $s < $difatCount; $s++) {
            $sector = '';
            for ($e = 0; $e < 127; $e++) {
                $fatIdx = 109 + $s * 127 + $e;
                $sector .= pack('V', $fatIdx < $fatCount ? $fatStart + $fatIdx : self::FREESECT);
            }
            $sector .= pack('V', $s === $difatCount - 1 ? self::ENDOFCHAIN : $difatStart + $s + 1);
            $difatSectors .= $sector;
        }

        return $header
            . $dataArea
            . self::packU32($miniFat)
            . implode('', $entries)
            . self::packU32($fat)
            . $difatSectors;
    }

    /** Reads every stream out of a CFB image. Used by the verifier. */
    public static function read(string $bin): array
    {
        if (substr($bin, 0, 8) !== "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1") {
            throw new RuntimeException('not a compound file');
        }
        $sectorShift = unpack('v', substr($bin, 0x1E, 2))[1];
        $sec = 1 << $sectorShift;
        $miniShift = unpack('v', substr($bin, 0x20, 2))[1];
        $miniSec = 1 << $miniShift;
        $fatCount = unpack('V', substr($bin, 0x2C, 4))[1];
        $dirStart = unpack('V', substr($bin, 0x30, 4))[1];
        $cutoff = unpack('V', substr($bin, 0x38, 4))[1];
        $miniFatStart = unpack('V', substr($bin, 0x3C, 4))[1];
        $difatStart = unpack('V', substr($bin, 0x44, 4))[1];
        $difatCount = unpack('V', substr($bin, 0x48, 4))[1];

        $sector = fn(int $n) => substr($bin, $sec + $n * $sec, $sec);

        $fatSectors = [];
        for ($i = 0; $i < 109 && count($fatSectors) < $fatCount; $i++) {
            $v = unpack('V', substr($bin, 0x4C + $i * 4, 4))[1];
            if ($v <= 0xFFFFFFFA) {
                $fatSectors[] = $v;
            }
        }
        $next = $difatStart;
        for ($s = 0; $s < $difatCount && $next !== self::ENDOFCHAIN; $s++) {
            $blk = $sector($next);
            for ($e = 0; $e < intdiv($sec, 4) - 1 && count($fatSectors) < $fatCount; $e++) {
                $v = unpack('V', substr($blk, $e * 4, 4))[1];
                if ($v <= 0xFFFFFFFA) {
                    $fatSectors[] = $v;
                }
            }
            $next = unpack('V', substr($blk, $sec - 4, 4))[1];
        }

        $fat = [];
        foreach ($fatSectors as $fs) {
            foreach (unpack('V*', $sector($fs)) as $v) {
                $fat[] = $v;
            }
        }
        $miniFat = [];
        $mf = $miniFatStart;
        while ($mf !== self::ENDOFCHAIN && $mf <= 0xFFFFFFFA) {
            foreach (unpack('V*', $sector($mf)) as $v) {
                $miniFat[] = $v;
            }
            $mf = $fat[$mf] ?? self::ENDOFCHAIN;
        }

        $readChain = function (int $start, int $size) use ($fat, $sector, $sec) {
            $out = '';
            $n = $start;
            while ($n !== self::ENDOFCHAIN && $n <= 0xFFFFFFFA && strlen($out) < $size) {
                $out .= $sector($n);
                $n = $fat[$n] ?? self::ENDOFCHAIN;
            }
            return substr($out, 0, $size);
        };

        $dir = $readChain($dirStart, PHP_INT_MAX & 0x7FFFFFF);
        $entries = str_split($dir, 128);

        $rootStart = unpack('V', substr($entries[0], 0x74, 4))[1];
        $rootSize = unpack('P', substr($entries[0], 0x78, 8))[1];
        $miniStream = $readChain($rootStart, $rootSize);

        $out = [];
        foreach ($entries as $e) {
            $type = ord($e[0x42]);
            if ($type !== 2) {
                continue;
            }
            $nameLen = unpack('v', substr($e, 0x40, 2))[1];
            $name = iconv('UTF-16LE', 'UTF-8', substr($e, 0, max(0, $nameLen - 2)));
            $start = unpack('V', substr($e, 0x74, 4))[1];
            $size = unpack('P', substr($e, 0x78, 8))[1];
            if ($size === 0) {
                $out[$name] = '';
            } elseif ($size < $cutoff) {
                $data = '';
                $n = $start;
                while ($n !== self::ENDOFCHAIN && $n <= 0xFFFFFFFA && strlen($data) < $size) {
                    $data .= substr($miniStream, $n * $miniSec, $miniSec);
                    $n = $miniFat[$n] ?? self::ENDOFCHAIN;
                }
                $out[$name] = substr($data, 0, $size);
            } else {
                $out[$name] = $readChain($start, $size);
            }
        }
        return $out;
    }

    // ---------------------------------------------------------------------

    private static function pad(string $data, int $block): string
    {
        $rem = strlen($data) % $block;
        return $rem === 0 ? $data : $data . str_repeat("\0", $block - $rem);
    }

    private static function packU32(array $values): string
    {
        $out = '';
        foreach ($values as $v) {
            $out .= pack('V', $v);
        }
        return $out;
    }

    /** CFB collation: shorter names first, then case-insensitive UTF-16 order. */
    private static function compareNames(string $a, string $b): int
    {
        $la = strlen(iconv('UTF-8', 'UTF-16LE', $a));
        $lb = strlen(iconv('UTF-8', 'UTF-16LE', $b));
        if ($la !== $lb) {
            return $la <=> $lb;
        }
        return strcmp(strtoupper($a), strtoupper($b));
    }

    private static function treeRoot(int $lo, int $hi): int
    {
        return intdiv($lo + $hi, 2);
    }

    /** Balanced BST over the sorted name list; every node coloured black. */
    private static function treeChildren(array $names, int $i, array $index): array
    {
        $find = function (int $lo, int $hi) use (&$find, $i): array {
            if ($lo > $hi) {
                return [self::NOSTREAM, self::NOSTREAM, false];
            }
            $mid = intdiv($lo + $hi, 2);
            if ($mid === $i) {
                $l = $lo <= $mid - 1 ? intdiv($lo + $mid - 1, 2) : null;
                $r = $mid + 1 <= $hi ? intdiv($mid + 1 + $hi, 2) : null;
                return [$l, $r, true];
            }
            return $mid > $i ? $find($lo, $mid - 1) : $find($mid + 1, $hi);
        };
        [$l, $r, $found] = $find(0, count($names) - 1);
        if (!$found) {
            return [self::NOSTREAM, self::NOSTREAM];
        }
        return [
            $l === null ? self::NOSTREAM : $index[$names[$l]],
            $r === null ? self::NOSTREAM : $index[$names[$r]],
        ];
    }

    private static function dirEntry(
        string $name,
        int $type,
        int $start,
        int $size,
        int $child = self::NOSTREAM,
        int $left = self::NOSTREAM,
        int $right = self::NOSTREAM
    ): string {
        $u16 = iconv('UTF-8', 'UTF-16LE', $name) . "\0\0";
        if (strlen($u16) > 64) {
            throw new RuntimeException("directory name too long: $name");
        }
        $nameLen = strlen($u16);
        return str_pad($u16, 64, "\0")
            . pack('v', $nameLen)
            . chr($type)
            . chr(1)                       // black
            . pack('V', $left)
            . pack('V', $right)
            . pack('V', $child)
            . str_repeat("\0", 16)         // CLSID
            . pack('V', 0)                 // state bits
            . str_repeat("\0", 8)          // creation time
            . str_repeat("\0", 8)          // modified time
            . pack('V', $start)
            . pack('P', $size);
    }
}
